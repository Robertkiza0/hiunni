import { env, SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { sha256Hex } from '../src/lib/crypto';
import { notify } from '../src/lib/notify';
import { call, createUser, rid, uid } from './helpers';

const FRI = '2026-11-20';

async function place(category: string, intervals: [number, number, number][], closures: string[] = []) {
  const id = uid('p');
  await env.DB.prepare('INSERT INTO places (id, name, category, region, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(id, 'place ' + id, category, 'gangnam', Date.now())
    .run();
  for (const [weekday, o, cl] of intervals) {
    await env.DB.prepare('INSERT INTO place_hours (place_id, weekday, open_min, close_min) VALUES (?, ?, ?, ?)').bind(id, weekday, o, cl).run();
  }
  for (const d of closures) await env.DB.prepare('INSERT INTO place_closures (place_id, date) VALUES (?, ?)').bind(id, d).run();
  return id;
}

describe('F10 places API', () => {
  it('filters late-night / 24h / weekend and reports unknown hours separately', async () => {
    const u = await createUser();
    const cat = uid('cat');
    const bar = await place(cat, [[5, 1200, 1620]]); // Fri 20:00–03:00
    const allDay = await place(cat, [[5, 0, 1440]]);
    const weekend = await place(cat, [[6, 600, 1200]]);
    const unknown = await place(cat, []);
    const closedFri = await place(cat, [[5, 1200, 1620]], [FRI]);

    const ids = async (filter: string) =>
      (await u.get(`/places?category=${cat}&date=${FRI}${filter ? '&filter=' + filter : ''}`)).body.items.map((p: any) => p.id).sort();
    expect(await ids('lateNight')).toEqual([bar, allDay].sort());
    expect(await ids('allDay')).toEqual([allDay]);
    expect(await ids('weekend')).toEqual([weekend]);
    expect(await ids('lateNight,weekend')).toEqual([]);

    const all = (await u.get(`/places?category=${cat}&date=${FRI}`)).body.items;
    const unk = all.find((p: any) => p.id === unknown);
    expect(unk).toMatchObject({ hoursStatus: 'unknown', lateNight: null, weekend: null });
    expect(all.find((p: any) => p.id === closedFri)).toMatchObject({ closedOnDate: true, lateNight: false });

    expect((await u.get(`/places?category=${cat}&filter=bogus`)).status).toBe(400);
    const detail = (await u.get(`/places/${bar}?date=${FRI}`)).body;
    expect(detail.hours[0]).toEqual({ weekday: 5, open: '20:00', close: '03:00', overnight: true });
  });

  it('filtered pagination returns every match past 48 items without gaps or duplicates', async () => {
    const u = await createUser();
    const cat = uid('cat');
    const expected = new Set<string>();
    for (let i = 0; i < 70; i++) {
      const late = i % 2 === 0;
      const id = await place(cat, late ? [[5, 1260, 1560]] : [[5, 600, 1080]]);
      if (late) expected.add(id);
    }
    const got: string[] = [];
    let cursor: string | null = null;
    do {
      const r: any = await u.get(`/places?category=${cat}&date=${FRI}&filter=lateNight&limit=12${cursor ? '&cursor=' + cursor : ''}`);
      got.push(...r.body.items.map((p: any) => p.id));
      cursor = r.body.nextCursor;
    } while (cursor);
    expect(got.length).toBe(35);
    expect(new Set(got)).toEqual(expected);
  });

  it('only operators can edit hours, and invalid intervals are rejected', async () => {
    const m = await createUser();
    const op = await createUser({ role: 'operator' });
    const id = await place(uid('cat'), []);
    expect((await m.put(`/places/${id}/hours`, { intervals: [] })).status).toBe(403);
    expect((await op.put(`/places/${id}/hours`, { intervals: [{ weekday: 5, openMin: 600, closeMin: 500 }] })).status).toBe(400);
    expect((await op.put(`/places/${id}/hours`, { intervals: [{ weekday: 5, openMin: 1200, closeMin: 1620 }] })).status).toBe(200);
    expect((await m.get(`/places/${id}?date=${FRI}`)).body.lateNight).toBe(true);
  });
});

// Smallest valid PNG signature + a few bytes.
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 1, 2, 3, 4, 5, 6, 7, 8]);

async function upload(token: string, bytes: Uint8Array, type: string) {
  const res = await SELF.fetch('https://api.test/media', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': type },
    body: bytes,
  });
  return { status: res.status, body: (await res.json()) as any };
}

