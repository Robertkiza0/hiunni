import { env } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { notify } from '../src/lib/notify';
import { drainOutbox, resetPushTokenCache } from '../src/lib/push-send';
import { createUser, uid } from './helpers';

// A throwaway RSA key made here, standing in for the client's Firebase service account.
let serviceAccount: string;
let publicKey: CryptoKey;
beforeAll(async () => {
  const pair = (await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify']
  )) as CryptoKeyPair;
  publicKey = pair.publicKey;
  const der = new Uint8Array((await crypto.subtle.exportKey('pkcs8', pair.privateKey)) as ArrayBuffer);
  const pem = `-----BEGIN PRIVATE KEY-----\n${btoa(String.fromCharCode(...der)).replace(/(.{64})/g, '$1\n')}\n-----END PRIVATE KEY-----\n`;
  serviceAccount = JSON.stringify({ type: 'service_account', project_id: 'hiunni-test', client_email: 'push@hiunni-test.iam.gserviceaccount.com', private_key: pem });
});
beforeEach(() => resetPushTokenCache());

const fromB64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), ch => ch.charCodeAt(0));

/** Fake Google: checks the signed JWT, then answers FCM by token name. */
function fakeGoogle(answers: Record<string, () => Response> = {}) {
  const sent: any[] = [];
  const jwts: any[] = [];
  const fetchFn = (async (url: string, init: RequestInit) => {
    if (url === 'https://oauth2.googleapis.com/token') {
      const assertion = new URLSearchParams(init.body as any).get('assertion')!;
      const [h, p, s] = assertion.split('.');
      const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', publicKey, fromB64url(s), new TextEncoder().encode(`${h}.${p}`));
      if (!ok) return new Response('bad signature', { status: 400 });
      jwts.push(JSON.parse(new TextDecoder().decode(fromB64url(p))));
      return Response.json({ access_token: 'ya29.fake', expires_in: 3600 });
    }
    const body = JSON.parse(init.body as string);
    sent.push({ url, auth: (init.headers as any).Authorization, body });
    const tok: string = body.message.token;
    const key = Object.keys(answers).find(k => tok.startsWith(k));
    return key ? answers[key]() : Response.json({ name: 'projects/hiunni-test/messages/1' });
  }) as unknown as typeof fetch;
  return { fetchFn, sent, jwts };
}

const fcmError = (status: number, errorCode: string, headers: Record<string, string> = {}) =>
  Response.json({ error: { code: status, status: errorCode, details: [{ '@type': 'type.googleapis.com/google.firebase.fcm.v1.FcmError', errorCode }] } }, { status, headers });

async function userWithDevice(tokenPrefix = 'ok') {
  const u = await createUser();
  const token = `${tokenPrefix}-${uid()}-fcm-token`;
  await u.put('/push/devices', { platform: 'android', token });
  return { u, token };
}
const rowsFor = (userId: string) =>
  env.DB.prepare(
    `SELECT o.status, o.attempts, o.last_error, o.sent_at, o.next_attempt_at FROM push_outbox o
     JOIN notifications n ON n.id = o.notification_id WHERE n.user_id = ? ORDER BY o.created_at`
  )
    .bind(userId)
    .all<any>()
    .then(r => r.results);
const withFcm = () => ({ ...env, FCM_SERVICE_ACCOUNT: serviceAccount });

