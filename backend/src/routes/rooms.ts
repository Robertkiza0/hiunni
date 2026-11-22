import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv, AuthUser, Env } from '../env';
import { requireAuth } from '../lib/auth';
import {
  ApiError,
  decodeCursor,
  encodeCursor,
  forbidden,
  iso,
  likePattern,
  newId,
  notFound,
  parseLimit,
  parseWith,
  readBody,
} from '../lib/http';
import { assertOwnMedia, insertMessage, sendSchema, toMessage } from '../lib/messages';
import { aliasFor } from '../lib/alias';
import { notify } from '../lib/notify';
import { broadcast, hubFor, revoke, type Channel } from '../lib/realtime';

interface RoomRow {
  id: string;
  kind: 'general' | 'store' | 'daily';
  title: string;
  region: string | null;
  status: 'open' | 'closed';
  join_policy: 'open' | 'approval';
  capacity: number | null;
  store_id: string | null;
  anonymous: number; // 익명 오픈톡: show per-room automatic nicknames
  created_at: number;
}

type MemberState = 'pending' | 'active' | 'rejected' | 'left' | 'blocked';

export const rooms = new Hono<AppEnv>();
rooms.use('*', requireAuth);

const roomChannel = (id: string): Channel => `room:${id}`;

async function getRoom(env: Env, id: string): Promise<RoomRow> {
  const r = await env.DB.prepare('SELECT * FROM rooms WHERE id = ?').bind(id).first<RoomRow>();
  if (!r) throw notFound('room');
  return r;
}

async function getMember(env: Env, roomId: string, userId: string) {
  return env.DB.prepare('SELECT state, role FROM room_members WHERE room_id = ? AND user_id = ?')
    .bind(roomId, userId)
    .first<{ state: MemberState; role: 'member' | 'manager' }>();
}

async function isStoreOperator(env: Env, room: RoomRow, user: AuthUser) {
  if (user.role === 'admin') return true;
  if (!room.store_id) return false;
  const r = await env.DB.prepare(
    'SELECT 1 FROM store_staff WHERE store_id = ? AND user_id = ? AND is_operator = 1'
  )
    .bind(room.store_id, user.id)
    .first();
  return r !== null;
}

async function isManager(env: Env, room: RoomRow, user: AuthUser) {
  if (user.role === 'admin') return true;
  const m = await getMember(env, room.id, user.id);
  if (m?.state === 'active' && m.role === 'manager') return true;
  return isStoreOperator(env, room, user);
}

async function requireManager(env: Env, room: RoomRow, user: AuthUser) {
  if (!(await isManager(env, room, user))) throw forbidden('manager_only');
}

async function requireActiveMember(env: Env, room: RoomRow, userId: string) {
  if (room.status !== 'open') throw new ApiError(409, 'room_closed');
  const m = await getMember(env, room.id, userId);
  if (m?.state !== 'active') throw forbidden('not_a_member');
}

function requireStore(room: RoomRow): string {
  if (room.kind !== 'store' || !room.store_id) throw new ApiError(404, 'not_store_room');
  return room.store_id;
}

// Atomic capacity guard used inside UPDATE/INSERT ... WHERE.
const HAS_CAPACITY = `((SELECT capacity FROM rooms WHERE id = ?1) IS NULL OR
  (SELECT COUNT(*) FROM room_members WHERE room_id = ?1 AND state = 'active') < (SELECT capacity FROM rooms WHERE id = ?1))`;

async function loadStatus(env: Env, roomId: string) {
  const s = await env.DB.prepare('SELECT * FROM room_status WHERE room_id = ?')
    .bind(roomId)
    .first<{ choice: number | null; entry: number | null; waiting: number | null; vacancy: number | null; updated_at: number }>();
  return s
    ? { choice: s.choice, entry: s.entry, waiting: s.waiting, vacancy: s.vacancy, updatedAt: iso(s.updated_at) }
    : null; // null = never reported, distinct from all-zero
}

