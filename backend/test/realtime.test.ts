import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { connect, createRoom, createUser, rid, waitFor } from './helpers';

describe('F03 realtime over WebSocket', () => {
  it('a message sent by one device reaches another device in under 1 s', async () => {
    const a = await createUser();
    const b = await createUser();
    const room = await createRoom({ policy: 'open' });
    await a.post(`/rooms/${room}/join`);
    await b.post(`/rooms/${room}/join`);
    const sockB = await connect(b, `room:${room}`);

    const t0 = Date.now();
    const sent = await a.post(`/rooms/${room}/messages`, { requestId: rid(), body: 'ping from A' });
    await waitFor(() => sockB.events.some(e => e.type === 'message'), 1000);
    const elapsed = Date.now() - t0;
    const evt = sockB.events.find(e => e.type === 'message');
    expect(evt.message.id).toBe(sent.body.message.id);
    expect(evt.message.body).toBe('ping from A');
    // Local Miniflare measurement only — real two-phone latency must be measured on staging.
    expect(elapsed).toBeLessThan(1000);
    sockB.ws.close();
  });

  it('a retried send is not broadcast twice', async () => {
    const a = await createUser();
    const room = await createRoom({ policy: 'open' });
    await a.post(`/rooms/${room}/join`);
    const sock = await connect(a, `room:${room}`);
    const requestId = rid();
    await a.post(`/rooms/${room}/messages`, { requestId, body: 'once' });
    await a.post(`/rooms/${room}/messages`, { requestId, body: 'once' });
    await a.post(`/rooms/${room}/messages`, { requestId: rid(), body: 'marker' });
    await waitFor(() => sock.events.some(e => e.message?.body === 'marker'));
    expect(sock.events.filter(e => e.message?.body === 'once')).toHaveLength(1);
    sock.ws.close();
  });

  it('live status counters are pushed to the status channel', async () => {
    const mgr = await createUser();
    const viewer = await createUser();
    const room = await createRoom({ manager: mgr.id });
    const sock = await connect(viewer, 'status');
    await mgr.put(`/rooms/${room}/status`, { choice: 1, entry: 2, waiting: 3, vacancy: 4 });
    await waitFor(() => sock.events.some(e => e.type === 'status' && e.roomId === room), 1000);
    expect(sock.events.find(e => e.type === 'status').status).toMatchObject({ choice: 1, entry: 2, waiting: 3, vacancy: 4 });
    sock.ws.close();
  });

  it('tickets are single-use and require membership', async () => {
    const a = await createUser();
    const outsider = await createUser();
    const room = await createRoom({ policy: 'open' });
    await a.post(`/rooms/${room}/join`);
    expect((await outsider.post('/realtime/tickets', { channel: `room:${room}` })).status).toBe(403);

    const sock = await connect(a, `room:${room}`);
    const reuse = await SELF.fetch(`https://api.test/realtime/ws?ticket=${encodeURIComponent(sock.ticket)}`, {
      headers: { Upgrade: 'websocket' },
    });
    expect(reuse.status).toBe(401);
    expect(reuse.webSocket).toBeFalsy();
    sock.ws.close();
  });

  it('kicking a member closes their socket immediately (code 4003)', async () => {
    const mgr = await createUser();
    const a = await createUser();
    const room = await createRoom({ manager: mgr.id, policy: 'open' });
    await a.post(`/rooms/${room}/join`);
    const sock = await connect(a, `room:${room}`);
    await mgr.post(`/rooms/${room}/members/${a.id}`, { action: 'kick' });
    await waitFor(() => sock.closed.code !== undefined);
    expect(sock.closed.code).toBe(4003);
    expect(sock.events.some(e => e.type === 'revoked')).toBe(true);
  });
});
