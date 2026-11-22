import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv, Env } from '../env';
import { isBlockedEitherWay, requireAuth } from '../lib/auth';
import { ApiError, forbidden, iso, newId, notFound, parseLimit, parseWith, readBody } from '../lib/http';
import { assertOwnMedia, insertMessage, sendSchema, toMessage } from '../lib/messages';
import { notify } from '../lib/notify';
import { broadcast, type Channel } from '../lib/realtime';

/**
 * F04 — anonymous, consent-based 1:1 DM.
 * request (from a post or profile) → recipient accepts/rejects, or sender cancels
 * → only the two accepted participants can read/send. Blocks stop new requests
 * and sending in both directions. A pair has at most one conversation.
 */
export const dm = new Hono<AppEnv>();
dm.use('*', requireAuth);

interface RequestRow {
  id: string;
  from_user: string;
  to_user: string;
  post_id: string | null;
  message: string | null;
  status: 'pending' | 'accepted' | 'rejected' | 'cancelled';
  conversation_id: string | null;
  created_at: number;
  decided_at: number | null;
}

interface ConvRow {
  id: string;
  user_a: string;
  user_b: string;
  created_at: number;
}

const dmChannel = (id: string): Channel => `dm:${id}`;
const sortPair = (a: string, b: string): [string, string] => (a < b ? [a, b] : [b, a]);

async function findConversation(env: Env, a: string, b: string) {
  const [x, y] = sortPair(a, b);
  return env.DB.prepare('SELECT * FROM dm_conversations WHERE user_a = ? AND user_b = ?').bind(x, y).first<ConvRow>();
}

async function getParticipantConversation(env: Env, id: string, userId: string): Promise<ConvRow & { other: string }> {
  const conv = await env.DB.prepare('SELECT * FROM dm_conversations WHERE id = ?').bind(id).first<ConvRow>();
  if (!conv) throw notFound('conversation');
  if (conv.user_a !== userId && conv.user_b !== userId) throw forbidden('not_a_participant');
  return { ...conv, other: conv.user_a === userId ? conv.user_b : conv.user_a };
}

const requestOut = (r: RequestRow, nick: Record<string, string>) => ({
  id: r.id,
  fromUser: { id: r.from_user, nickname: nick[r.from_user] ?? null },
  toUser: { id: r.to_user, nickname: nick[r.to_user] ?? null },
  postId: r.post_id,
  message: r.message,
  status: r.status,
  conversationId: r.conversation_id,
  createdAt: iso(r.created_at),
  decidedAt: iso(r.decided_at),
});

async function nicknames(env: Env, ids: string[]): Promise<Record<string, string>> {
  const uniq = [...new Set(ids)];
  if (!uniq.length) return {};
  const { results } = await env.DB.prepare(
    `SELECT id, nickname FROM users WHERE id IN (${uniq.map(() => '?').join(',')})`
  )
    .bind(...uniq)
    .all<{ id: string; nickname: string }>();
  return Object.fromEntries(results.map(r => [r.id, r.nickname]));
}

// ── Requests ───────────────────────────────────────────────────────────
dm.post('/requests', async c => {
  const me = c.get('user');
  const input = await readBody(
    c,
    z
      .object({
        toUserId: z.string().max(64).optional(),
        postId: z.string().max(64).optional(), // F09: "DM from post" targets the post author
        message: z.string().trim().max(200).optional(),
      })
      .refine(v => !!v.toUserId !== !!v.postId, 'exactly one of toUserId or postId')
  );
  let toUserId = input.toUserId;
  if (input.postId) {
    const post = await c.env.DB.prepare('SELECT author_id FROM posts WHERE id = ? AND deleted_at IS NULL')
      .bind(input.postId)
      .first<{ author_id: string }>();
    if (!post) throw notFound('post');
    toUserId = post.author_id;
  }
  if (toUserId === me.id) throw new ApiError(400, 'cannot_dm_self');
  const target = await c.env.DB.prepare("SELECT id FROM users WHERE id = ? AND status = 'active'").bind(toUserId).first();
  if (!target) throw notFound('user');
  if (await isBlockedEitherWay(c.env, me.id, toUserId!)) throw forbidden('blocked');

  const conv = await findConversation(c.env, me.id, toUserId!);
  if (conv) throw new ApiError(409, 'conversation_exists', undefined, { conversationId: conv.id });
  const reverse = await c.env.DB.prepare(
    "SELECT id FROM dm_requests WHERE from_user = ? AND to_user = ? AND status = 'pending'"
  )
    .bind(toUserId, me.id)
    .first<{ id: string }>();
  if (reverse) throw new ApiError(409, 'reverse_request_pending', 'they already sent you a request', { requestId: reverse.id });

  const id = newId();
  const now = Date.now();
  try {
    await c.env.DB.prepare(
      `INSERT INTO dm_requests (id, from_user, to_user, post_id, message, status, created_at) VALUES (?, ?, ?, ?, ?, 'pending', ?)`
    )
      .bind(id, me.id, toUserId, input.postId ?? null, input.message ?? null, now)
      .run();
  } catch (e) {
    if (String(e).includes('UNIQUE')) throw new ApiError(409, 'request_already_pending');
    throw e;
  }
  await notify(c.env, { userId: toUserId!, type: 'dm', title: '새 1:1 대화 신청', body: null, link: `/dm/requests/${id}`, sensitive: true });
  const row = await c.env.DB.prepare('SELECT * FROM dm_requests WHERE id = ?').bind(id).first<RequestRow>();
  return c.json(requestOut(row!, await nicknames(c.env, [me.id, toUserId!])), 201);
});

