#!/usr/bin/env node
/**
 * F02 photo migration: pictures stored inside the existing service's database (base64 text, raw or
 * `data:image/...;base64,` — e.g. place_photos.image, recruiter_profiles.photo) → R2 objects + our
 * `media` table + `legacy_media_refs` (which old row each picture came from).
 *
 *   node --no-warnings tools/migrate-photos.mjs --source <dump.sql | db.sqlite> --work <dir>
 *        [--upload local|staging] [--verify]
 *
 * --source  a `wrangler d1 export` SQL file or an SQLite file. Read only; nothing in it changes.
 * --work    output folder:
 *             objects/legacy/<sha256>.<ext>  one file per distinct picture (same bytes → one file)
 *             manifest.jsonl                 one line per source cell (ok or invalid + reason)
 *             media-import.sql               INSERT OR IGNORE rows for media + legacy_media_refs
 *             report.json                    counts per table/column, bytes, new vs already there
 * --upload  copy new objects to R2 and apply media-import.sql to D1, for `local` (wrangler dev
 *           state) or `staging` only. Resumable: finished keys are listed in uploaded-<target>.txt.
 *           There is deliberately no production target; that needs the client's approval.
 * --verify  re-hash every object against the manifest and check no reference points at a missing
 *           object (the "run it twice, no duplicates, no broken references" check).
 *
 * Columns are found automatically: every text column of every table is scanned for values that
 * start like an image, so columns this tool has never heard of are still covered and listed.
 * Running it again with the same source gives the same objects, manifest and SQL (idempotent).
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const args = process.argv.slice(2);
const opt = name => {
  const i = args.indexOf('--' + name);
  return i < 0 ? undefined : args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true;
};
const source = opt('source');
const work = opt('work');
const upload = opt('upload');
if (typeof source !== 'string' || typeof work !== 'string') {
  console.error('usage: migrate-photos.mjs --source <dump.sql|db.sqlite> --work <dir> [--upload local|staging] [--verify]');
  process.exit(2);
}
if (upload !== undefined && upload !== 'local' && upload !== 'staging') {
  console.error(`--upload must be "local" or "staging" (got ${upload}). Production needs the client's approval.`);
  process.exit(2);
}

const OWNER = 'legacy-import'; // placeholder owner until F01 maps old members to new users
const IMAGE_START = { '/9j/': 'jpeg', iVBORw0KGgo: 'png', UklGR: 'webp', R0lGOD: 'gif' };
const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };
const SKIP_TABLES = /^(sqlite_|_cf_|d1_migrations$|__drizzle)/;

function sniff(buf) {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.length > 12 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
  if (buf.length > 6 && /^GIF8[79]a$/.test(buf.toString('latin1', 0, 6))) return 'image/gif';
  return null;
}

/** The file ends the way its format says it must (catches cut-off base64 and look-alike text). */
function complete(buf, mime) {
  const tail = buf.subarray(Math.max(0, buf.length - 64));
  if (mime === 'image/jpeg') return tail.includes(Buffer.from([0xff, 0xd9]));
  if (mime === 'image/png') return tail.includes(Buffer.from('IEND'));
  if (mime === 'image/gif') return buf[buf.length - 1] === 0x3b;
  if (mime === 'image/webp') return buf.readUInt32LE(4) + 8 <= buf.length;
  return false;
}

