import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { addStaff, call, createRoom, createStore, createUser, rid } from './helpers';

describe('auth', () => {
  it('rejects missing/invalid tokens and revokes on logout', async () => {
    expect((await call(null, 'GET', '/me')).status).toBe(401);
    expect((await call('nope', 'GET', '/me')).status).toBe(401);
    const a = await createUser();
    expect((await a.get('/me')).status).toBe(200);
    expect((await a.post('/auth/logout')).status).toBe(204);
    expect((await a.get('/me')).status).toBe(401);
  });

  it('withdrawn users lose every session', async () => {
    const a = await createUser();
    expect((await a.del('/me')).status).toBe(204);
    expect((await a.get('/me')).status).toBe(401);
  });
});

describe('F03 room membership', () => {
  it('approval room: member requests, cannot approve self; manager approves', async () => {
    const mgr = await createUser();
    const a = await createUser();
    const room = await createRoom({ manager: mgr.id });

    expect((await a.post(`/rooms/${room}/join`)).body.state).toBe('pending');
    expect((await a.post(`/rooms/${room}/members/${a.id}`, { action: 'approve' })).status).toBe(403);
    expect((await a.get(`/rooms/${room}/messages`)).status).toBe(403);

    const ok = await mgr.post(`/rooms/${room}/members/${a.id}`, { action: 'approve' });
    expect(ok.body.state).toBe('active');
    expect((await a.get(`/rooms/${room}`)).body.myState).toBe('active');
  });

  it('enforces capacity on approval and on open join', async () => {
    const mgr = await createUser();
    const [a, b] = [await createUser(), await createUser()];
    const room = await createRoom({ manager: mgr.id, capacity: 2 });
    await a.post(`/rooms/${room}/join`);
    await b.post(`/rooms/${room}/join`);
    expect((await mgr.post(`/rooms/${room}/members/${a.id}`, { action: 'approve' })).status).toBe(200);
    const full = await mgr.post(`/rooms/${room}/members/${b.id}`, { action: 'approve' });
    expect(full.status).toBe(409);
    expect(full.body.error.code).toBe('room_full');

    const open = await createRoom({ policy: 'open', capacity: 1 });
    expect((await a.post(`/rooms/${open}/join`)).body.state).toBe('active');
    expect((await b.post(`/rooms/${open}/join`)).status).toBe(409);
  });

  it('blocked members cannot rejoin; kicked members cannot read or send', async () => {
    const mgr = await createUser();
    const a = await createUser();
    const room = await createRoom({ manager: mgr.id, policy: 'open' });
    await a.post(`/rooms/${room}/join`);
    await mgr.post(`/rooms/${room}/members/${a.id}`, { action: 'kick' });
    expect((await a.post(`/rooms/${room}/messages`, { requestId: rid(), body: 'hi' })).status).toBe(403);
    await a.post(`/rooms/${room}/join`);
    await mgr.post(`/rooms/${room}/members/${a.id}`, { action: 'block' });
    expect((await a.post(`/rooms/${room}/join`)).body.error.code).toBe('blocked_from_room');
  });
});

describe('room list filters', () => {
  it('filters by a list of kinds and by saved (찜)', async () => {
    const a = await createUser();
    const title = 'filt' + Date.now();
    const store = await createRoom({ storeId: await createStore(), title: title + 's' });
    const general = await createRoom({ kind: 'general', title: title + 'g' });
    const daily = await createRoom({ kind: 'daily', title: title + 'd' });
    const ids = async (qs: string) => (await a.get(`/rooms?q=${title}&${qs}`)).body.items.map((r: any) => r.id).sort();
    expect(await ids('kind=store,general')).toEqual([store, general].sort());
    expect(await ids('kind=daily')).toEqual([daily]);
    expect((await a.get('/rooms?kind=bogus')).status).toBe(400);
    await a.put(`/me/saved/room/${general}`);
    expect(await ids('saved=true')).toEqual([general]);
    expect((await a.get(`/rooms/${general}`)).body.saved).toBe(true);
    expect((await a.get(`/rooms/${store}`)).body.saved).toBe(false);
  });
});

