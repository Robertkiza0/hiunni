import type { Env } from '../env';

/**
 * F05 push delivery: push_outbox → Firebase Cloud Messaging (HTTP v1).
 *
 * One sender for both platforms. Android tokens come from FCM directly; iPhones reach FCM once
 * the app registers through Firebase Messaging and the client's APNs key is uploaded to the
 * Firebase console (Apple's key never touches this Worker). See README "F05".
 *
 * Configuration: the secret FCM_SERVICE_ACCOUNT holds the service-account JSON of the client's
 * Firebase project (`wrangler secret put FCM_SERVICE_ACCOUNT`). Without it nothing is sent and rows
 * stay 'pending', exactly as before.
 *
 * Runs from the cron trigger (every minute) and right after any write request (index.ts), so a
 * comment or DM usually reaches the phone within a second or two.
 */

const BATCH = 50;
const MAX_ATTEMPTS = 5;
/** Notifications older than this are dropped instead of arriving late. */
const MAX_AGE_MS = 24 * 3600_000;
const CLAIM_MS = 60_000;
const AUTH_PAUSE_MS = 5 * 60_000;

export interface FcmConfig {
  projectId: string;
  clientEmail: string;
  privateKey: string;
}

export function fcmConfig(env: Pick<Env, 'FCM_SERVICE_ACCOUNT'>): FcmConfig | null {
  const raw = env.FCM_SERVICE_ACCOUNT;
  if (!raw) return null;
  try {
    const j = JSON.parse(raw);
    if (!j.project_id || !j.client_email || !j.private_key) return null;
    return { projectId: j.project_id, clientEmail: j.client_email, privateKey: j.private_key };
  } catch {
    return null;
  }
}

// ── Google OAuth access token (service-account JWT, RS256) ─────────────────
const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64urlText = (s: string) => b64url(new TextEncoder().encode(s));

function pemToDer(pem: string): ArrayBuffer {
  const bin = atob(pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, ''));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

let cachedToken: { email: string; token: string; exp: number } | null = null;
/** Test hook: forget the cached access token. */
export const resetPushTokenCache = () => {
  cachedToken = null;
};

async function accessToken(cfg: FcmConfig, fetchFn: typeof fetch, now: number): Promise<string> {
  if (cachedToken && cachedToken.email === cfg.clientEmail && cachedToken.exp - 60_000 > now) return cachedToken.token;
  const iat = Math.floor(now / 1000);
  const header = b64urlText(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64urlText(
    JSON.stringify({
      iss: cfg.clientEmail,
      scope: 'https://www.googleapis.com/auth/firebase.messaging',
      aud: 'https://oauth2.googleapis.com/token',
      iat,
      exp: iat + 3600,
    })
  );
  const key = await crypto.subtle.importKey('pkcs8', pemToDer(cfg.privateKey), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(`${header}.${claims}`)));
  const res = await fetchFn('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${header}.${claims}.${b64url(sig)}` }),
  });
  if (!res.ok) throw new AuthError(`oauth_${res.status}`);
  const j = (await res.json()) as { access_token: string; expires_in?: number };
  cachedToken = { email: cfg.clientEmail, token: j.access_token, exp: now + (j.expires_in ?? 3600) * 1000 };
  return j.access_token;
}

class AuthError extends Error {}

// ── Outbox drain ───────────────────────────────────────────────────────────
interface Row {
  id: string;
  device_token_id: string;
  platform: string;
  payload: string;
  attempts: number;
  token: string | null;
}

export interface DrainResult {
  configured: boolean;
  sent: number;
  failed: number;
  retry: number;
  expired: number;
  removedTokens: number;
  paused?: string;
}

const backoffMs = (attempts: number) => Math.min(30_000 * 2 ** (attempts - 1), 30 * 60_000);

function fcmMessage(row: Row) {
  const p = JSON.parse(row.payload) as { title: string; body: string; link: string | null; notificationId: string };
  return {
    message: {
      token: row.token,
      notification: { title: p.title, body: p.body },
      // Data values must be strings; the app opens `link` when the notification is tapped.
      data: { link: p.link ?? '', notificationId: p.notificationId },
      android: { priority: 'HIGH', notification: { sound: 'default', tag: p.notificationId } },
      apns: { headers: { 'apns-priority': '10' }, payload: { aps: { sound: 'default' } } },
    },
  };
}

/** FCM's error code from a v1 error body (UNREGISTERED, INVALID_ARGUMENT, QUOTA_EXCEEDED, …). */
async function fcmErrorCode(res: Response): Promise<string> {
  try {
    const j = (await res.json()) as { error?: { status?: string; details?: { errorCode?: string }[] } };
    return j.error?.details?.find(d => d.errorCode)?.errorCode ?? j.error?.status ?? `http_${res.status}`;
  } catch {
    return `http_${res.status}`;
  }
}