// ── List / detail ──────────────────────────────────────────────────────
rooms.get('/', async c => {
  const user = c.get('user');
  const q = parseWith(
    z.object({
      // One kind or a comma list, e.g. kind=store,general
      kind: z
        .string()
        .optional()
        .transform(s => (s ? [...new Set(s.split(',').filter(Boolean))] : []))
        .pipe(z.array(z.enum(['general', 'store', 'daily']))),
      region: z.string().max(40).optional(),
      q: z.string().trim().min(1).max(60).optional(),
      saved: z.enum(['true', 'false']).optional(),
      cursor: z.string().optional(),
    }),
    c.req.query()
  );
  const limit = parseLimit(c.req.query('limit'));
  const cur = decodeCursor<{ c: number; i: string }>(q.cursor);
  const where: string[] = [];
  const args: unknown[] = [];
  if (q.kind.length) (where.push(`r.kind IN (${q.kind.map(() => '?').join(', ')})`), args.push(...q.kind));
  if (q.saved === 'true') {
    where.push("EXISTS (SELECT 1 FROM saved_items sv WHERE sv.user_id = ? AND sv.target_type = 'room' AND sv.target_id = r.id)");
    args.push(user.id);
  }
  if (q.region) (where.push('r.region = ?'), args.push(q.region));
  if (q.q) (where.push("r.title LIKE ? ESCAPE '\\'"), args.push(likePattern(q.q)));
  if (cur) (where.push('(r.created_at < ? OR (r.created_at = ? AND r.id < ?))'), args.push(cur.c, cur.c, cur.i));
  const { results } = await c.env.DB.prepare(
    `SELECT r.*, m.state AS my_state,
            (SELECT COUNT(*) FROM room_members a WHERE a.room_id = r.id AND a.state = 'active') AS active_count,
            s.choice, s.entry, s.waiting, s.vacancy, s.updated_at AS status_updated_at,
            EXISTS (SELECT 1 FROM saved_items si WHERE si.user_id = ? AND si.target_type = 'room' AND si.target_id = r.id) AS saved
       FROM rooms r
       LEFT JOIN room_members m ON m.room_id = r.id AND m.user_id = ?
       LEFT JOIN room_status s ON s.room_id = r.id
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY r.created_at DESC, r.id DESC LIMIT ?`
  )
    .bind(user.id, user.id, ...args, limit + 1)
    .all<RoomRow & Record<string, number | string | null>>();
  const page = results.slice(0, limit);
  const last = page[page.length - 1];
  return c.json({
    items: page.map(r => ({
      id: r.id,
      kind: r.kind,
      title: r.title,
      region: r.region,
      status: r.status,
      joinPolicy: r.join_policy,
      anonymous: !!r.anonymous,
      capacity: r.capacity,
      activeCount: r.active_count,
      myState: r.my_state ?? 'none',
      saved: !!r.saved,
      liveStatus:
        r.status_updated_at == null
          ? null
          : { choice: r.choice, entry: r.entry, waiting: r.waiting, vacancy: r.vacancy, updatedAt: iso(r.status_updated_at as number) },
    })),
    nextCursor: results.length > limit && last ? encodeCursor({ c: last.created_at, i: last.id }) : null,
    hasMore: results.length > limit,
  });
});

rooms.get('/:id', async c => {
  const room = await getRoom(c.env, c.req.param('id'));
  const me = await getMember(c.env, room.id, c.get('user').id);
  const saved = await c.env.DB.prepare(
    "SELECT 1 FROM saved_items WHERE user_id = ? AND target_type = 'room' AND target_id = ?"
  )
    .bind(c.get('user').id, room.id)
    .first();
  return c.json({
    saved: saved !== null,
    id: room.id,
    kind: room.kind,
    title: room.title,
    region: room.region,
    status: room.status,
    joinPolicy: room.join_policy,
    capacity: room.capacity,
    anonymous: !!room.anonymous,
    // In 오픈톡 the client identifies its own messages by this alias, never by account id.
    myAlias: room.anonymous ? await aliasFor(c.env, room.id, c.get('user').id) : null,
    hasStoreTools: room.kind === 'store',
    myState: me?.state ?? 'none',
    myRole: me?.role ?? null,
    canManage: await isManager(c.env, room, c.get('user')),
    liveStatus: await loadStatus(c.env, room.id),
  });
});

