import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { z } from 'zod';

export class ApiError extends Error {
  constructor(
    public status: ContentfulStatusCode,
    public code: string,
    message?: string,
    public details?: Record<string, unknown>
  ) {
    super(message ?? code);
  }
}

export const notFound = (what = 'resource') => new ApiError(404, 'not_found', `${what} not found`);
export const forbidden = (code = 'forbidden', message?: string) => new ApiError(403, code, message);

export async function readBody<T extends z.ZodType>(c: Context, schema: T): Promise<z.infer<T>> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw new ApiError(400, 'invalid_json');
  }
  return parseWith(schema, raw);
}

export function parseWith<T extends z.ZodType>(schema: T, raw: unknown): z.infer<T> {
  const r = schema.safeParse(raw);
  if (!r.success) {
    const msg = r.error.issues.map(i => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');
    throw new ApiError(400, 'validation_failed', msg);
  }
  return r.data;
}

export const iso = (ms: number | null | undefined): string | null =>
  ms == null ? null : new Date(ms).toISOString();

// Cursors are opaque base64url JSON. Clients must not parse them.
export function encodeCursor(v: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(v));
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decodeCursor<T>(s: string | undefined | null): T | null {
  if (!s) return null;
  try {
    const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
    const bytes = Uint8Array.from(bin, ch => ch.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes)) as T;
  } catch {
    throw new ApiError(400, 'invalid_cursor');
  }
}

export function parseLimit(v: string | undefined, def = 20, max = 50): number {
  if (v === undefined) return def;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > max) {
    throw new ApiError(400, 'invalid_limit', `limit must be an integer 1..${max}`);
  }
  return n;
}

/** Time-prefixed id: lexicographically roughly sortable, 21 chars, opaque to clients. */
export function newId(): string {
  const t = Date.now().toString(36).padStart(9, '0');
  const r = crypto.getRandomValues(new Uint8Array(12));
  return t + Array.from(r, b => (b % 36).toString(36)).join('');
}

/** Escape LIKE wildcards; use with `LIKE ? ESCAPE '\\'`. */
export const likePattern = (q: string) => `%${q.replace(/[\\%_]/g, m => '\\' + m)}%`;