export async function drainOutbox(
  env: Env,
  opts: { fetch?: typeof fetch; now?: number; limit?: number } = {}
): Promise<DrainResult> {
  const out: DrainResult = { configured: false, sent: 0, failed: 0, retry: 0, expired: 0, removedTokens: 0 };
  const cfg = fcmConfig(env);
  if (!cfg) return out;
  out.configured = true;
  const fetchFn = opts.fetch ?? fetch;
  const now = opts.now ?? Date.now();
  const db = env.DB;

  // Too old to be useful: drop instead of buzzing the phone a day later.
  const exp = await db
    .prepare("UPDATE push_outbox SET status = 'failed', last_error = 'expired' WHERE status = 'pending' AND created_at < ?")
    .bind(now - MAX_AGE_MS)
    .run();
  out.expired = exp.meta.changes ?? 0;

  // Claim a batch atomically (D1 runs one write at a time), so concurrent senders never overlap.
  const { results: rows } = await db
    .prepare(
      `UPDATE push_outbox SET claim_until = ?1 + ${CLAIM_MS}, attempts = attempts + 1
       WHERE id IN (SELECT id FROM push_outbox
                    WHERE status = 'pending' AND next_attempt_at <= ?1 AND claim_until < ?1
                    ORDER BY created_at LIMIT ?2)
       RETURNING id, device_token_id, platform, payload, attempts,
                 (SELECT token FROM device_tokens WHERE device_tokens.id = push_outbox.device_token_id) AS token`
    )
    .bind(now, opts.limit ?? BATCH)
    .all<Row>();
  if (!rows.length) return out;

  const fail = (id: string, reason: string) =>
    db.prepare("UPDATE push_outbox SET status = 'failed', last_error = ?, claim_until = 0 WHERE id = ?").bind(reason, id).run();
  const later = (r: Row, reason: string, wait: number) =>
    r.attempts >= MAX_ATTEMPTS
      ? fail(r.id, reason)
      : db.prepare('UPDATE push_outbox SET next_attempt_at = ?, last_error = ?, claim_until = 0 WHERE id = ?').bind(now + wait, reason, r.id).run();

  let token: string;
  try {
    token = await accessToken(cfg, fetchFn, now);
  } catch (e) {
    // Wrong or revoked credentials: keep everything queued, don't count the attempt.
    const reason = e instanceof AuthError ? e.message : 'oauth_network';
    await db
      .prepare(`UPDATE push_outbox SET attempts = attempts - 1, claim_until = 0, next_attempt_at = ?, last_error = ? WHERE id IN (${rows.map(() => '?').join(',')})`)
      .bind(now + AUTH_PAUSE_MS, reason, ...rows.map(r => r.id))
      .run();
    out.paused = reason;
    return out;
  }

  const url = `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(cfg.projectId)}/messages:send`;
  for (const [i, r] of rows.entries()) {
    if (!r.token) {
      // Device logged out or re-registered since the row was queued.
      await fail(r.id, 'token_gone');
      out.failed++;
      continue;
    }
    let res: Response;
    try {
      res = await fetchFn(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(fcmMessage(r)),
      });
    } catch {
      await later(r, 'network', backoffMs(r.attempts));
      out.retry++;
      continue;
    }
    if (res.ok) {
      await db.prepare("UPDATE push_outbox SET status = 'sent', sent_at = ?, last_error = NULL, claim_until = 0 WHERE id = ?").bind(now, r.id).run();
      out.sent++;
      continue;
    }
    const code = await fcmErrorCode(res);
    if (res.status === 404 || code === 'UNREGISTERED') {
      // The app was uninstalled or the token rotated: stop sending to it.
      await db.batch([
        db.prepare("UPDATE push_outbox SET status = 'failed', last_error = 'UNREGISTERED', claim_until = 0 WHERE id = ?").bind(r.id),
        db.prepare('DELETE FROM device_tokens WHERE id = ?').bind(r.device_token_id),
      ]);
      out.failed++;
      out.removedTokens++;
    } else if (res.status === 401 || res.status === 403) {
      // Credentials stopped working mid-batch: release this and the remaining rows untouched.
      resetPushTokenCache();
      const rest = rows.slice(i);
      await db
        .prepare(`UPDATE push_outbox SET attempts = attempts - 1, claim_until = 0, next_attempt_at = ?, last_error = ? WHERE id IN (${rest.map(() => '?').join(',')})`)
        .bind(now + AUTH_PAUSE_MS, code, ...rest.map(x => x.id))
        .run();
      out.paused = code;
      return out;
    } else if (res.status === 429 || res.status >= 500) {
      const ra = Number(res.headers.get('Retry-After'));
      await later(r, code, Number.isFinite(ra) && ra > 0 ? ra * 1000 : backoffMs(r.attempts));
      out.retry++;
    } else {
      // 400 and friends: the message itself is wrong; retrying won't help.
      await fail(r.id, code);
      out.failed++;
    }
  }
  return out;
}