describe('F05 push sender (FCM HTTP v1)', () => {
  it('does nothing without credentials; rows stay queued', async () => {
    const { u } = await userWithDevice();
    await notify(env, { userId: u.id, type: 'comment', title: '새 댓글', body: '내용' });
    const r = await drainOutbox(env);
    expect(r.configured).toBe(false);
    expect((await rowsFor(u.id))[0]).toMatchObject({ status: 'pending', attempts: 0 });
  });

  it('signs in with the service account and sends to the device; DM text never leaves the server', async () => {
    const { u, token } = await userWithDevice();
    await notify(env, { userId: u.id, type: 'dm', title: '새 메시지', body: '비밀 내용', link: '/dm/abc', sensitive: true });
    const g = fakeGoogle();
    const r = await drainOutbox(withFcm(), { fetch: g.fetchFn });
    expect(r.configured).toBe(true);
    expect(r.sent).toBeGreaterThanOrEqual(1); // earlier tests' queued rows may go out too
    expect(g.jwts[0]).toMatchObject({
      iss: 'push@hiunni-test.iam.gserviceaccount.com',
      scope: 'https://www.googleapis.com/auth/firebase.messaging',
      aud: 'https://oauth2.googleapis.com/token',
    });
    const m = g.sent.find(s => s.body.message.token === token)!;
    expect(m.url).toBe('https://fcm.googleapis.com/v1/projects/hiunni-test/messages:send');
    expect(m.auth).toBe('Bearer ya29.fake');
    expect(m.body.message.notification).toEqual({ title: '하이언니', body: '새 알림이 있습니다' });
    expect(m.body.message.data.link).toBe('/dm/abc');
    expect(JSON.stringify(m.body)).not.toContain('비밀 내용');
    expect((await rowsFor(u.id))[0]).toMatchObject({ status: 'sent', attempts: 1, last_error: null });
    expect((await rowsFor(u.id))[0].sent_at).toBeGreaterThan(0);
  });

  it('an uninstalled app (UNREGISTERED) fails the row and forgets the token', async () => {
    const { u, token } = await userWithDevice('gone');
    await notify(env, { userId: u.id, type: 'comment', title: 't' });
    const r = await drainOutbox(withFcm(), { fetch: fakeGoogle({ gone: () => fcmError(404, 'UNREGISTERED') }).fetchFn });
    expect(r.removedTokens).toBeGreaterThanOrEqual(1);
    expect((await rowsFor(u.id))[0]).toMatchObject({ status: 'failed', last_error: 'UNREGISTERED' });
    expect(await env.DB.prepare('SELECT 1 FROM device_tokens WHERE token = ?').bind(token).first()).toBeNull();
    // Later notifications don't queue for the dead token.
    expect((await notify(env, { userId: u.id, type: 'comment', title: 't2' })).push).toBe('no_devices');
  });

  it('temporary FCM errors retry with backoff, then give up after 5 tries', async () => {
    const { u } = await userWithDevice('busy');
    await notify(env, { userId: u.id, type: 'comment', title: 't' });
    const g = fakeGoogle({ busy: () => fcmError(503, 'UNAVAILABLE') });
    let now = Date.now();
    await drainOutbox(withFcm(), { fetch: g.fetchFn, now });
    let row = (await rowsFor(u.id))[0];
    expect(row).toMatchObject({ status: 'pending', attempts: 1, last_error: 'UNAVAILABLE' });
    expect(row.next_attempt_at).toBe(now + 30_000);
    // Not due yet: untouched.
    await drainOutbox(withFcm(), { fetch: g.fetchFn, now: now + 1000 });
    expect((await rowsFor(u.id))[0].attempts).toBe(1);
    for (let i = 0; i < 4; i++) {
      now += 31 * 60_000;
      await drainOutbox(withFcm(), { fetch: g.fetchFn, now });
    }
    row = (await rowsFor(u.id))[0];
    expect(row).toMatchObject({ status: 'failed', attempts: 5, last_error: 'UNAVAILABLE' });
  });

  it('honours Retry-After on 429', async () => {
    const { u } = await userWithDevice('slow');
    await notify(env, { userId: u.id, type: 'comment', title: 't' });
    const now = Date.now();
    await drainOutbox(withFcm(), { fetch: fakeGoogle({ slow: () => fcmError(429, 'QUOTA_EXCEEDED', { 'Retry-After': '120' }) }).fetchFn, now });
    expect((await rowsFor(u.id))[0]).toMatchObject({ status: 'pending', next_attempt_at: now + 120_000 });
  });

  it('bad credentials pause sending without using up tries', async () => {
    const { u } = await userWithDevice();
    await notify(env, { userId: u.id, type: 'comment', title: 't' });
    const now = Date.now();
    const denied = (async () => new Response('{"error":"invalid_grant"}', { status: 400 })) as unknown as typeof fetch;
    const r = await drainOutbox(withFcm(), { fetch: denied, now });
    expect(r.paused).toBe('oauth_400');
    expect((await rowsFor(u.id))[0]).toMatchObject({ status: 'pending', attempts: 0, last_error: 'oauth_400' });
    // After the pause it goes out.
    const g = fakeGoogle();
    await drainOutbox(withFcm(), { fetch: g.fetchFn, now: now + 6 * 60_000 });
    expect((await rowsFor(u.id))[0]).toMatchObject({ status: 'sent', attempts: 1 });
  });

  it('two senders running at once never send the same push twice', async () => {
    const users = await Promise.all([1, 2, 3].map(() => userWithDevice('dup')));
    for (const { u } of users) await notify(env, { userId: u.id, type: 'comment', title: 't' });
    const tokens = new Set(users.map(x => x.token));
    const g = fakeGoogle();
    await Promise.all([drainOutbox(withFcm(), { fetch: g.fetchFn }), drainOutbox(withFcm(), { fetch: g.fetchFn })]);
    const mine = g.sent.filter(s => tokens.has(s.body.message.token));
    expect(mine.length).toBe(3);
    expect(new Set(mine.map(s => s.body.message.token)).size).toBe(3);
  });

  it('drops pushes older than a day instead of sending them late; logged-out devices are skipped', async () => {
    const { u } = await userWithDevice('old');
    const longAgo = Date.now() - 25 * 3600_000;
    await notify(env, { userId: u.id, type: 'comment', title: 'old' }, longAgo);
    const { u: v, token } = await userWithDevice('out');
    await notify(env, { userId: v.id, type: 'comment', title: 't' });
    await env.DB.prepare('DELETE FROM device_tokens WHERE token = ?').bind(token).run();
    const g = fakeGoogle();
    await drainOutbox(withFcm(), { fetch: g.fetchFn });
    expect((await rowsFor(u.id))[0]).toMatchObject({ status: 'failed', last_error: 'expired' });
    expect((await rowsFor(v.id))[0]).toMatchObject({ status: 'failed', last_error: 'token_gone' });
    expect(g.sent.some(s => s.body.message.token.startsWith('old') || s.body.message.token.startsWith('out'))).toBe(false);
  });

  it('admins can see the queue state; members cannot; no content or tokens in it', async () => {
    const admin = await createUser({ role: 'admin' });
    const member = await createUser();
    expect((await member.get('/push/outbox')).status).toBe(403);
    const r = await admin.get('/push/outbox');
    expect(r.status).toBe(200);
    expect(r.body.senderConfigured).toBe(false);
    expect(Object.keys(r.body.counts).sort()).toEqual(['failed', 'pending', 'sent']);
    for (const row of r.body.recent) {
      expect(Object.keys(row).sort()).toEqual(['attempts', 'createdAt', 'id', 'lastError', 'platform', 'sentAt', 'status']);
    }
  });
});
