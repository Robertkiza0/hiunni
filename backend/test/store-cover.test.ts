import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { addStaff, createRoom, createStore, createUser } from './helpers';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 1, 2, 3, 4, 5, 6, 7, 8]);

async function upload(token: string) {
  const res = await SELF.fetch('https://api.test/media', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'image/png' },
    body: PNG,
  });
  return (await res.json()) as { id: string };
}

describe('초이스톡 store cover photo', () => {
  it('operator sets a cover; every signed-in member sees it in the list and detail', async () => {
    const op = await createUser();
    const staff = await createUser();
    const member = await createUser();
    const store = await createStore('cover store');
    await addStaff(store, op.id, '실장', true);
    await addStaff(store, staff.id, '팀장', false);
    const room = await createRoom({ storeId: store, title: 'cover room' });

    // No cover yet.
    expect((await member.get(`/rooms/${room}`)).body.coverUrl).toBeNull();
    expect((await op.get(`/rooms/${room}`)).body.canEditCover).toBe(true);
    expect((await member.get(`/rooms/${room}`)).body.canEditCover).toBe(false);

    const pic = await upload(op.token);
    // Only the store operator can set it, and only with their own upload.
    expect((await member.put(`/rooms/${room}/cover`, { mediaId: pic.id })).status).toBe(403);
    expect((await staff.put(`/rooms/${room}/cover`, { mediaId: pic.id })).status).toBe(403);
    const other = await upload(member.token);
    expect((await op.put(`/rooms/${room}/cover`, { mediaId: other.id })).status).toBe(400);
    const set = await op.put(`/rooms/${room}/cover`, { mediaId: pic.id });
    expect(set.status).toBe(200);
    expect(set.body.coverUrl).toContain(`/media/${pic.id}/raw`);

    const list = await member.get('/rooms?kind=store&q=cover%20room');
    const item = list.body.items.find((r: any) => r.id === room);
    expect(item.coverUrl).toContain(`/media/${pic.id}/raw`);
    // The signed URL works without a token (usable from <img>), and members may request one.
    expect((await SELF.fetch(item.coverUrl)).status).toBe(200);
    expect((await member.get(`/media/${pic.id}/url`)).status).toBe(200);

    // Hidden media is no longer shown; clearing the cover works.
    await op.del(`/media/${pic.id}`);
    expect((await member.get(`/rooms/${room}`)).body.coverUrl).toBeNull();
    expect((await op.put(`/rooms/${room}/cover`, { mediaId: null })).status).toBe(200);
  });

  it('general rooms have no cover and cannot set one', async () => {
    const admin = await createUser({ role: 'admin' });
    const room = await createRoom({ kind: 'general' });
    expect((await admin.get(`/rooms/${room}`)).body.coverUrl).toBeNull();
    expect((await admin.put(`/rooms/${room}/cover`, { mediaId: null })).status).toBe(404);
  });
});
