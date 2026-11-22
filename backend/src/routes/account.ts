import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../env';
import { requireAuth } from '../lib/auth';
import { randomToken, sha256Hex } from '../lib/crypto';
import { ApiError, decodeCursor, encodeCursor, iso, newId, notFound, parseLimit, readBody } from '../lib/http';
import { DEFAULT_PREFS, loadPrefs } from '../lib/notify';
import { formatHm, parseHm } from '../lib/time';

const SESSION_TTL_MS = 30 * 86_400_000;

// ── /auth ──────────────────────────────────────────────────────────────
export const auth = new Hono<AppEnv>();

/**
 * DEVELOPMENT ONLY. Issues a session for an existing synthetic user so the API
 * can be exercised end to end. The real login (phone verification via
 * PortOne/KCP, Google/Naver OAuth) must replace this — see README "F01".
 */
auth.post('/dev-login', async c => {
  if (c.env.ENVIRONMENT !== 'development' || c.env.DEV_LOGIN_ENABLED !== 'true') throw notFound();
  const { userId } = await readBody(c, z.object({ userId: z.string().min(1).max(64) }));
  const user = await c.env.DB.prepare("SELECT id, nickname, role FROM users WHERE id = ? AND status = 'active'")
    .bind(userId)
    .first<{ id: string; nickname: string; role: string }>();
  if (!user) throw notFound('user');
  const token = randomToken();
  const now = Date.now();
  await c.env.DB.prepare('INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?)')
    .bind(newId(), user.id, await sha256Hex(token), now, now + SESSION_TTL_MS)
    .run();
  return c.json({ token, user, expiresAt: iso(now + SESSION_TTL_MS) }, 201);
});

auth.post('/logout', requireAuth, async c => {
  const sid = c.get('sessionId');
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE sessions SET revoked_at = ? WHERE id = ?').bind(Date.now(), sid),
    // Stop pushes to this device once logged out.
    c.env.DB.prepare('DELETE FROM device_tokens WHERE session_id = ?').bind(sid),
  ]);
  return c.body(null, 204);
});

// ── /me ────────────────────────────────────────────────────────────────
export const me = new Hono<AppEnv>();
me.use('*', requireAuth);

me.get('/', async c => {
  const u = c.get('user');
  const [profile, counts] = await c.env.DB.batch([
    c.env.DB.prepare('SELECT id, nickname, role, show_last_seen, created_at FROM users WHERE id = ?').bind(u.id),
    c.env.DB.prepare(
      `SELECT (SELECT COUNT(*) FROM notifications WHERE user_id = ?1 AND read_at IS NULL) AS unread_notifications,
              (SELECT COUNT(*) FROM dm_requests WHERE to_user = ?1 AND status = 'pending') AS pending_dm_requests,
              (SELECT COUNT(*) FROM posts WHERE author_id = ?1 AND deleted_at IS NULL) AS my_posts,
              (SELECT COUNT(*) FROM saved_items WHERE user_id = ?1) AS saved`
    ).bind(u.id),
  ]);
  const p = profile!.results[0] as { id: string; nickname: string; role: string; show_last_seen: number; created_at: number };
  const k = counts!.results[0] as Record<string, number>;
  return c.json({
    id: p.id,
    nickname: p.nickname,
    role: p.role,
    showLastSeen: !!p.show_last_seen,
    createdAt: iso(p.created_at),
    counts: {
      unreadNotifications: k.unread_notifications,
      pendingDmRequests: k.pending_dm_requests,
      myPosts: k.my_posts,
      saved: k.saved,
    },
  });
});

me.patch('/privacy', async c => {
  const { showLastSeen } = await readBody(c, z.object({ showLastSeen: z.boolean() }));
  await c.env.DB.prepare('UPDATE users SET show_last_seen = ? WHERE id = ?').bind(showLastSeen ? 1 : 0, c.get('user').id).run();
  return c.json({ showLastSeen });
});

/** Withdraw (synthetic data only): deactivates the account and ends every session/device. */
me.delete('/', async c => {
  const id = c.get('user').id;
  const now = Date.now();
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE users SET status = 'withdrawn' WHERE id = ?").bind(id),
    c.env.DB.prepare('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL').bind(now, id),
    c.env.DB.prepare('DELETE FROM device_tokens WHERE user_id = ?').bind(id),
  ]);
  return c.body(null, 204);
});

