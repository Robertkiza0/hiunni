import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { connect, createUser, rid, uid, waitFor } from './helpers';

async function postBy(author: Awaited<ReturnType<typeof createUser>>) {
  const r = await author.post('/posts', { board: 'lounge', category: 'free', title: 't', body: 'b', mutationId: rid() });
  return r.body.post.id as string;
}

describe('F04 consent-based DM — A requests → B accepts → A/B talk → C denied → block → logout', () => {
  it('runs the full scenario', async () => {
    const A = await createUser();
    const B = await createUser();
    const C = await createUser();

    // A requests from B's post (F09 "DM from post")
    const postId = await postBy(B);
    const req = await A.post('/dm/requests', { postId, message: '안녕하세요' });
    expect(req.status).toBe(201);
    expect(req.body.toUser.id).toBe(B.id);
    expect(req.body.status).toBe('pending');

    // Before acceptance there is no conversation, so nobody can send.
    expect((await A.get('/dm/conversations')).body.items).toHaveLength(0);
    // Duplicate pending and reverse requests are refused.
    expect((await A.post('/dm/requests', { toUserId: B.id })).body.error.code).toBe('request_already_pending');
    expect((await B.post('/dm/requests', { toUserId: A.id })).body.error.code).toBe('reverse_request_pending');

    // Only B can accept; accepting twice returns the same conversation.
    expect((await C.post(`/dm/requests/${req.body.id}/accept`)).status).toBe(403);
    expect((await A.post(`/dm/requests/${req.body.id}/accept`)).status).toBe(403);
    const acc1 = await B.post(`/dm/requests/${req.body.id}/accept`);
    const acc2 = await B.post(`/dm/requests/${req.body.id}/accept`);
    expect(acc1.body.conversationId).toBeTruthy();
    expect(acc2.body.conversationId).toBe(acc1.body.conversationId);
    const conv = acc1.body.conversationId as string;
    const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM dm_conversations WHERE id = ?').bind(conv).first<{ n: number }>();
    expect(count!.n).toBe(1);

    // A and B talk, live.
    const sockB = await connect(B, `dm:${conv}`);
    const m1 = await A.post(`/dm/conversations/${conv}/messages`, { requestId: rid(), body: 'hi B' });
    expect(m1.status).toBe(201);
    await waitFor(() => sockB.events.some(e => e.type === 'message'));
    await B.post(`/dm/conversations/${conv}/messages`, { requestId: rid(), body: 'hi A' });

    // Read receipt
    expect((await A.get(`/dm/conversations/${conv}/messages`)).body.items[0].readByOther).toBe(false);
    await B.post(`/dm/conversations/${conv}/read`, { seq: m1.body.message.seq });
    expect((await A.get(`/dm/conversations/${conv}/messages`)).body.items[0].readByOther).toBe(true);

    // C is denied everywhere.
    expect((await C.get(`/dm/conversations/${conv}/messages`)).status).toBe(403);
    expect((await C.post(`/dm/conversations/${conv}/messages`, { requestId: rid(), body: 'x' })).status).toBe(403);
    expect((await C.post('/realtime/tickets', { channel: `dm:${conv}` })).status).toBe(403);

    // DM notification never carries the message body.
    const notes = (await B.get('/notifications')).body.items.filter((n: any) => n.type === 'dm');
    expect(notes.length).toBeGreaterThan(0);
    expect(notes.every((n: any) => n.body === null)).toBe(true);

    // B blocks A: A's socket is cut and both directions stop.
    const sockA = await connect(A, `dm:${conv}`);
    await B.post('/safety/blocks', { userId: A.id });
    await waitFor(() => sockA.closed.code !== undefined);
    expect(sockA.closed.code).toBe(4003);
    expect((await A.post(`/dm/conversations/${conv}/messages`, { requestId: rid(), body: 'still?' })).body.error.code).toBe('blocked');
    expect((await B.post(`/dm/conversations/${conv}/messages`, { requestId: rid(), body: 'bye' })).body.error.code).toBe('blocked');
    expect((await A.post('/dm/requests', { toUserId: B.id })).status).toBe(403);

    // Logout ends A's session.
    await A.post('/auth/logout');
    expect((await A.get('/dm/conversations')).status).toBe(401);
    sockB.ws.close();
  });

  it('reject and cancel are restricted to the right party and are final', async () => {
    const A = await createUser();
    const B = await createUser();
    const r1 = (await A.post('/dm/requests', { toUserId: B.id })).body.id;
    expect((await A.post(`/dm/requests/${r1}/reject`)).status).toBe(403);
    expect((await B.post(`/dm/requests/${r1}/reject`)).body.status).toBe('rejected');
    expect((await B.post(`/dm/requests/${r1}/accept`)).status).toBe(409);

    const r2 = (await A.post('/dm/requests', { toUserId: B.id })).body.id;
    expect((await B.post(`/dm/requests/${r2}/cancel`)).status).toBe(403);
    expect((await A.post(`/dm/requests/${r2}/cancel`)).body.status).toBe('cancelled');
    expect((await B.get('/dm/requests?box=received&status=pending')).body.items).toHaveLength(0);
  });

  it('cannot DM yourself, unknown users, or send someone else’s photo', async () => {
    const A = await createUser();
    const B = await createUser();
    expect((await A.post('/dm/requests', { toUserId: A.id })).status).toBe(400);
    expect((await A.post('/dm/requests', { toUserId: uid('missing') })).status).toBe(404);
    const r = (await A.post('/dm/requests', { toUserId: B.id })).body.id;
    const conv = (await B.post(`/dm/requests/${r}/accept`)).body.conversationId;
    await env.DB.prepare(
      "INSERT INTO media (id, owner_id, r2_key, content_type, size, sha256, created_at) VALUES (?, ?, ?, 'image/png', 1, 'x', 0)"
    )
      .bind('mediaofb' + uid(), B.id, 'k' + uid())
      .run();
    const bMedia = await env.DB.prepare('SELECT id FROM media WHERE owner_id = ?').bind(B.id).first<{ id: string }>();
    const res = await A.post(`/dm/conversations/${conv}/messages`, { requestId: rid(), mediaId: bMedia!.id });
    expect(res.body.error.code).toBe('invalid_media');
  });
});
