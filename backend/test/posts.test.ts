import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { createUser, rid, uid, type Client } from './helpers';

async function allPages(c: Client, base: string) {
  const seen: any[] = [];
  let cursor: string | null = null;
  for (let guard = 0; guard < 50; guard++) {
    const sep = base.includes('?') ? '&' : '?';
    const r = await c.get(base + (cursor ? `${sep}cursor=${encodeURIComponent(cursor)}` : ''));
    expect(r.status).toBe(200);
    seen.push(...r.body.items);
    cursor = r.body.nextCursor;
    if (!cursor) break;
  }
  return seen;
}

describe('F09 board', () => {
  it('55 comments: oldest/latest/popular sorts paginate completely with no duplicates', async () => {
    const author = await createUser();
    const fans = await Promise.all([createUser(), createUser(), createUser()]);
    const post = (await author.post('/posts', { board: 'lounge', category: 'free', title: 't', body: 'b', mutationId: rid() })).body.post.id;
    const ids: string[] = [];
    for (let i = 0; i < 55; i++) {
      const r = await author.post(`/posts/${post}/comments`, { body: `c${i}`, mutationId: rid() });
      ids.push(r.body.comment.id);
    }
    // c10 gets 3 likes, c20 gets 2, c30 gets 1.
    for (const [idx, n] of [[10, 3], [20, 2], [30, 1]] as const) {
      for (let k = 0; k < n; k++) await fans[k]!.put(`/comments/${ids[idx]}/like`);
    }

    const oldest = await allPages(author, `/posts/${post}/comments?sort=oldest&limit=20`);
    expect(oldest.map(c => c.body)).toEqual(Array.from({ length: 55 }, (_, i) => `c${i}`));

    const latest = await allPages(author, `/posts/${post}/comments?sort=latest&limit=20`);
    expect(latest.map(c => c.id)).toEqual([...oldest.map(c => c.id)].reverse());

    const popular = await allPages(author, `/posts/${post}/comments?sort=popular&limit=20`);
    expect(popular.slice(0, 3).map(c => c.body)).toEqual(['c10', 'c20', 'c30']);
    expect(new Set(popular.map(c => c.id)).size).toBe(55);
    expect((await author.get(`/posts/${post}`)).body.commentCount).toBe(55);
  });

  it('secret comments are visible only to the commenter, the post author and admins', async () => {
    const author = await createUser();
    const commenter = await createUser();
    const third = await createUser();
    const admin = await createUser({ role: 'admin' });
    const post = (await author.post('/posts', { board: 'lounge', category: 'free', title: 't', body: 'b', mutationId: rid() })).body.post.id;
    await commenter.post(`/posts/${post}/comments`, { body: '비밀 내용', isSecret: true, mutationId: rid() });

    const view = async (c: Client) => (await c.get(`/posts/${post}/comments`)).body.items[0];
    expect((await view(commenter)).body).toBe('비밀 내용');
    expect((await view(author)).body).toBe('비밀 내용');
    expect((await view(admin)).body).toBe('비밀 내용');
    const hidden = await view(third);
    expect(hidden).toMatchObject({ isSecret: true, visible: false, body: null, author: null });

    // The post author's notification must not leak the secret text.
    const note = (await author.get('/notifications')).body.items.find((n: any) => n.type === 'comment');
    expect(note.body).toBeNull();
    const outbox = await env.DB.prepare('SELECT payload FROM push_outbox').all<{ payload: string }>();
    expect(outbox.results.every(r => !r.payload.includes('비밀 내용'))).toBe(true);
  });

  it('post sorts, notices kept separate, blocked authors filtered, idempotent create', async () => {
    const board = uid('board');
    const a = await createUser();
    const b = await createUser();
    const admin = await createUser({ role: 'admin' });
    const mk = (c: Client, title: string, extra = {}) =>
      c.post('/posts', { board, category: 'free', title, body: title, mutationId: rid(), ...extra });
    const p1 = (await mk(a, 'first')).body.post.id;
    await mk(a, 'second');
    const p3 = (await mk(b, 'third by b')).body.post.id;
    await mk(admin, 'notice', { isNotice: true });
    expect((await mk(a, 'fake notice', { isNotice: true })).status).toBe(403);

    await b.put(`/posts/${p1}/like`);
    await admin.put(`/posts/${p1}/like`);
    await a.put(`/posts/${p3}/like`);

    const titles = async (c: Client, sort: string) => (await c.get(`/posts?board=${board}&sort=${sort}`)).body.items.map((p: any) => p.title);
    expect(await titles(a, 'latest')).toEqual(['third by b', 'second', 'first']);
    expect(await titles(a, 'oldest')).toEqual(['first', 'second', 'third by b']);
    expect(await titles(a, 'popular')).toEqual(['first', 'third by b', 'second']);
    expect((await a.get(`/posts/notices?board=${board}`)).body.items.map((p: any) => p.title)).toEqual(['notice']);

    await a.post('/safety/blocks', { userId: b.id });
    expect(await titles(a, 'latest')).toEqual(['second', 'first']);

    const mutationId = rid();
    const x1 = await a.post('/posts', { board, category: 'free', title: 'dup', body: 'dup', mutationId });
    const x2 = await a.post('/posts', { board, category: 'free', title: 'dup', body: 'dup', mutationId });
    expect(x2.body.duplicate).toBe(true);
    expect(x2.body.post.id).toBe(x1.body.post.id);
  });

  it('a cursor cannot be reused with a different sort', async () => {
    const a = await createUser();
    const board = uid('board');
    for (let i = 0; i < 3; i++) await a.post('/posts', { board, category: 'free', title: `p${i}`, body: 'b', mutationId: rid() });
    const page = await a.get(`/posts?board=${board}&sort=latest&limit=1`);
    const bad = await a.get(`/posts?board=${board}&sort=popular&limit=1&cursor=${page.body.nextCursor}`);
    expect(bad.status).toBe(400);
  });
});