// ── Membership ─────────────────────────────────────────────────────────
rooms.post('/:id/join', async c => {
  const user = c.get('user');
  const room = await getRoom(c.env, c.req.param('id'));
  if (room.status !== 'open') throw new ApiError(409, 'room_closed');
  const existing = await getMember(c.env, room.id, user.id);
  if (existing?.state === 'blocked') throw forbidden('blocked_from_room');
  if (existing?.state === 'active' || existing?.state === 'pending') {
    return c.json({ state: existing.state });
  }
  const now = Date.now();
  if (room.join_policy === 'open') {
    await c.env.DB.prepare(
      `INSERT INTO room_members (room_id, user_id, state, role, updated_at)
       SELECT ?1, ?2, 'active', 'member', ?3 WHERE ${HAS_CAPACITY}
       ON CONFLICT (room_id, user_id) DO UPDATE SET state = 'active', updated_at = excluded.updated_at
       WHERE room_members.state IN ('rejected', 'left')`
    )
      .bind(room.id, user.id, now)
      .run();
    const after = await getMember(c.env, room.id, user.id);
    if (after?.state !== 'active') throw new ApiError(409, 'room_full');
    await broadcast(c.env, roomChannel(room.id), { type: 'member', userId: user.id, state: 'active' });
    return c.json({ state: 'active' });
  }
  // Approval rooms: a member can only request; a manager must approve.
  await c.env.DB.prepare(
    `INSERT INTO room_members (room_id, user_id, state, role, updated_at) VALUES (?, ?, 'pending', 'member', ?)
     ON CONFLICT (room_id, user_id) DO UPDATE SET state = 'pending', updated_at = excluded.updated_at
     WHERE room_members.state IN ('rejected', 'left')`
  )
    .bind(room.id, user.id, now)
    .run();
  return c.json({ state: 'pending' }, 202);
});

rooms.post('/:id/leave', async c => {
  const user = c.get('user');
  const room = await getRoom(c.env, c.req.param('id'));
  const res = await c.env.DB.prepare(
    `UPDATE room_members SET state = 'left', updated_at = ? WHERE room_id = ? AND user_id = ? AND state IN ('active', 'pending')`
  )
    .bind(Date.now(), room.id, user.id)
    .run();
  if (res.meta.changes === 0) throw new ApiError(409, 'not_joined');
  await revoke(c.env, roomChannel(room.id), user.id, 'left');
  return c.json({ state: 'left' });
});

rooms.get('/:id/members', async c => {
  const room = await getRoom(c.env, c.req.param('id'));
  const state = parseWith(
    z.enum(['pending', 'active', 'rejected', 'left', 'blocked']).default('active'),
    c.req.query('state')
  );
  const manager = await isManager(c.env, room, c.get('user'));
  if (state !== 'active' && !manager) throw forbidden('manager_only');
  if (state === 'active' && !manager) await requireActiveMember(c.env, room, c.get('user').id);
  const { results } = await c.env.DB.prepare(
    `SELECT u.id, u.nickname, m.role, m.state, m.updated_at FROM room_members m JOIN users u ON u.id = m.user_id
      WHERE m.room_id = ? AND m.state = ? AND u.status = 'active' ORDER BY m.updated_at LIMIT 200`
  )
    .bind(room.id, state)
    .all<{ id: string; nickname: string; role: string; state: string; updated_at: number }>();
  // Managers need real accounts to moderate; other members of an anonymous room see aliases only.
  const masked = !!room.anonymous && !manager;
  const items = await Promise.all(
    results.map(async r => {
      const who = masked ? await aliasFor(c.env, room.id, r.id) : { id: r.id, nickname: r.nickname };
      return { userId: who.id, nickname: who.nickname, role: r.role, state: r.state, updatedAt: iso(r.updated_at) };
    })
  );
  return c.json({ items });
});