/** Decode one cell. Returns { bytes, mime, form } or { error }. */
function decode(value) {
  let b64 = value.trim();
  let form = 'raw';
  const m = /^data:(image\/[a-z0-9.+-]+);base64,/i.exec(b64);
  if (m) {
    form = 'data_uri';
    b64 = b64.slice(m[0].length);
  }
  b64 = b64.replace(/\s+/g, '');
  if (!/^[A-Za-z0-9+/_-]*={0,2}$/.test(b64) || b64.length < 16) return { error: 'not_base64' };
  const bytes = Buffer.from(b64.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  const mime = sniff(bytes);
  if (!mime) return { error: 'not_an_image' };
  if (!complete(bytes, mime)) return { error: 'truncated_or_corrupt' };
  if (m && m[1].toLowerCase().replace('jpg', 'jpeg') !== mime) form = `data_uri(${m[1]}→${mime})`;
  return { bytes, mime, form };
}

// ── Read the source ────────────────────────────────────────────────────────
let db;
if (/\.sql$/i.test(source)) {
  db = new DatabaseSync(':memory:');
  db.exec(fs.readFileSync(source, 'utf8'));
} else {
  db = new DatabaseSync(source, { readOnly: true });
}
const q = id => `"${id.replace(/"/g, '""')}"`;
const tables = db
  .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
  .all()
  .map(r => r.name)
  .filter(n => !SKIP_TABLES.test(n));

fs.mkdirSync(path.join(work, 'objects', 'legacy'), { recursive: true });
const manifest = [];
const objects = new Map(); // key → { mediaId, mime, size, sha256 }
const perColumn = {};
let newFiles = 0;
let present = 0;

const imageWhere = col =>
  `(${q(col)} LIKE 'data:image/%' OR ` +
  Object.keys(IMAGE_START).map(p => `substr(${q(col)}, 1, ${p.length}) = '${p}'`).join(' OR ') + ')';

for (const t of tables) {
  const cols = db.prepare(`PRAGMA table_info(${q(t)})`).all();
  const pk = cols.filter(c => c.pk > 0).sort((a, b) => a.pk - b.pk).map(c => c.name);
  const keyCols = pk.length ? pk : ['rowid'];
  for (const c of cols) {
    if (c.type && !/char|text|clob/i.test(c.type)) continue;
    const rows = db
      .prepare(`SELECT ${keyCols.map(q).join(', ')}, ${q(c.name)} AS v FROM ${q(t)} WHERE typeof(${q(c.name)}) = 'text' AND ${imageWhere(c.name)} ORDER BY ${keyCols.map(q).join(', ')}`)
      .all();
    if (!rows.length) continue;
    const stat = (perColumn[`${t}.${c.name}`] = { cells: 0, ok: 0, invalid: 0, bytes: 0 });
    for (const r of rows) {
      stat.cells++;
      const sourcePk = JSON.stringify(Object.fromEntries(keyCols.map(k => [k, r[k]])));
      const d = decode(r.v);
      if (d.error) {
        stat.invalid++;
        manifest.push({ table: t, column: c.name, pk: sourcePk, status: 'invalid', reason: d.error });
        continue;
      }
      const sha256 = createHash('sha256').update(d.bytes).digest('hex');
      const key = `legacy/${sha256}.${EXT[d.mime]}`;
      const file = path.join(work, 'objects', key);
      if (!objects.has(key)) {
        if (fs.existsSync(file)) {
          const have = createHash('sha256').update(fs.readFileSync(file)).digest('hex');
          if (have !== sha256) throw new Error(`${file} exists with different bytes; refusing to overwrite`);
          present++;
        } else {
          fs.writeFileSync(file, d.bytes);
          newFiles++;
        }
        objects.set(key, { mediaId: 'lm_' + sha256.slice(0, 32), mime: d.mime, size: d.bytes.length, sha256 });
      }
      stat.ok++;
      stat.bytes += d.bytes.length;
      manifest.push({ table: t, column: c.name, pk: sourcePk, status: 'ok', form: d.form, mediaId: objects.get(key).mediaId, key, sha256, size: d.bytes.length, mime: d.mime });
    }
  }
}

// ── Outputs ────────────────────────────────────────────────────────────────
fs.writeFileSync(path.join(work, 'manifest.jsonl'), manifest.map(m => JSON.stringify(m)).join('\n') + (manifest.length ? '\n' : ''));

const lit = v => (v == null ? 'NULL' : typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`);
const sql = [
  '-- Generated by tools/migrate-photos.mjs. Safe to apply more than once (INSERT OR IGNORE).',
  `INSERT OR IGNORE INTO users (id, nickname, role, status, created_at) VALUES ('${OWNER}', '기존 자료(이전)', 'member', 'withdrawn', 0);`,
  ...[...objects].map(([key, o]) =>
    `INSERT OR IGNORE INTO media (id, owner_id, r2_key, content_type, size, sha256, created_at) VALUES (${[o.mediaId, OWNER, key, o.mime, o.size, o.sha256, 0].map(lit).join(', ')});`),
  ...manifest.filter(m => m.status === 'ok').map(m =>
    `INSERT OR IGNORE INTO legacy_media_refs (source_table, source_column, source_pk, media_id) VALUES (${[m.table, m.column, m.pk, m.mediaId].map(lit).join(', ')});`),
];
fs.writeFileSync(path.join(work, 'media-import.sql'), sql.join('\n') + '\n');

const totals = {
  cells: manifest.length,
  ok: manifest.filter(m => m.status === 'ok').length,
  invalid: manifest.filter(m => m.status === 'invalid').length,
  distinctPictures: objects.size,
  bytes: [...objects.values()].reduce((s, o) => s + o.size, 0),
  newFilesThisRun: newFiles,
  alreadyPresent: present,
};
const report = { source: path.basename(source), tablesScanned: tables.length, columns: perColumn, totals };

// ── Verify ─────────────────────────────────────────────────────────────────
if (opt('verify')) {
  const problems = [];
  for (const [key, o] of objects) {
    const file = path.join(work, 'objects', key);
    if (!fs.existsSync(file)) problems.push({ key, problem: 'missing' });
    else if (createHash('sha256').update(fs.readFileSync(file)).digest('hex') !== o.sha256) problems.push({ key, problem: 'checksum_mismatch' });
  }
  const refsBroken = manifest.filter(m => m.status === 'ok' && !objects.has(m.key)).length;
  const onDisk = fs.readdirSync(path.join(work, 'objects', 'legacy')).length;
  report.verify = { objectsChecked: objects.size, filesOnDisk: onDisk, extraFiles: onDisk - objects.size, refsBroken, problems };
}

// ── Upload (local / staging only) ──────────────────────────────────────────
if (upload) {
  const target = upload === 'local' ? ['--local'] : ['--remote', '--env', 'staging'];
  const bucket = upload === 'local' ? 'hiunni-media' : 'hiunni-media-staging';
  const dbName = upload === 'local' ? 'hiunni-db' : 'hiunni-db-staging';
  const ledgerFile = path.join(work, `uploaded-${upload}.txt`);
  const done = new Set(fs.existsSync(ledgerFile) ? fs.readFileSync(ledgerFile, 'utf8').split('\n').filter(Boolean) : []);
  // wrangler's own script run by node: no shell, so paths and values pass through unsplit.
  const wranglerJs = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', 'node_modules', 'wrangler', 'bin', 'wrangler.js');
  const wrangler = a => execFileSync(process.execPath, [wranglerJs, ...a], { stdio: 'pipe', cwd: path.join(path.dirname(wranglerJs), '..', '..', '..') });
  let uploaded = 0;
  for (const [key, o] of objects) {
    if (done.has(key)) continue;
    wrangler(['r2', 'object', 'put', `${bucket}/${key}`, '--file', path.join(work, 'objects', key), '--content-type', o.mime, ...target]);
    fs.appendFileSync(ledgerFile, key + '\n');
    uploaded++;
  }
  wrangler(['d1', 'execute', dbName, '--file', path.join(work, 'media-import.sql'), '--yes', ...target]);
  report.upload = { target: upload, bucket, uploadedThisRun: uploaded, skippedAlreadyUploaded: objects.size - uploaded, sqlApplied: true };
}

fs.writeFileSync(path.join(work, 'report.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
if (report.verify && (report.verify.problems.length || report.verify.refsBroken)) process.exit(1);