describe('F02 private media on R2', () => {
  it('uploads, sniffs content, serves via short-lived signed URL only to allowed users', async () => {
    const A = await createUser();
    const B = await createUser();
    const C = await createUser();

    expect((await upload(A.token, PNG, 'image/jpeg')).status).toBe(415); // content mismatch
    expect((await upload(A.token, PNG, 'application/pdf')).status).toBe(415);
    const up = await upload(A.token, PNG, 'image/png');
    expect(up.status).toBe(201);
    expect(up.body.sha256).toBe(await sha256Hex(PNG.buffer as ArrayBuffer));

    // Owner can get a URL; strangers cannot.
    const urlRes = await A.get(`/media/${up.body.id}/url`);
    expect(urlRes.status).toBe(200);
    expect((await C.get(`/media/${up.body.id}/url`)).status).toBe(403);

    // Byte-for-byte integrity through the signed URL.
    const raw = await SELF.fetch(urlRes.body.url);
    expect(raw.status).toBe(200);
    expect(raw.headers.get('Content-Type')).toBe('image/png');
    expect(await sha256Hex(await raw.arrayBuffer())).toBe(up.body.sha256);

    // Tampered or expired URLs are 403; no URL at all is 403.
    const u = new URL(urlRes.body.url);
    u.searchParams.set('sig', '0'.repeat(64));
    expect((await SELF.fetch(u.toString())).status).toBe(403);
    const expired = new URL(urlRes.body.url);
    expired.searchParams.set('exp', String(Math.floor(Date.now() / 1000) - 10));
    expect((await SELF.fetch(expired.toString())).status).toBe(403);
    expect((await SELF.fetch(`https://api.test/media/${up.body.id}/raw`)).status).toBe(403);

    // Sharing in a DM grants the other participant access.
    const req = (await A.post('/dm/requests', { toUserId: B.id })).body.id;
    const conv = (await B.post(`/dm/requests/${req}/accept`)).body.conversationId;
    expect((await B.get(`/media/${up.body.id}/url`)).status).toBe(403);
    expect((await A.post(`/dm/conversations/${conv}/messages`, { requestId: rid(), mediaId: up.body.id })).status).toBe(201);
    expect((await B.get(`/media/${up.body.id}/url`)).status).toBe(200);
    expect((await C.get(`/media/${up.body.id}/url`)).status).toBe(403);

    // Owner deletes → hidden (no URLs, old signed URL stops working) but the object is kept.
    expect((await B.del(`/media/${up.body.id}`)).status).toBe(403);
    expect((await A.del(`/media/${up.body.id}`)).status).toBe(204);
    expect((await A.get(`/media/${up.body.id}/url`)).status).toBe(404);
    expect((await SELF.fetch(urlRes.body.url)).status).toBe(404);
    const row = await env.DB.prepare('SELECT r2_key FROM media WHERE id = ?').bind(up.body.id).first<{ r2_key: string }>();
    expect(await env.MEDIA.head(row!.r2_key)).not.toBeNull();
  });

  it('requires auth to upload', async () => {
    const res = await SELF.fetch('https://api.test/media', { method: 'POST', headers: { 'Content-Type': 'image/png' }, body: PNG });
    expect(res.status).toBe(401);
  });
});

describe('F05 push devices, preferences, DND, hidden content', () => {
  const outbox = async (userId: string) =>
    (
      await env.DB.prepare(
        'SELECT o.payload FROM push_outbox o JOIN device_tokens d ON d.id = o.device_token_id WHERE d.user_id = ?'
      )
        .bind(userId)
        .all<{ payload: string }>()
    ).results.map(r => JSON.parse(r.payload));

  it('token re-registration moves ownership instead of duplicating; logout removes it', async () => {
    const A = await createUser();
    const B = await createUser();
    const token = 'fcm-token-' + uid();
    await A.put('/push/devices', { platform: 'android', token });
    await B.put('/push/devices', { platform: 'android', token });
    const rows = await env.DB.prepare('SELECT user_id FROM device_tokens WHERE token = ?').bind(token).all<{ user_id: string }>();
    expect(rows.results).toEqual([{ user_id: B.id }]);
    await B.post('/auth/logout');
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM device_tokens WHERE token = ?').bind(token).first<{ n: number }>())!.n).toBe(0);
  });

  it('respects per-type toggles, DND and hide-content; inbox is always written', async () => {
    const A = await createUser();
    await A.put('/push/devices', { platform: 'ios', token: 'apns-token-' + uid() });

    const r1 = await notify(env, { userId: A.id, type: 'comment', title: '새 댓글', body: '내용' });
    expect(r1.push).toBe('queued');
    expect((await outbox(A.id)).at(-1)).toMatchObject({ title: '새 댓글', body: '내용' });

    await A.put('/push/preferences', { hideContent: true });
    await notify(env, { userId: A.id, type: 'comment', title: '새 댓글', body: '내용' });
    expect((await outbox(A.id)).at(-1)).toMatchObject({ title: '하이언니', body: '새 알림이 있습니다' });

    await A.put('/push/preferences', { comment: false });
    expect((await notify(env, { userId: A.id, type: 'comment', title: 'x' })).push).toBe('disabled');

    await A.put('/push/preferences', { dm: true, dnd: { start: '23:00', end: '07:00' } });
    const midnightKst = Date.parse('2026-11-21T00:30:00+09:00');
    expect((await notify(env, { userId: A.id, type: 'dm', title: 'x' }, midnightKst)).push).toBe('dnd');

    const prefs = (await A.get('/push/preferences')).body;
    expect(prefs).toEqual({ comment: false, dm: true, saved: true, dnd: { start: '23:00', end: '07:00' }, hideContent: true });

    const inbox = (await A.get('/notifications?limit=10')).body.items;
    expect(inbox).toHaveLength(4);
    expect((await A.get('/me')).body.counts.unreadNotifications).toBe(4);
    await A.post('/notifications/read', { all: true });
    expect((await A.get('/me')).body.counts.unreadNotifications).toBe(0);
  });

  it('dev-login is unavailable without a session token for other routes', async () => {
    expect((await call(null, 'GET', '/push/preferences')).status).toBe(401);
  });
});
