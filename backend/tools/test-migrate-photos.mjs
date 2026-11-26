#!/usr/bin/env node
/**
 * Rehearsal for tools/migrate-photos.mjs on a SYNTHETIC database that copies the existing service's
 * table/column names (photos as raw base64 and as data URIs). No real data is involved.
 *   node --no-warnings tools/test-migrate-photos.mjs [--upload-local]
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const tool = path.join(here, 'migrate-photos.mjs');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hiunni-photos-'));
let failures = 0;
const check = (ok, msg) => {
  console.log((ok ? 'PASS ' : 'FAIL ') + msg);
  if (!ok) failures++;
};

// Synthetic pictures: two of our generated lounge covers (JPEG), a generated PNG, a 1×1 GIF.
const jpgA = fs.readFileSync(path.join(here, '../seed/covers', fs.readdirSync(path.join(here, '../seed/covers')).filter(f => f.endsWith('.jpg'))[0]));
const jpgB = fs.readFileSync(path.join(here, '../seed/covers', fs.readdirSync(path.join(here, '../seed/covers')).filter(f => f.endsWith('.jpg'))[1]));
function png(w, h, rgb) {
  const crc = buf => {
    let c = ~0;
    for (const b of buf) {
      c ^= b;
      for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
    }
    return ~c >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) raw.set(rgb, y * (w * 3 + 1) + 1 + x * 3);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const pngC = png(24, 16, [130, 94, 208]);
const gifD = Buffer.from('R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==', 'base64');
const raw = b => b.toString('base64');
const uri = (b, t) => `data:${t};base64,${b.toString('base64')}`;
const lit = v => (v == null ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`);

// Same column names as the existing service (db/schema.ts); synthetic rows only.
const sql = `
CREATE TABLE place_photos (id TEXT PRIMARY KEY, service_id TEXT NOT NULL, image TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE recruiter_profiles (user_id TEXT PRIMARY KEY, shop_id TEXT NOT NULL, bio TEXT NOT NULL, photo TEXT NOT NULL);
CREATE TABLE group_profiles (room_id TEXT NOT NULL, user_id TEXT NOT NULL, nickname TEXT NOT NULL, photo TEXT NOT NULL DEFAULT '', PRIMARY KEY (room_id, user_id));
CREATE TABLE job_details (job_id TEXT PRIMARY KEY, salary TEXT NOT NULL, image TEXT NOT NULL);
CREATE TABLE odd_no_pk (note TEXT, pic TEXT);
CREATE TABLE community_posts (id TEXT PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL);
INSERT INTO place_photos VALUES ('pp1', 'svc1', ${lit(raw(jpgA))}, '2026-01-01'), ('pp2', 'svc1', ${lit(uri(jpgA, 'image/jpeg'))}, '2026-01-02'), ('pp3', 'svc2', ${lit(uri(pngC, 'image/png'))}, '2026-01-03');
INSERT INTO recruiter_profiles VALUES ('u1', 'shop1', '합성 소개', ${lit(raw(jpgB))}), ('u2', 'shop1', '합성 소개', ''), ('u3', 'shop2', '합성 소개', 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB!!!broken');
INSERT INTO group_profiles VALUES ('room1', 'u1', '합성', ${lit(uri(gifD, 'image/gif'))}), ('room1', 'u2', '합성', '');
INSERT INTO job_details VALUES ('job1', '협의', ${lit(uri(jpgB, 'image/png'))}), ('job2', '협의', '/9j/notreallyajpegjustlookslikeone');
INSERT INTO odd_no_pk VALUES ('a', ${lit(raw(pngC))});
INSERT INTO community_posts VALUES ('post1', '합성 글', '사진 없는 본문 /9j/ 이 글자는 본문 중간');
`;
const dump = path.join(tmp, 'synthetic-export.sql');
fs.writeFileSync(dump, sql);
const work = path.join(tmp, 'work');
const run = (...extra) => JSON.parse(execFileSync(process.execPath, ['--no-warnings', tool, '--source', dump, '--work', work, ...extra], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));

// ── First run ──
const r1 = run('--verify');
check(r1.totals.cells === 9, `finds every picture cell (9): ${r1.totals.cells}`);
check(r1.totals.ok === 7 && r1.totals.invalid === 2, `7 good, 2 broken (bad base64, fake JPEG): ${r1.totals.ok}/${r1.totals.invalid}`);
check(r1.totals.distinctPictures === 4, `same picture stored once: 4 distinct files for 7 cells (${r1.totals.distinctPictures})`);
check(r1.totals.newFilesThisRun === 4 && r1.totals.alreadyPresent === 0, 'first run writes 4 new files');
check(Object.keys(r1.columns).sort().join() === 'group_profiles.photo,job_details.image,odd_no_pk.pic,place_photos.image,recruiter_profiles.photo',
  `columns found without being told: ${Object.keys(r1.columns).sort().join(', ')}`);
check(!r1.columns['community_posts.body'], 'text that only mentions /9j/ mid-sentence is not taken for a picture');
const manifest1 = fs.readFileSync(path.join(work, 'manifest.jsonl'), 'utf8');
const lines = manifest1.trim().split('\n').map(l => JSON.parse(l));
const byPk = (t, pk) => lines.find(l => l.table === t && l.pk === JSON.stringify(pk));
check(byPk('place_photos', { id: 'pp1' }).mediaId === byPk('place_photos', { id: 'pp2' }).mediaId, 'raw base64 and data-URI copies of one picture map to the same media id');
check(byPk('job_details', { job_id: 'job1' }).mime === 'image/jpeg', 'type comes from the bytes, not the label (JPEG labelled image/png)');
check(byPk('group_profiles', { room_id: 'room1', user_id: 'u1' }).status === 'ok', 'two-column primary keys are recorded');
check(byPk('odd_no_pk', { rowid: 1 }).status === 'ok', 'tables without a primary key use rowid');
check(byPk('recruiter_profiles', { user_id: 'u3' }).reason === 'not_base64' && byPk('job_details', { job_id: 'job2' }).reason === 'truncated_or_corrupt', 'broken cells are listed with the reason');
const want = createHash('sha256').update(jpgA).digest('hex');
const fileA = path.join(work, 'objects', `legacy/${want}.jpg`);
check(fs.existsSync(fileA) && createHash('sha256').update(fs.readFileSync(fileA)).digest('hex') === want, 'stored file is byte-identical to the original (SHA-256)');
check(r1.verify.refsBroken === 0 && r1.verify.problems.length === 0 && r1.verify.extraFiles === 0, 'verify: no missing files, no checksum errors, no broken references');
const sql1 = fs.readFileSync(path.join(work, 'media-import.sql'), 'utf8');
check((sql1.match(/INTO media /g) || []).length === 4 && (sql1.match(/INTO legacy_media_refs/g) || []).length === 7, 'import SQL: 4 media rows, 7 references');

// ── Second run: nothing new, same output ──
const r2 = run('--verify');
check(r2.totals.newFilesThisRun === 0 && r2.totals.alreadyPresent === 4, 'second run: 0 new files, 4 already there');
check(fs.readFileSync(path.join(work, 'manifest.jsonl'), 'utf8') === manifest1, 'second run: identical manifest');
check(fs.readFileSync(path.join(work, 'media-import.sql'), 'utf8') === sql1, 'second run: identical import SQL');

// ── Damage is caught ──
fs.writeFileSync(fileA, Buffer.concat([fs.readFileSync(fileA), Buffer.from('x')]));
let refused = false;
try { run('--verify'); } catch (e) { refused = /different bytes/.test(String(e.stderr)); }
check(refused, 'a changed file is never silently overwritten');
fs.unlinkSync(fileA);
const r3 = run('--verify');
check(r3.totals.newFilesThisRun === 1 && r3.verify.problems.length === 0, 'a missing file is restored on the next run');

// ── Source untouched ──
check(fs.readFileSync(dump, 'utf8') === sql, 'source export is unchanged');

// ── Optional: local R2 + D1 (wrangler dev state) ──
if (process.argv.includes('--upload-local')) {
  const r4 = run('--upload', 'local');
  check(r4.upload.uploadedThisRun === 4 && r4.upload.sqlApplied, `local upload: ${r4.upload.uploadedThisRun} objects + SQL`);
  const r5 = run('--upload', 'local');
  check(r5.upload.uploadedThisRun === 0, 'local upload again: nothing re-sent (resumable ledger)');
  const wranglerJs = path.join(here, '..', 'node_modules', 'wrangler', 'bin', 'wrangler.js');
  const wrangler = (a, o = {}) => execFileSync(process.execPath, [wranglerJs, ...a], { cwd: path.join(here, '..'), stdio: ['ignore', 'pipe', 'pipe'], ...o });
  const out = path.join(tmp, 'back.jpg');
  wrangler(['r2', 'object', 'get', `hiunni-media/legacy/${want}.jpg`, '--file', out, '--local']);
  check(createHash('sha256').update(fs.readFileSync(out)).digest('hex') === want, 'object read back from local R2 matches the original');
  const counts = wrangler(['d1', 'execute', 'hiunni-db', '--local', '--json', '--command',
    "SELECT (SELECT COUNT(*) FROM media WHERE r2_key LIKE 'legacy/%') AS media, (SELECT COUNT(*) FROM legacy_media_refs) AS refs, (SELECT COUNT(*) FROM legacy_media_refs r LEFT JOIN media m ON m.id = r.media_id WHERE m.id IS NULL) AS broken"],
    { encoding: 'utf8' });
  const row = JSON.parse(counts)[0].results[0];
  check(row.media >= 4 && row.refs >= 7 && row.broken === 0, `local D1: ${row.media} legacy media, ${row.refs} refs, ${row.broken} broken`);
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(failures ? `${failures} FAILED` : 'all passed');
process.exit(failures ? 1 : 0);