const TRANSITIONS: Record<string, { from: MemberState[]; to: MemberState; revoke: boolean }> = {
  approve: { from: ['pending'], to: 'active', revoke: false },
  reject: { from: ['pending'], to: 'rejected', revoke: false },
  kick: { from: ['active'], to: 'left', revoke: true },
  block: { from: ['pending', 'active', 'rejected', 'left'], to: 'blocked', revoke: true },
  unblock: { from: ['blocked'], to: 'left', revoke: false },
};

rooms.post('/:id/members/:userId', async c => {
  const user = c.get('user');
  const room = await getRoom(c.env, c.req.param('id'));
  await requireManager(c.env, room, user);
  const targetId = c.req.param('userId');
  if (targetId === user.id) throw new ApiError(400, 'cannot_moderate_self');
  const { action } = await readBody(c, z.object({ action: z.enum(['approve', 'reject', 'kick', 'block', 'unblock']) }));
  const t = TRANSITIONS[action]!;
  // ?1 new state, ?2 now, ?3 room, ?4 target, ?5 room (capacity guard), ?6.. allowed source states
  const capacityGuard = action === 'approve' ? `AND ${HAS_CAPACITY.replaceAll('?1', '?5')}` : '';
  const res = await c.env.DB.prepare(
    `UPDATE room_members SET state = ?1, updated_at = ?2 WHERE room_id = ?3 AND user_id = ?4
       AND state IN (${t.from.map((_, i) => `?${i + 6}`).join(', ')}) ${capacityGuard}`
  )
    .bind(t.to, Date.now(), room.id, targetId, room.id, ...t.from)
    .run();
  if (res.meta.changes === 0) {
    const m = await getMember(c.env, room.id, targetId);
    if (action === 'approve' && m?.state === 'pending') throw new ApiError(409, 'room_full');
    // Block also applies to users who never joined.
    if (action === 'block' && !m) {
      await c.env.DB.prepare(
        `INSERT INTO room_members (room_id, user_id, state, role, updated_at) VALUES (?, ?, 'blocked', 'member', ?)`
      )
        .bind(room.id, targetId, Date.now())
        .run();
      return c.json({ userId: targetId, state: 'blocked' });
    }
    throw new ApiError(409, 'invalid_transition', `cannot ${action} from ${m?.state ?? 'none'}`);
  }
  if (t.revoke) await revoke(c.env, roomChannel(room.id), targetId, action);
  await broadcast(c.env, roomChannel(room.id), { type: 'member', userId: targetId, state: t.to });
  return c.json({ userId: targetId, state: t.to });
});

rooms.post('/:id/close', async c => {
  const room = await getRoom(c.env, c.req.param('id'));
  await requireManager(c.env, room, c.get('user'));
  await c.env.DB.prepare("UPDATE rooms SET status = 'closed' WHERE id = ?").bind(room.id).run();
  await hubFor(c.env, roomChannel(room.id)).closeAll('room_closed');
  return c.json({ status: 'closed' });
});