// Saved rooms/places (찜)
const savedParams = z.object({ type: z.enum(['room', 'place']), id: z.string().min(1).max(64) });
me.put('/saved/:type/:id', async c => {
  const p = savedParams.safeParse(c.req.param());
  if (!p.success) throw new ApiError(400, 'validation_failed');
  const table = p.data.type === 'room' ? 'rooms' : 'places';
  const exists = await c.env.DB.prepare(`SELECT 1 FROM ${table} WHERE id = ?`).bind(p.data.id).first();
  if (!exists) throw notFound(p.data.type);
  await c.env.DB.prepare('INSERT OR IGNORE INTO saved_items (user_id, target_type, target_id, created_at) VALUES (?, ?, ?, ?)')
    .bind(c.get('user').id, p.data.type, p.data.id, Date.now())
    .run();
  return c.json({ saved: true });
});
me.delete('/saved/:type/:id', async c => {
  const p = savedParams.safeParse(c.req.param());
  if (!p.success) throw new ApiError(400, 'validation_failed');
  await c.env.DB.prepare('DELETE FROM saved_items WHERE user_id = ? AND target_type = ? AND target_id = ?')
    .bind(c.get('user').id, p.data.type, p.data.id)
    .run();
  return c.json({ saved: false });
});

// ── Safety: blocks & reports ───────────────────────────────────────────
export const safety = new Hono<AppEnv>();
safety.use('*', requireAuth);

safety.post('/blocks', async c => {
  const meId = c.get('user').id;
  const { userId } = await readBody(c, z.object({ userId: z.string().min(1).max(64) }));
  if (userId === meId) throw new ApiError(400, 'cannot_block_self');
  const target = await c.env.DB.prepare('SELECT 1 FROM users WHERE id = ?').bind(userId).first();
  if (!target) throw notFound('user');
  await c.env.DB.prepare('INSERT OR IGNORE INTO blocks (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)')
    .bind(meId, userId, Date.now())
    .run();
  // Cut off the blocked user's live DM socket immediately.
  const [a, b] = meId < userId ? [meId, userId] : [userId, meId];
  const conv = await c.env.DB.prepare('SELECT id FROM dm_conversations WHERE user_a = ? AND user_b = ?').bind(a, b).first<{ id: string }>();
  if (conv) {
    const hub = c.env.HUB.get(c.env.HUB.idFromName(`dm:${conv.id}`));
    await hub.revoke(userId, 'blocked');
  }
  return c.json({ blocked: true }, 201);
});

safety.delete('/blocks/:userId', async c => {
  await c.env.DB.prepare('DELETE FROM blocks WHERE blocker_id = ? AND blocked_id = ?').bind(c.get('user').id, c.req.param('userId')).run();
  return c.json({ blocked: false });
});

safety.get('/blocks', async c => {
  const { results } = await c.env.DB.prepare(
    'SELECT u.id, u.nickname, b.created_at FROM blocks b JOIN users u ON u.id = b.blocked_id WHERE b.blocker_id = ? ORDER BY b.created_at DESC'
  )
    .bind(c.get('user').id)
    .all<{ id: string; nickname: string; created_at: number }>();
  return c.json({ items: results.map(r => ({ userId: r.id, nickname: r.nickname, blockedAt: iso(r.created_at) })) });
});