dm.get('/requests', async c => {
  const me = c.get('user');
  const box = parseWith(z.enum(['received', 'sent']).default('received'), c.req.query('box'));
  const status = parseWith(z.enum(['pending', 'accepted', 'rejected', 'cancelled']).optional(), c.req.query('status'));
  const { results } = await c.env.DB.prepare(
    `SELECT * FROM dm_requests WHERE ${box === 'received' ? 'to_user' : 'from_user'} = ? ${status ? 'AND status = ?' : ''}
      ORDER BY created_at DESC LIMIT 100`
  )
    .bind(...(status ? [me.id, status] : [me.id]))
    .all<RequestRow>();
  const nick = await nicknames(c.env, results.flatMap(r => [r.from_user, r.to_user]));
  return c.json({ items: results.map(r => requestOut(r, nick)) });
});

async function loadRequest(env: Env, id: string) {
  const r = await env.DB.prepare('SELECT * FROM dm_requests WHERE id = ?').bind(id).first<RequestRow>();
  if (!r) throw notFound('request');
  return r;
}

dm.post('/requests/:id/accept', async c => {
  const me = c.get('user');
  const req = await loadRequest(c.env, c.req.param('id'));
  if (req.to_user !== me.id) throw forbidden('recipient_only');
  // Idempotent: accepting twice returns the same conversation.
  if (req.status === 'accepted') return c.json({ status: 'accepted', conversationId: req.conversation_id });
  if (req.status !== 'pending') throw new ApiError(409, 'invalid_transition', `request is ${req.status}`);
  if (await isBlockedEitherWay(c.env, req.from_user, req.to_user)) throw forbidden('blocked');

  const [a, b] = sortPair(req.from_user, req.to_user);
  const now = Date.now();
  // UNIQUE(user_a, user_b) guarantees one conversation per pair even under races.
  const [, convRes] = await c.env.DB.batch([
    c.env.DB.prepare('INSERT OR IGNORE INTO dm_conversations (id, user_a, user_b, created_at) VALUES (?, ?, ?, ?)').bind(
      newId(), a, b, now
    ),
    c.env.DB.prepare('SELECT id FROM dm_conversations WHERE user_a = ? AND user_b = ?').bind(a, b),
  ]);
  const conversationId = (convRes!.results[0] as { id: string }).id;
  const upd = await c.env.DB.prepare(
    "UPDATE dm_requests SET status = 'accepted', conversation_id = ?, decided_at = ? WHERE id = ? AND status = 'pending'"
  )
    .bind(conversationId, now, req.id)
    .run();
  if (upd.meta.changes === 0) {
    const again = await loadRequest(c.env, req.id);
    if (again.status !== 'accepted') throw new ApiError(409, 'invalid_transition', `request is ${again.status}`);
  }
  await notify(c.env, { userId: req.from_user, type: 'dm', title: '1:1 대화 신청이 수락되었습니다', link: `/dm/${conversationId}`, sensitive: true });
  return c.json({ status: 'accepted', conversationId });
});

async function decide(env: Env, id: string, userId: string, who: 'to_user' | 'from_user', to: 'rejected' | 'cancelled') {
  const req = await loadRequest(env, id);
  if (req[who] !== userId) throw forbidden(who === 'to_user' ? 'recipient_only' : 'sender_only');
  const upd = await env.DB.prepare(`UPDATE dm_requests SET status = ?, decided_at = ? WHERE id = ? AND status = 'pending'`)
    .bind(to, Date.now(), id)
    .run();
  if (upd.meta.changes === 0) throw new ApiError(409, 'invalid_transition', `request is ${req.status}`);
  return { status: to };
}

dm.post('/requests/:id/reject', async c => c.json(await decide(c.env, c.req.param('id'), c.get('user').id, 'to_user', 'rejected')));
dm.post('/requests/:id/cancel', async c => c.json(await decide(c.env, c.req.param('id'), c.get('user').id, 'from_user', 'cancelled')));

