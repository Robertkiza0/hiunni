import { DurableObject } from 'cloudflare:workers';
import type { Env } from '../env';

/**
 * F03 — one Durable Object per realtime channel ('room:<id>', 'dm:<id>', 'status').
 *
 * Design: the hub is a fan-out point only. All writes go through the HTTP API
 * (idempotent by requestId, persisted to D1 first), and the API then calls
 * broadcast() here. Clients therefore never lose a message that was acknowledged,
 * and after a reconnect they backfill with `GET ...messages?afterSeq=<last seq>`.
 *
 * Uses the WebSocket Hibernation API so idle sockets cost nothing. 'ping' is
 * answered with 'pong' by the runtime without waking the object.
 *
 * The Worker only forwards an upgrade here after validating a single-use ticket,
 * and sets X-Hub-User itself; clients cannot address the DO directly.
 */
export class ChannelHub extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  async fetch(request: Request): Promise<Response> {
    const userId = request.headers.get('X-Hub-User');
    if (request.headers.get('Upgrade') !== 'websocket' || !userId) {
      return new Response('expected websocket upgrade', { status: 426 });
    }
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server, [userId]);
    server.send(JSON.stringify({ type: 'ready', serverTime: Date.now() }));
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    // Receive-only channel: writes must use the HTTP API so they are persisted and idempotent.
    if (typeof message === 'string' && message !== 'ping') {
      ws.send(JSON.stringify({ type: 'error', code: 'use_http_api_to_send' }));
    }
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    try {
      ws.close(code, reason);
    } catch {
      /* already closed */
    }
  }

  /** Send an event to every socket on this channel. Returns the number of recipients. */
  async broadcast(event: unknown): Promise<number> {
    const data = JSON.stringify(event);
    let n = 0;
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(data);
        n++;
      } catch {
        /* socket closing; ignore */
      }
    }
    return n;
  }

  /** Permission revoked (left, kicked, blocked, room closed): close that user's sockets. */
  async revoke(userId: string, reason: string): Promise<void> {
    for (const ws of this.ctx.getWebSockets(userId)) closeWithNotice(ws, reason);
  }

  async closeAll(reason: string): Promise<void> {
    for (const ws of this.ctx.getWebSockets()) closeWithNotice(ws, reason);
  }

  async connectionCount(): Promise<number> {
    return this.ctx.getWebSockets().length;
  }
}

function closeWithNotice(ws: WebSocket, reason: string) {
  try {
    ws.send(JSON.stringify({ type: 'revoked', reason }));
    ws.close(4003, reason);
  } catch {
    /* already closed */
  }
}