safety.post('/reports', async c => {
  const input = await readBody(
    c,
    z.object({
      targetType: z.enum(['user', 'post', 'comment', 'dm_message', 'room_message']),
      targetId: z.string().min(1).max(64),
      reason: z.string().trim().min(1).max(500),
    })
  );
  const res = await c.env.DB.prepare(
    'INSERT OR IGNORE INTO reports (id, reporter_id, target_type, target_id, reason, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  )
    .bind(newId(), c.get('user').id, input.targetType, input.targetId, input.reason, Date.now())
    .run();
  return c.json({ reported: true, duplicate: res.meta.changes === 0 }, res.meta.changes ? 201 : 200);
});

// ── F05 Push devices, preferences, inbox ───────────────────────────────
export const push = new Hono<AppEnv>();
push.use('*', requireAuth);

push.put('/devices', async c => {
  const { platform, token } = await readBody(
    c,
    z.object({ platform: z.enum(['android', 'ios']), token: z.string().min(16).max(4096) })
  );
  const now = Date.now();
  // A token belongs to one device; re-registering moves it to the current user/session (no duplicates).
  await c.env.DB.prepare(
    `INSERT INTO device_tokens (id, user_id, session_id, platform, token, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (token) DO UPDATE SET user_id = excluded.user_id, session_id = excluded.session_id,
       platform = excluded.platform, updated_at = excluded.updated_at`
  )
    .bind(newId(), c.get('user').id, c.get('sessionId'), platform, token, now, now)
    .run();
  return c.json({ registered: true });
});

push.delete('/devices', async c => {
  const { token } = await readBody(c, z.object({ token: z.string().min(1).max(4096) }));
  await c.env.DB.prepare('DELETE FROM device_tokens WHERE token = ? AND user_id = ?').bind(token, c.get('user').id).run();
  return c.body(null, 204);
});

const prefsOut = (p: typeof DEFAULT_PREFS) => ({
  comment: p.comment,
  dm: p.dm,
  saved: p.saved,
  dnd: p.dndStart == null || p.dndEnd == null ? null : { start: formatHm(p.dndStart), end: formatHm(p.dndEnd) },
  hideContent: p.hideContent,
});

push.get('/preferences', async c => c.json(prefsOut(await loadPrefs(c.env, c.get('user').id))));

push.put('/preferences', async c => {
  const hm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
  const input = await readBody(
    c,
    z.object({
      comment: z.boolean().optional(),
      dm: z.boolean().optional(),
      saved: z.boolean().optional(),
      dnd: z.object({ start: hm, end: hm }).nullable().optional(),
      hideContent: z.boolean().optional(),
    })
  );
  const cur = await loadPrefs(c.env, c.get('user').id);
  const next = {
    comment: input.comment ?? cur.comment,
    dm: input.dm ?? cur.dm,
    saved: input.saved ?? cur.saved,
    dndStart: input.dnd === undefined ? cur.dndStart : input.dnd === null ? null : parseHm(input.dnd.start),
    dndEnd: input.dnd === undefined ? cur.dndEnd : input.dnd === null ? null : parseHm(input.dnd.end),
    hideContent: input.hideContent ?? cur.hideContent,
  };
  await c.env.DB.prepare(
    `INSERT INTO notification_prefs (user_id, comment, dm, saved, dnd_start, dnd_end, hide_content, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (user_id) DO UPDATE SET comment = excluded.comment, dm = excluded.dm, saved = excluded.saved,
       dnd_start = excluded.dnd_start, dnd_end = excluded.dnd_end, hide_content = excluded.hide_content, updated_at = excluded.updated_at`
  )
    .bind(c.get('user').id, +next.comment, +next.dm, +next.saved, next.dndStart, next.dndEnd, +next.hideContent, Date.now())
    .run();
  return c.json(prefsOut(next));
});

export const notifications = new Hono<AppEnv>();
notifications.use('*', requireAuth);

notifications.get('/', async c => {
  const limit = parseLimit(c.req.query('limit'), 30, 100);
  const cur = decodeCursor<{ c: number; i: string }>(c.req.query('cursor'));
  const { results } = await c.env.DB.prepare(
    `SELECT * FROM notifications WHERE user_id = ? ${cur ? 'AND (created_at < ? OR (created_at = ? AND id < ?))' : ''}
      ORDER BY created_at DESC, id DESC LIMIT ?`
  )
    .bind(c.get('user').id, ...(cur ? [cur.c, cur.c, cur.i] : []), limit + 1)
    .all<{ id: string; type: string; title: string; body: string | null; link: string | null; read_at: number | null; created_at: number }>();
  const page = results.slice(0, limit);
  const last = page[page.length - 1];
  return c.json({
    items: page.map(n => ({ id: n.id, type: n.type, title: n.title, body: n.body, link: n.link, read: n.read_at != null, createdAt: iso(n.created_at) })),
    nextCursor: results.length > limit && last ? encodeCursor({ c: last.created_at, i: last.id }) : null,
    hasMore: results.length > limit,
  });
});

notifications.post('/read', async c => {
  const input = await readBody(c, z.object({ ids: z.array(z.string().max(64)).max(200).optional(), all: z.literal(true).optional() }).refine(v => !!v.ids !== !!v.all, 'ids or all'));
  const now = Date.now();
  const uid = c.get('user').id;
  const res = input.all
    ? await c.env.DB.prepare('UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL').bind(now, uid).run()
    : await c.env.DB.prepare(
        `UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL AND id IN (${input.ids!.map(() => '?').join(',') || "''"})`
      )
        .bind(now, uid, ...input.ids!)
        .run();
  return c.json({ updated: res.meta.changes });
});
