import { z } from 'zod';
import type { Env } from '../env';
import { ApiError, iso, newId } from './http';

export const sendSchema = z
  .object({
    requestId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/, 'requestId: 8-64 chars [A-Za-z0-9_-]'),
    body: z.string().trim().min(1).max(2000).optional(),
    mediaId: z.string().max(64).optional(),
  })
  .refine(v => v.body !== undefined || v.mediaId !== undefined, 'body or mediaId is required');

type Table = 'room_messages' | 'dm_messages';
const SCOPE: Record<Table, string> = { room_messages: 'room_id', dm_messages: 'conversation_id' };

interface Row {
  seq: number;
  id: string;
  sender_id: string;
  body: string | null;
  media_id: string | null;
  created_at: number;
}

export const toMessage = (r: Row) => ({
  id: r.id,
  seq: r.seq,
  senderId: r.sender_id,
  body: r.body,
  mediaId: r.media_id,
  createdAt: iso(r.created_at),
});

export async function assertOwnMedia(env: Env, mediaId: string, userId: string) {
  const m = await env.DB.prepare(
    'SELECT 1 FROM media WHERE id = ? AND owner_id = ? AND deleted_at IS NULL'
  )
    .bind(mediaId, userId)
    .first();
  if (!m) throw new ApiError(400, 'invalid_media', 'mediaId must be your own uploaded media');
}

/**
 * Idempotent insert keyed by (scope, sender, requestId). A retry after a lost
 * response returns the original message with duplicate=true; the same requestId
 * with a different payload is a 409 conflict.
 */
export async function insertMessage(
  env: Env,
  table: Table,
  scopeId: string,
  senderId: string,
  input: z.infer<typeof sendSchema>
): Promise<{ message: ReturnType<typeof toMessage>; duplicate: boolean }> {
  const col = SCOPE[table];
  const body = input.body ?? null;
  const mediaId = input.mediaId ?? null;
  const inserted = await env.DB.prepare(
    `INSERT INTO ${table} (id, ${col}, sender_id, body, media_id, request_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (${col}, sender_id, request_id) DO NOTHING
     RETURNING seq, id, sender_id, body, media_id, created_at`
  )
    .bind(newId(), scopeId, senderId, body, mediaId, input.requestId, Date.now())
    .first<Row>();
  if (inserted) return { message: toMessage(inserted), duplicate: false };

  const existing = await env.DB.prepare(
    `SELECT seq, id, sender_id, body, media_id, created_at FROM ${table}
      WHERE ${col} = ? AND sender_id = ? AND request_id = ?`
  )
    .bind(scopeId, senderId, input.requestId)
    .first<Row>();
  if (!existing) throw new ApiError(500, 'insert_failed');
  if (existing.body !== body || existing.media_id !== mediaId) {
    throw new ApiError(409, 'request_id_conflict', 'requestId was already used with a different payload');
  }
  return { message: toMessage(existing), duplicate: true };
}