// ── Live status counters (실시간현황) ─────────────────────────────────
const count = z.number().int().min(0).max(9999).nullable();
rooms.put('/:id/status', async c => {
  const user = c.get('user');
  const room = await getRoom(c.env, c.req.param('id'));
  await requireManager(c.env, room, user);
  const s = await readBody(c, z.object({ choice: count, entry: count, waiting: count, vacancy: count }));
  const now = Date.now();
  await c.env.DB.prepare(
    `INSERT INTO room_status (room_id, choice, entry, waiting, vacancy, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (room_id) DO UPDATE SET choice = excluded.choice, entry = excluded.entry, waiting = excluded.waiting,
       vacancy = excluded.vacancy, updated_at = excluded.updated_at, updated_by = excluded.updated_by`
  )
    .bind(room.id, s.choice, s.entry, s.waiting, s.vacancy, now, user.id)
    .run();
  const status = { ...s, updatedAt: iso(now) };
  await Promise.all([
    broadcast(c.env, roomChannel(room.id), { type: 'status', roomId: room.id, status }),
    broadcast(c.env, 'status', { type: 'status', roomId: room.id, status }),
  ]);
  await notifySavers(c.env, room, status, user.id);
  return c.json(status);
});

/**
 * 의뢰서 ⑤ "찜한 가게 소식": tell users who saved (찜) this room that its numbers changed.
 * At most one notification per user per room every 10 minutes, so frequent counter edits
 * do not spam. TODO(scale): move to a Queue when saver counts grow.
 */
const SAVED_THROTTLE_MS = 10 * 60_000;
async function notifySavers(
  env: Env,
  room: RoomRow,
  status: { waiting?: number | null; vacancy?: number | null } | null,
  actorId: string
) {
  const link = `/rooms/${room.id}`;
  const { results } = await env.DB.prepare(
    `SELECT s.user_id FROM saved_items s JOIN users u ON u.id = s.user_id
      WHERE s.target_type = 'room' AND s.target_id = ? AND s.user_id <> ? AND u.status = 'active'
        AND NOT EXISTS (SELECT 1 FROM notifications n WHERE n.user_id = s.user_id AND n.type = 'saved' AND n.link = ? AND n.created_at > ?)`
  )
    .bind(room.id, actorId, link, Date.now() - SAVED_THROTTLE_MS)
    .all<{ user_id: string }>();
  const dash = (n: number | null | undefined) => (n == null ? '—' : String(n));
  for (const r of results) {
    await notify(env, {
      userId: r.user_id,
      type: 'saved',
      title: `찜한 가게 현황: ${room.title}`,
      body: `대기 ${dash(status?.waiting)} · 빈방 ${dash(status?.vacancy)}`,
      link,
    });
  }
}

/** Output identity for a sender: alias in 오픈톡, account otherwise. */
async function senderView(env: Env, room: RoomRow, senderId: string, nickname: string) {
  return room.anonymous ? aliasFor(env, room.id, senderId) : { id: senderId, nickname };
}

// ── Messages ───────────────────────────────────────────────────────────
rooms.get('/:id/messages', async c => {
  const user = c.get('user');
  const room = await getRoom(c.env, c.req.param('id'));
  await requireActiveMember(c.env, room, user.id);
  const q = parseWith(
    z.object({ afterSeq: z.coerce.number().int().min(0).optional(), beforeSeq: z.coerce.number().int().min(1).optional() }),
    c.req.query()
  );
  const limit = parseLimit(c.req.query('limit'), 50, 200);
  // afterSeq: ascending backfill after reconnect. Otherwise newest page, optionally before a seq.
  const asc = q.afterSeq !== undefined;
  const { results } = await c.env.DB.prepare(
    `SELECT m.seq, m.id, m.sender_id, u.nickname, m.body, m.media_id, m.created_at
       FROM room_messages m JOIN users u ON u.id = m.sender_id
      WHERE m.room_id = ? AND ${asc ? 'm.seq > ?' : 'm.seq < ?'}
        AND NOT EXISTS (SELECT 1 FROM blocks b WHERE b.blocker_id = ? AND b.blocked_id = m.sender_id)
      ORDER BY m.seq ${asc ? 'ASC' : 'DESC'} LIMIT ?`
  )
    .bind(room.id, asc ? q.afterSeq : (q.beforeSeq ?? Number.MAX_SAFE_INTEGER), user.id, limit + 1)
    .all<Parameters<typeof toMessage>[0] & { nickname: string }>();
  const page = results.slice(0, limit);
  if (!asc) page.reverse();
  const who = new Map<string, { id: string; nickname: string }>();
  for (const r of page) if (!who.has(r.sender_id)) who.set(r.sender_id, await senderView(c.env, room, r.sender_id, r.nickname));
  return c.json({
    items: page.map(r => {
      const w = who.get(r.sender_id)!;
      return { ...toMessage(r), senderId: w.id, senderNickname: w.nickname };
    }),
    hasMore: results.length > limit,
  });
});