describe('F03 messages', () => {
  it('same requestId is stored once; different payload is a conflict', async () => {
    const a = await createUser();
    const room = await createRoom({ policy: 'open' });
    await a.post(`/rooms/${room}/join`);
    const requestId = rid();
    const first = await a.post(`/rooms/${room}/messages`, { requestId, body: 'hello' });
    const retry = await a.post(`/rooms/${room}/messages`, { requestId, body: 'hello' });
    expect(first.status).toBe(201);
    expect(retry.status).toBe(200);
    expect(retry.body.duplicate).toBe(true);
    expect(retry.body.message.id).toBe(first.body.message.id);
    expect((await a.post(`/rooms/${room}/messages`, { requestId, body: 'changed' })).status).toBe(409);

    const list = await a.get(`/rooms/${room}/messages`);
    expect(list.body.items).toHaveLength(1);
  });

  it('backfill after reconnect returns messages after a seq, in order', async () => {
    const a = await createUser();
    const room = await createRoom({ policy: 'open' });
    await a.post(`/rooms/${room}/join`);
    const seqs: number[] = [];
    for (let i = 0; i < 5; i++) seqs.push((await a.post(`/rooms/${room}/messages`, { requestId: rid(), body: `m${i}` })).body.message.seq);
    const after = await a.get(`/rooms/${room}/messages?afterSeq=${seqs[1]}`);
    expect(after.body.items.map((m: any) => m.body)).toEqual(['m2', 'm3', 'm4']);
  });

  it('closed rooms reject reads and writes', async () => {
    const mgr = await createUser();
    const room = await createRoom({ manager: mgr.id });
    await mgr.post(`/rooms/${room}/close`);
    expect((await mgr.get(`/rooms/${room}/messages`)).body.error.code).toBe('room_closed');
  });

  it('live status keeps null (not reported) distinct from 0', async () => {
    const mgr = await createUser();
    const a = await createUser();
    const room = await createRoom({ manager: mgr.id });
    expect((await a.get(`/rooms/${room}`)).body.liveStatus).toBeNull();
    await mgr.put(`/rooms/${room}/status`, { choice: 0, entry: 3, waiting: null, vacancy: 1 });
    const s = (await a.get(`/rooms/${room}`)).body.liveStatus;
    expect(s).toMatchObject({ choice: 0, entry: 3, waiting: null, vacancy: 1 });
    expect((await a.put(`/rooms/${room}/status`, { choice: 1, entry: 1, waiting: 1, vacancy: 1 })).status).toBe(403);
  });
});

describe('익명 오픈톡 (automatic nicknames)', () => {
  it('shows a stable per-room alias and never exposes the account id', async () => {
    const a = await createUser({ nickname: 'realname_a' });
    const b = await createUser();
    const open = await createRoom({ policy: 'open' });
    await env.DB.prepare('UPDATE rooms SET anonymous = 1 WHERE id = ?').bind(open).run();
    const other = await createRoom({ policy: 'open' });
    await env.DB.prepare('UPDATE rooms SET anonymous = 1 WHERE id = ?').bind(other).run();
    for (const r of [open, other]) for (const u of [a, b]) await u.post(`/rooms/${r}/join`);

    const me = (await a.get(`/rooms/${open}`)).body.myAlias;
    expect(me.id).toMatch(/^anon_/);
    const sent = await a.post(`/rooms/${open}/messages`, { requestId: rid(), body: 'hi' });
    expect(sent.body.message.senderId).toBe(me.id);
    const seenByB = (await b.get(`/rooms/${open}/messages`)).body.items[0];
    expect(seenByB.senderId).toBe(me.id);
    expect(seenByB.senderNickname).toBe(me.nickname);
    expect(JSON.stringify(seenByB)).not.toContain(a.id);
    expect(JSON.stringify(seenByB)).not.toContain('realname_a');
    // Same user, different room → different alias (cannot be linked across rooms).
    expect((await a.get(`/rooms/${other}`)).body.myAlias.id).not.toBe(me.id);
    // Stable across calls.
    expect((await a.get(`/rooms/${open}`)).body.myAlias).toEqual(me);
    // Non-anonymous rooms have no alias.
    expect((await a.get(`/rooms/${await createRoom()}`)).body.myAlias).toBeNull();
  });
});

