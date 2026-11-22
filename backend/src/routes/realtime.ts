import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../env';
import { requireAuth } from '../lib/auth';
import { randomToken, sha256Hex } from '../lib/crypto';
import { ApiError, forbidden, iso, readBody } from '../lib/http';
import { canSubscribe, hubFor, isChannel } from '../lib/realtime';

const TICKET_TTL_MS = 30_000;

export const realtime = new Hono<AppEnv>();

/**
 * Step 1: authenticated client asks for a short-lived single-use ticket.
 * Browsers cannot set Authorization on a WebSocket, so the bearer token is never
 * put in a URL; only this 30-second ticket is.
 */
realtime.post('/tickets', requireAuth, async c => {
  const { channel } = await readBody(c, z.object({ channel: z.string().max(80) }));
  if (!isChannel(channel)) throw new ApiError(400, 'invalid_channel');
  const user = c.get('user');
  if (!(await canSubscribe(c.env, channel, user.id))) throw forbidden('not_a_member');
  const ticket = randomToken(24);
  const expiresAt = Date.now() + TICKET_TTL_MS;
  await c.env.DB.prepare(
    'INSERT INTO realtime_tickets (ticket_hash, user_id, channel, expires_at) VALUES (?, ?, ?, ?)'
  )
    .bind(await sha256Hex(ticket), user.id, channel, expiresAt)
    .run();
  return c.json({ ticket, channel, expiresAt: iso(expiresAt) }, 201);
});

/** Step 2: open `GET /realtime/ws?ticket=...` with an Upgrade: websocket header. */
realtime.get('/ws', async c => {
  if (c.req.header('Upgrade') !== 'websocket') throw new ApiError(426, 'upgrade_required');
  const ticket = c.req.query('ticket');
  if (!ticket) throw new ApiError(401, 'ticket_required');
  const now = Date.now();
  // Atomic redeem: a ticket works exactly once, and only before it expires.
  const row = await c.env.DB.prepare(
    `UPDATE realtime_tickets SET used_at = ?
      WHERE ticket_hash = ? AND used_at IS NULL AND expires_at > ?
      RETURNING user_id, channel`
  )
    .bind(now, await sha256Hex(ticket), now)
    .first<{ user_id: string; channel: string }>();
  if (!row || !isChannel(row.channel)) throw new ApiError(401, 'ticket_invalid');
  // Membership may have been revoked between issuing and redeeming.
  if (!(await canSubscribe(c.env, row.channel, row.user_id))) throw forbidden('not_a_member');

  const headers = new Headers(c.req.raw.headers);
  headers.set('X-Hub-User', row.user_id);
  return hubFor(c.env, row.channel).fetch(new Request(c.req.raw.url, { headers }));
});
