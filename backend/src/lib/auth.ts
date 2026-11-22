import type { MiddlewareHandler } from 'hono';
import type { AppEnv, AuthUser, Env } from '../env';
import { sha256Hex } from './crypto';
import { ApiError } from './http';

const LAST_SEEN_THROTTLE_MS = 60_000;

/**
 * Bearer-token session auth. The production login (phone verification via
 * PortOne/KCP, OAuth) is NOT implemented here — see README "F01". Sessions are
 * created by /auth/dev-login in development only.
 */
export const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const header = c.req.header('Authorization');
  if (!header?.startsWith('Bearer ')) throw new ApiError(401, 'unauthenticated');
  const hash = await sha256Hex(header.slice(7).trim());
  const now = Date.now();
  const row = await c.env.DB.prepare(
    `SELECT s.id AS session_id, u.id, u.nickname, u.role, u.last_seen_at
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > ? AND u.status = 'active'`
  )
    .bind(hash, now)
    .first<AuthUser & { session_id: string; last_seen_at: number | null }>();
  if (!row) throw new ApiError(401, 'unauthenticated');

  // F08: "최근 접속" = last authenticated API activity, throttled to one write per minute.
  if (row.last_seen_at == null || now - row.last_seen_at > LAST_SEEN_THROTTLE_MS) {
    await c.env.DB.prepare('UPDATE users SET last_seen_at = ? WHERE id = ?').bind(now, row.id).run();
  }

  c.set('user', { id: row.id, nickname: row.nickname, role: row.role });
  c.set('sessionId', row.session_id);
  await next();
};

export async function isBlockedEitherWay(env: Env, a: string, b: string): Promise<boolean> {
  const r = await env.DB.prepare(
    `SELECT 1 FROM blocks WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?) LIMIT 1`
  )
    .bind(a, b, b, a)
    .first();
  return r !== null;
}