describe('찜한 가게 소식 (saved store notifications)', () => {
  it('notifies users who saved the room when numbers change, throttled per room', async () => {
    const mgr = await createUser();
    const fan = await createUser();
    const other = await createUser();
    const room = await createRoom({ manager: mgr.id });
    await fan.put(`/me/saved/room/${room}`);
    await mgr.put(`/rooms/${room}/status`, { choice: 1, entry: 2, waiting: 3, vacancy: 4 });
    await mgr.put(`/rooms/${room}/status`, { choice: 1, entry: 2, waiting: 5, vacancy: 4 }); // within 10 min → throttled
    const notes = (await fan.get('/notifications')).body.items.filter((n: any) => n.type === 'saved');
    expect(notes).toHaveLength(1);
    expect(notes[0].body).toBe('대기 3 · 빈방 4');
    expect((await other.get('/notifications')).body.items).toHaveLength(0);
    expect((await mgr.get('/notifications')).body.items).toHaveLength(0);
  });
});

describe('F07 store-room tools', () => {
  it('only store rooms expose tools', async () => {
    const a = await createUser();
    const general = await createRoom();
    expect((await a.get(`/rooms/${general}/tools`)).body.error.code).toBe('not_store_room');
  });

  it('operator edits prices/terms/vacancy; members see it; data does not mix between stores', async () => {
    const op = await createUser();
    const member = await createUser();
    const s1 = await createStore('one');
    const s2 = await createStore('two');
    await addStaff(s1, op.id, '실장', true);
    const r1 = await createRoom({ storeId: s1 });
    const r2 = await createRoom({ storeId: s2 });

    const prices = { items: [{ label: '기본', amount: 50000 }, { label: '연장', amount: null, note: '문의' }, { label: '무료', amount: 0 }] };
    expect((await member.put(`/rooms/${r1}/tools/prices`, prices)).status).toBe(403);
    expect((await op.put(`/rooms/${r1}/tools/prices`, prices)).status).toBe(200);
    expect((await op.put(`/rooms/${r1}/tools/terms`, { items: [{ term: 'TC', definition: '테이블 차지' }] })).status).toBe(200);
    expect((await op.post(`/rooms/${r1}/tools/vacancy`, { vacancy: 2, note: '22시 기준' })).status).toBe(201);
    // Operator of store one has no rights on store two.
    expect((await op.post(`/rooms/${r2}/tools/vacancy`, { vacancy: 9 })).status).toBe(403);

    const t1 = (await member.get(`/rooms/${r1}/tools`)).body;
    expect(t1.prices.map((p: any) => p.amount)).toEqual([50000, null, 0]);
    expect(t1.terms[0].term).toBe('TC');
    expect(t1.vacancy.latest.vacancy).toBe(2);
    expect(t1.canEdit).toBe(false);
    expect((await member.get(`/rooms/${r1}`)).body.liveStatus.vacancy).toBe(2);

    const t2 = (await member.get(`/rooms/${r2}/tools`)).body;
    expect(t2.prices).toEqual([]);
    expect(t2.vacancy.latest).toBeNull();
  });
});

describe('F08 staff profile + last seen', () => {
  it('shows last seen only with opt-in; hides staff the viewer blocked; hides withdrawn staff', async () => {
    const viewer = await createUser();
    const visible = await createUser({ showLastSeen: true });
    const hidden = await createUser({ showLastSeen: false });
    const blocked = await createUser({ showLastSeen: true });
    const gone = await createUser({ showLastSeen: true });
    const store = await createStore();
    for (const u of [visible, hidden, blocked, gone]) await addStaff(store, u.id);
    const room = await createRoom({ storeId: store });
    await visible.get('/me'); // updates last_seen_at
    await viewer.post('/safety/blocks', { userId: blocked.id });
    await env.DB.prepare("UPDATE users SET status = 'withdrawn' WHERE id = ?").bind(gone.id).run();

    const items = (await viewer.get(`/rooms/${room}/staff`)).body.items;
    const byId = Object.fromEntries(items.map((s: any) => [s.userId, s]));
    expect(Object.keys(byId).sort()).toEqual([visible.id, hidden.id].sort());
    expect(byId[visible.id].lastSeen.visible).toBe(true);
    expect(Date.parse(byId[visible.id].lastSeen.at)).toBeGreaterThan(Date.now() - 60_000);
    expect(byId[hidden.id].lastSeen).toEqual({ visible: false, at: null });
  });
});
