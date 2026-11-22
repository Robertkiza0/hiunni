import { Hono } from 'hono';
import type { AppEnv, Env } from '../env';
import { requireAuth } from '../lib/auth';
import { hmacHex, safeEqual, sha256Hex } from '../lib/crypto';
import { ApiError, forbidden, iso, newId, notFound } from '../lib/http';

/**
 * F02 — Private photo storage on R2.
 * Upload: raw body with Content-Type image/jpeg|png|webp (≤10 MB). The bytes are
 * sniffed so the declared type must match the file. Objects are never public;
 * viewers get a short-lived HMAC-signed URL after an access check.
 *
 * Migrating the existing production photos from the DB to R2 is NOT done here
 * (no production data) — see README "F02".
 */
export const media = new Hono<AppEnv>();

const MAX_BYTES = 10 * 1024 * 1024;
const URL_TTL_S = 300;

const SNIFF: Record<string, (b: Uint8Array) => boolean> = {
  'image/jpeg': b => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/png': b => [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((v, i) => b[i] === v),
  'image/webp': b =>
    String.fromCharCode(...b.slice(0, 4)) === 'RIFF' && String.fromCharCode(...b.slice(8, 12)) === 'WEBP',
};

interface MediaRow {
  id: string;
  owner_id: string;
  r2_key: string;
  content_type: string;
  size: number;
  sha256: string;
  created_at: number;
}

media.post('/', requireAuth, async c => {
  const me = c.get('user');
  const type = (c.req.header('Content-Type') ?? '').split(';')[0]!.trim().toLowerCase();
  const sniff = SNIFF[type];
  if (!sniff) throw new ApiError(415, 'unsupported_media_type', 'allowed: image/jpeg, image/png, image/webp');
  const declared = Number(c.req.header('Content-Length') ?? NaN);
  if (Number.isFinite(declared) && declared > MAX_BYTES) throw new ApiError(413, 'too_large');
  const buf = await c.req.arrayBuffer();
  if (buf.byteLength === 0) throw new ApiError(400, 'empty_body');
  if (buf.byteLength > MAX_BYTES) throw new ApiError(413, 'too_large');
  if (!sniff(new Uint8Array(buf, 0, Math.min(16, buf.byteLength)))) {
    throw new ApiError(415, 'content_mismatch', 'file content does not match Content-Type');
  }
  const id = newId();
  const sha256 = await sha256Hex(buf);
  const key = `u/${me.id}/${id}`;
  const now = Date.now();
  await c.env.MEDIA.put(key, buf, {
    httpMetadata: { contentType: type },
    customMetadata: { owner: me.id, sha256 },
  });
  await c.env.DB.prepare(
    'INSERT INTO media (id, owner_id, r2_key, content_type, size, sha256, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  )
    .bind(id, me.id, key, type, buf.byteLength, sha256, now)
    .run();
  return c.json({ id, contentType: type, size: buf.byteLength, sha256, createdAt: iso(now) }, 201);
});

async function loadMedia(env: Env, id: string) {
  const m = await env.DB.prepare('SELECT * FROM media WHERE id = ? AND deleted_at IS NULL').bind(id).first<MediaRow>();
  if (!m) throw notFound('media');
  return m;
}

/** Owner, or someone who can see a message that references the media. */
async function canView(env: Env, m: MediaRow, userId: string): Promise<boolean> {
  if (m.owner_id === userId) return true;
  const r = await env.DB.prepare(
    `SELECT 1 FROM dm_messages dm JOIN dm_conversations c ON c.id = dm.conversation_id
      WHERE dm.media_id = ?1 AND (c.user_a = ?2 OR c.user_b = ?2)
     UNION ALL
     SELECT 1 FROM room_messages rm JOIN room_members mem ON mem.room_id = rm.room_id
       JOIN rooms r ON r.id = rm.room_id
      WHERE rm.media_id = ?1 AND mem.user_id = ?2 AND mem.state = 'active' AND r.status = 'open'
     LIMIT 1`
  )
    .bind(m.id, userId)
    .first();
  return r !== null;
}

const signature = (env: Env, id: string, exp: number) => hmacHex(env.MEDIA_SIGNING_KEY, `media:${id}:${exp}`);

media.get('/:id/url', requireAuth, async c => {
  const m = await loadMedia(c.env, c.req.param('id'));
  if (!(await canView(c.env, m, c.get('user').id))) throw forbidden();
  const exp = Math.floor(Date.now() / 1000) + URL_TTL_S;
  const sig = await signature(c.env, m.id, exp);
  const url = new URL(`/media/${m.id}/raw`, c.req.url);
  url.searchParams.set('exp', String(exp));
  url.searchParams.set('sig', sig);
  return c.json({ url: url.toString(), expiresAt: iso(exp * 1000) });
});

/** No Authorization header (usable from <img>); the signed query string is the credential. */
media.get('/:id/raw', async c => {
  const id = c.req.param('id');
  const exp = Number(c.req.query('exp'));
  const sig = c.req.query('sig') ?? '';
  if (!Number.isInteger(exp) || exp < Math.floor(Date.now() / 1000)) throw forbidden('url_expired');
  if (!safeEqual(sig, await signature(c.env, id, exp))) throw forbidden('bad_signature');
  const m = await loadMedia(c.env, id);
  const obj = await c.env.MEDIA.get(m.r2_key);
  if (!obj) throw notFound('media');
  return new Response(obj.body, {
    headers: {
      'Content-Type': m.content_type,
      'Content-Length': String(m.size),
      'Cache-Control': `private, max-age=${Math.max(0, exp - Math.floor(Date.now() / 1000))}`,
      'X-Content-Type-Options': 'nosniff',
      ETag: `"${m.sha256}"`,
    },
  });
});

media.delete('/:id', requireAuth, async c => {
  const m = await loadMedia(c.env, c.req.param('id'));
  if (m.owner_id !== c.get('user').id) throw forbidden('owner_only');
  // Client rule (의뢰서): "자료는 지우지 말고 숨기는 쪽으로". The R2 object is kept;
  // the row is hidden, so no URL can be issued for it any more.
  await c.env.DB.prepare('UPDATE media SET deleted_at = ? WHERE id = ?').bind(Date.now(), m.id).run();
  return c.body(null, 204);
});