rooms.post('/:id/messages', async c => {
  const user = c.get('user');
  const room = await getRoom(c.env, c.req.param('id'));
  await requireActiveMember(c.env, room, user.id);
  const input = await readBody(c, sendSchema);
  if (input.mediaId) await assertOwnMedia(c.env, input.mediaId, user.id);
  const { message, duplicate } = await insertMessage(c.env, 'room_messages', room.id, user.id, input);
  const w = await senderView(c.env, room, user.id, user.nickname);
  const out = { ...message, senderId: w.id, senderNickname: w.nickname };
  if (!duplicate) await broadcast(c.env, roomChannel(room.id), { type: 'message', roomId: room.id, message: out });
  return c.json({ message: out, duplicate }, duplicate ? 200 : 201);
});

// ── F07 Store-room tools: 가격표 / 용어 / 담당 찾기 / 빈방 기록 ──────────
rooms.get('/:id/tools', async c => {
  const room = await getRoom(c.env, c.req.param('id'));
  const storeId = requireStore(room);
  const [prices, terms, vacancy] = await c.env.DB.batch([
    c.env.DB.prepare('SELECT label, amount, note FROM store_prices WHERE store_id = ? ORDER BY sort').bind(storeId),
    c.env.DB.prepare('SELECT term, definition FROM store_terms WHERE store_id = ? ORDER BY sort').bind(storeId),
    c.env.DB.prepare(
      `SELECT v.vacancy, v.note, v.created_at, u.nickname FROM vacancy_logs v JOIN users u ON u.id = v.recorded_by
        WHERE v.store_id = ? ORDER BY v.created_at DESC LIMIT 20`
    ).bind(storeId),
  ]);
  const logs = (vacancy!.results as { vacancy: number; note: string | null; created_at: number; nickname: string }[]).map(
    v => ({ vacancy: v.vacancy, note: v.note, recordedBy: v.nickname, recordedAt: iso(v.created_at) })
  );
  return c.json({
    storeId,
    prices: prices!.results, // amount null = 문의/미정 (not 0)
    terms: terms!.results,
    vacancy: { latest: logs[0] ?? null, history: logs },
    canEdit: await isStoreOperator(c.env, room, c.get('user')),
  });
});

async function requireOperator(env: Env, room: RoomRow, user: AuthUser) {
  const storeId = requireStore(room);
  if (!(await isStoreOperator(env, room, user))) throw forbidden('store_operator_only');
  return storeId;
}

rooms.put('/:id/tools/prices', async c => {
  const room = await getRoom(c.env, c.req.param('id'));
  const storeId = await requireOperator(c.env, room, c.get('user'));
  const { items } = await readBody(
    c,
    z.object({
      items: z
        .array(
          z.object({
            label: z.string().trim().min(1).max(40),
            amount: z.number().int().min(0).max(100_000_000).nullable(),
            note: z.string().trim().max(100).nullable().optional(),
          })
        )
        .max(50),
    })
  );
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM store_prices WHERE store_id = ?').bind(storeId),
    ...items.map((p, i) =>
      c.env.DB.prepare('INSERT INTO store_prices (id, store_id, label, amount, note, sort) VALUES (?, ?, ?, ?, ?, ?)').bind(
        newId(), storeId, p.label, p.amount, p.note ?? null, i
      )
    ),
  ]);
  await broadcast(c.env, roomChannel(room.id), { type: 'tools', roomId: room.id, section: 'prices' });
  return c.json({ items: items.map(p => ({ label: p.label, amount: p.amount, note: p.note ?? null })) });
});

