import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { createRoom, createStore, createUser, uid } from './helpers';

async function store(category: string | null, area: string | null, name = 'store') {
  const id = await createStore(name);
  await env.DB.prepare('UPDATE stores SET category = ?, area = ? WHERE id = ?').bind(category, area, id).run();
  const roomId = await createRoom({ storeId: id, title: name });
  return { id, roomId };
}

describe('초이스톡 filters: 업종 and 동네 search', () => {
  it('filters by 업종 and finds stores by name or 동네; other filters still apply', async () => {
    const u = await createUser();
    const tag = uid('t'); // unique word so other tests' rooms never match
    const a = await store('hyperpublic', `${tag}역삼동`, `합성 A ${tag}`);
    const b = await store('jjeomo', `${tag}논현동`, `합성 B ${tag}`);
    const c = await store('hyperpublic', `${tag}논현동`, `합성 C ${tag}`);
    const none = await store(null, null, `합성 D ${tag}`);
    const general = await createRoom({ kind: 'general', title: `일반 ${tag}` });
    const ids = async (qs: string) => (await u.get(`/rooms?${qs}&limit=50`)).body.items.map((r: any) => r.id).sort();

    // Search by name still works; search by 동네 finds stores whose name doesn't contain it.
    expect(await ids(`q=${encodeURIComponent(tag)}`)).toEqual([a.roomId, b.roomId, c.roomId, none.roomId, general].sort());
    expect(await ids(`q=${encodeURIComponent(tag + '논현')}`)).toEqual([b.roomId, c.roomId].sort());

    // 업종 alone, and together with the search word.
    const hyper = await ids('category=hyperpublic');
    expect(hyper).toEqual(expect.arrayContaining([a.roomId, c.roomId]));
    expect(hyper).not.toContain(b.roomId);
    expect(hyper).not.toContain(none.roomId);
    expect(hyper).not.toContain(general);
    expect(await ids(`category=hyperpublic&q=${encodeURIComponent(tag + '논현')}`)).toEqual([c.roomId]);
    expect(await ids(`category=ten&q=${encodeURIComponent(tag)}`)).toEqual([]);

    // The list and the detail both carry 업종 and 동네.
    const item = (await u.get(`/rooms?q=${encodeURIComponent(tag + '역삼')}`)).body.items[0];
    expect(item).toMatchObject({ id: a.roomId, category: 'hyperpublic', area: `${tag}역삼동` });
    expect((await u.get(`/rooms/${b.roomId}`)).body).toMatchObject({ category: 'jjeomo', area: `${tag}논현동` });
    expect((await u.get(`/rooms/${general}`)).body).toMatchObject({ category: null, area: null });
  });

  it('rejects an unknown 업종; % and _ in the search are plain characters', async () => {
    const u = await createUser();
    expect((await u.get('/rooms?category=club')).status).toBe(400);
    const tag = uid('t');
    await store('ten', `${tag}청담동`, `합성 E ${tag}`);
    expect((await u.get(`/rooms?q=${encodeURIComponent(tag + '%')}`)).body.items).toEqual([]);
    expect((await u.get(`/rooms?q=${encodeURIComponent(tag + '_')}`)).body.items).toEqual([]);
  });

  it('the database only accepts the three 업종', async () => {
    const id = await createStore('x');
    await expect(env.DB.prepare("UPDATE stores SET category = 'club' WHERE id = ?").bind(id).run()).rejects.toThrow();
  });
});