// ── Conversations ──────────────────────────────────────────────────────
dm.get('/conversations', async c => {
  const me = c.get('user');
  const { results } = await c.env.DB.prepare(
    `SELECT c.id, c.created_at,
            CASE WHEN c.user_a = ?1 THEN c.user_b ELSE c.user_a END AS other_id,
            u.nickname AS other_nickname,
            lm.body AS last_body, lm.media_id AS last_media, lm.created_at AS last_at, lm.seq AS last_seq,
            (SELECT COUNT(*) FROM dm_messages x WHERE x.conversation_id = c.id AND x.sender_id <> ?1
               AND x.seq > COALESCE((SELECT last_read_seq FROM dm_reads r WHERE r.conversation_id = c.id AND r.user_id = ?1), 0)) AS unread,
            EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker_id = ?1 AND b.blocked_id = u.id) OR (b.blocker_id = u.id AND b.blocked_id = ?1)) AS blocked
       FROM dm_conversations c
       JOIN users u ON u.id = CASE WHEN c.user_a = ?1 THEN c.user_b ELSE c.user_a END
       LEFT JOIN dm_messages lm ON lm.seq = (SELECT MAX(seq) FROM dm_messages WHERE conversation_id = c.id)
      WHERE c.user_a = ?1 OR c.user_b = ?1
      ORDER BY COALESCE(lm.created_at, c.created_at) DESC LIMIT 100`
  )
    .bind(me.id)
    .all<Record<string, string | number | null>>();
  return c.json({
    items: results.map(r => ({
      id: r.id,
      other: { id: r.other_id, nickname: r.other_nickname },
      lastMessage: r.last_seq == null ? null : { seq: r.last_seq, body: r.last_body, hasMedia: r.last_media != null, createdAt: iso(r.last_at as number) },
      unread: r.unread,
      blocked: !!r.blocked,
    })),
  });
});

dm.get('/conversations/:id/messages', async c => {
  const me = c.get('user');
  const conv = await getParticipantConversation(c.env, c.req.param('id'), me.id);
  const afterSeq = parseWith(z.coerce.number().int().min(0).optional(), c.req.query('afterSeq'));
  const beforeSeq = parseWith(z.coerce.number().int().min(1).optional(), c.req.query('beforeSeq'));
  const limit = parseLimit(c.req.query('limit'), 50, 200);
  const asc = afterSeq !== undefined;
  const { results } = await c.env.DB.prepare(
    `SELECT seq, id, sender_id, body, media_id, created_at FROM dm_messages
      WHERE conversation_id = ? AND ${asc ? 'seq > ?' : 'seq < ?'} ORDER BY seq ${asc ? 'ASC' : 'DESC'} LIMIT ?`
  )
    .bind(conv.id, asc ? afterSeq : (beforeSeq ?? Number.MAX_SAFE_INTEGER), limit + 1)
    .all<Parameters<typeof toMessage>[0]>();
  const page = results.slice(0, limit);
  if (!asc) page.reverse();
  const otherRead = await c.env.DB.prepare('SELECT last_read_seq FROM dm_reads WHERE conversation_id = ? AND user_id = ?')
    .bind(conv.id, conv.other)
    .first<{ last_read_seq: number }>();
  const readSeq = otherRead?.last_read_seq ?? 0;
  return c.json({
    items: page.map(m => ({ ...toMessage(m), readByOther: m.sender_id === me.id && m.seq <= readSeq })),
    otherLastReadSeq: readSeq,
    hasMore: results.length > limit,
  });
});

dm.post('/conversations/:id/messages', async c => {
  const me = c.get('user');
  const conv = await getParticipantConversation(c.env, c.req.param('id'), me.id);
  if (await isBlockedEitherWay(c.env, me.id, conv.other)) throw forbidden('blocked');
  const input = await readBody(c, sendSchema);
  if (input.mediaId) await assertOwnMedia(c.env, input.mediaId, me.id);
  const { message, duplicate } = await insertMessage(c.env, 'dm_messages', conv.id, me.id, input);
  if (!duplicate) {
    await broadcast(c.env, dmChannel(conv.id), { type: 'message', conversationId: conv.id, message });
    // DM bodies are private: never in the inbox or push payload.
    await notify(c.env, { userId: conv.other, type: 'dm', title: '새 메시지', link: `/dm/${conv.id}`, sensitive: true });
  }
  return c.json({ message, duplicate }, duplicate ? 200 : 201);
});

dm.post('/conversations/:id/read', async c => {
  const me = c.get('user');
  const conv = await getParticipantConversation(c.env, c.req.param('id'), me.id);
  const { seq } = await readBody(c, z.object({ seq: z.number().int().min(0) }));
  const maxSeq = await c.env.DB.prepare('SELECT COALESCE(MAX(seq), 0) AS m FROM dm_messages WHERE conversation_id = ?')
    .bind(conv.id)
    .first<{ m: number }>();
  const capped = Math.min(seq, maxSeq!.m);
  // Read position only moves forward.
  await c.env.DB.prepare(
    `INSERT INTO dm_reads (conversation_id, user_id, last_read_seq, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT (conversation_id, user_id) DO UPDATE SET last_read_seq = MAX(last_read_seq, excluded.last_read_seq), updated_at = excluded.updated_at`
  )
    .bind(conv.id, me.id, capped, Date.now())
    .run();
  const now = await c.env.DB.prepare('SELECT last_read_seq FROM dm_reads WHERE conversation_id = ? AND user_id = ?')
    .bind(conv.id, me.id)
    .first<{ last_read_seq: number }>();
  await broadcast(c.env, dmChannel(conv.id), { type: 'read', conversationId: conv.id, userId: me.id, seq: now!.last_read_seq });
  return c.json({ lastReadSeq: now!.last_read_seq });
});