rooms.put('/:id/tools/terms', async c => {
  const room = await getRoom(c.env, c.req.param('id'));
  const storeId = await requireOperator(c.env, room, c.get('user'));
  const { items } = await readBody(
    c,
    z.object({
      items: z
        .array(z.object({ term: z.string().trim().min(1).max(40), definition: z.string().trim().min(1).max(300) }))
        .max(100),
    })
  );
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM store_terms WHERE store_id = ?').bind(storeId),
    ...items.map((t, i) =>
      c.env.DB.prepare('INSERT INTO store_terms (id, store_id, term, definition, sort) VALUES (?, ?, ?, ?, ?)').bind(
        newId(), storeId, t.term, t.definition, i
      )
    ),
  ]);
  await broadcast(c.env, roomChannel(room.id), { type: 'tools', roomId: room.id, section: 'terms' });
  return c.json({ items });
});

rooms.post('/:id/tools/vacancy', async c => {
  const user = c.get('user');
  const room = await getRoom(c.env, c.req.param('id'));
  const storeId = await requireOperator(c.env, room, user);
  const v = await readBody(
    c,
    z.object({ vacancy: z.number().int().min(0).max(9999), note: z.string().trim().max(100).optional() })
  );
  const now = Date.now();
  await c.env.DB.batch([
    c.env.DB.prepare(
      'INSERT INTO vacancy_logs (id, store_id, vacancy, note, recorded_by, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).bind(newId(), storeId, v.vacancy, v.note ?? null, user.id, now),
    c.env.DB.prepare(
      `INSERT INTO room_status (room_id, vacancy, updated_at, updated_by) VALUES (?, ?, ?, ?)
       ON CONFLICT (room_id) DO UPDATE SET vacancy = excluded.vacancy, updated_at = excluded.updated_at, updated_by = excluded.updated_by`
    ).bind(room.id, v.vacancy, now, user.id),
  ]);
  const status = await loadStatus(c.env, room.id);
  await Promise.all([
    broadcast(c.env, roomChannel(room.id), { type: 'status', roomId: room.id, status }),
    broadcast(c.env, 'status', { type: 'status', roomId: room.id, status }),
  ]);
  await notifySavers(c.env, room, status, user.id);
  return c.json({ vacancy: v.vacancy, note: v.note ?? null, recordedAt: iso(now) }, 201);
});

// ── F08 Staff profiles + last seen (담당 찾기) ────────────────────────
rooms.get('/:id/staff', async c => {
  const viewer = c.get('user');
  const room = await getRoom(c.env, c.req.param('id'));
  const storeId = requireStore(room);
  const { results } = await c.env.DB.prepare(
    `SELECT u.id, u.nickname, s.title, u.show_last_seen, u.last_seen_at
       FROM store_staff s JOIN users u ON u.id = s.user_id
      WHERE s.store_id = ? AND u.status = 'active'
        AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker_id = ?2 AND b.blocked_id = u.id) OR (b.blocker_id = u.id AND b.blocked_id = ?2))
      ORDER BY s.title, u.nickname`
  )
    .bind(storeId, viewer.id)
    .all<{ id: string; nickname: string; title: string; show_last_seen: number; last_seen_at: number | null }>();
  return c.json({
    items: results.map(s => ({
      userId: s.id,
      nickname: s.nickname,
      title: s.title,
      // Only exposed with the staff member's opt-in. 'hidden' ≠ 'never seen'.
      lastSeen: s.show_last_seen ? { visible: true, at: iso(s.last_seen_at) } : { visible: false, at: null },
    })),
  });
});
