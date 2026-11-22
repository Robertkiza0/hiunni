import { env, SELF } from 'cloudflare:test';

let seq = 0;
/** Lowercase alphanumeric unique id (valid in realtime channel names). */
export const uid = (prefix = 'x') =>
  `${prefix}${Date.now().toString(36)}${(seq++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export interface Res<T = any> {
  status: number;
  body: T;
}

export async function call(token: string | null, method: string, path: string, body?: unknown): Promise<Res> {
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await SELF.fetch('https://api.test' + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

export function client(token: string) {
  return {
    token,
    get: (p: string) => call(token, 'GET', p),
    post: (p: string, b: unknown = {}) => call(token, 'POST', p, b),
    put: (p: string, b: unknown = {}) => call(token, 'PUT', p, b),
    patch: (p: string, b: unknown = {}) => call(token, 'PATCH', p, b),
    del: (p: string, b?: unknown) => call(token, 'DELETE', p, b),
  };
}

export type Client = ReturnType<typeof client> & { id: string; nickname: string };

export async function createUser(
  opts: { role?: 'member' | 'operator' | 'admin'; nickname?: string; showLastSeen?: boolean } = {}
): Promise<Client> {
  const id = uid('u');
  const nickname = opts.nickname ?? `nick_${id.slice(-5)}`;
  await env.DB.prepare(
    'INSERT INTO users (id, nickname, role, show_last_seen, created_at) VALUES (?, ?, ?, ?, ?)'
  )
    .bind(id, nickname, opts.role ?? 'member', opts.showLastSeen ? 1 : 0, Date.now())
    .run();
  const login = await call(null, 'POST', '/auth/dev-login', { userId: id });
  if (login.status !== 201) throw new Error('dev-login failed: ' + JSON.stringify(login.body));
  return { ...client(login.body.token), id, nickname };
}

export async function createStore(name = 'store') {
  const id = uid('s');
  await env.DB.prepare('INSERT INTO stores (id, name, region, created_at) VALUES (?, ?, ?, ?)')
    .bind(id, name, 'gangnam', Date.now())
    .run();
  return id;
}

export async function addStaff(storeId: string, userId: string, title = '실장', isOperator = false) {
  await env.DB.prepare('INSERT INTO store_staff (store_id, user_id, title, is_operator) VALUES (?, ?, ?, ?)')
    .bind(storeId, userId, title, isOperator ? 1 : 0)
    .run();
}

export async function createRoom(
  opts: { kind?: 'general' | 'store' | 'daily'; policy?: 'open' | 'approval'; capacity?: number | null; storeId?: string; manager?: string; title?: string } = {}
) {
  const id = uid('r');
  const kind = opts.kind ?? (opts.storeId ? 'store' : 'general');
  await env.DB.prepare(
    'INSERT INTO rooms (id, kind, title, region, join_policy, capacity, store_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  )
    .bind(id, kind, opts.title ?? 'room ' + id, 'gangnam', opts.policy ?? 'approval', opts.capacity ?? null, opts.storeId ?? null, Date.now())
    .run();
  if (opts.manager) {
    await env.DB.prepare(
      "INSERT INTO room_members (room_id, user_id, state, role, updated_at) VALUES (?, ?, 'active', 'manager', ?)"
    )
      .bind(id, opts.manager, Date.now())
      .run();
  }
  return id;
}

export const rid = () => uid('req') + 'abcdefgh';

/** Open a realtime socket for a channel and collect parsed events. */
export async function connect(c: Client, channel: string) {
  const t = await c.post('/realtime/tickets', { channel });
  if (t.status !== 201) throw new Error('ticket failed: ' + JSON.stringify(t.body));
  const res = await SELF.fetch(`https://api.test/realtime/ws?ticket=${encodeURIComponent(t.body.ticket)}`, {
    headers: { Upgrade: 'websocket' },
  });
  const ws = res.webSocket;
  if (!ws) throw new Error('no websocket, status ' + res.status);
  const events: any[] = [];
  const closed: { code?: number } = {};
  ws.addEventListener('message', e => {
    try {
      events.push(JSON.parse(e.data as string));
    } catch {
      events.push(e.data);
    }
  });
  ws.addEventListener('close', e => {
    closed.code = e.code;
  });
  ws.accept();
  await waitFor(() => events.some(e => e.type === 'ready'));
  return { ws, events, closed, ticket: t.body.ticket as string };
}

export async function waitFor(pred: () => boolean, timeoutMs = 2000) {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out');
    await new Promise(r => setTimeout(r, 5));
  }
}
