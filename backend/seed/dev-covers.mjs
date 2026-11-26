// Sets a synthetic cover photo on every store room (초이스톡 list pictures) through the API.
// Pictures are abstract lounge art from seed/covers (make-covers.mjs); no real venue.
// Only for a local dev API or the staging API, which both have the synthetic admin1 dev login.
// Usage: node seed/dev-covers.mjs [http://127.0.0.1:8790]
import fs from 'node:fs';
import path from 'node:path';
const api = process.argv[2] || 'http://127.0.0.1:8790';
const host = new URL(api).hostname;
if (!['127.0.0.1', 'localhost'].includes(host) && !host.startsWith('hiunni-api-staging.')) throw new Error('Refusing non-local, non-staging API: ' + api);
const dir = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), 'covers');
const files = fs.readdirSync(dir).filter(f => f.endsWith('.jpg')).sort();
const origin = { origin: 'http://localhost:5173' };
const login = await fetch(api + '/auth/dev-login', { method: 'POST', headers: { 'content-type': 'application/json', ...origin }, body: JSON.stringify({ userId: 'admin1' }) });
if (!login.ok) throw new Error('dev login failed: ' + login.status);
const { token } = await login.json();
const auth = { authorization: 'Bearer ' + token, ...origin };
const rooms = [];
for (let cursor = null; ;) {
  const r = await (await fetch(api + '/rooms?kind=store&limit=50' + (cursor ? '&cursor=' + encodeURIComponent(cursor) : ''), { headers: auth })).json();
  rooms.push(...r.items);
  if (!r.hasMore) break;
  cursor = r.nextCursor;
}
let set = 0;
for (const [i, room] of rooms.entries()) {
  if (room.coverUrl) continue;
  const up = await fetch(api + '/media', { method: 'POST', headers: { ...auth, 'content-type': 'image/jpeg' }, body: fs.readFileSync(path.join(dir, files[i % files.length])) });
  if (!up.ok) throw new Error('upload failed: ' + up.status);
  const { id } = await up.json();
  const put = await fetch(api + `/rooms/${room.id}/cover`, { method: 'PUT', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ mediaId: id }) });
  if (!put.ok) throw new Error('cover failed: ' + put.status);
  set++;
}
console.log(`covers set on ${set} of ${rooms.length} store rooms`);
