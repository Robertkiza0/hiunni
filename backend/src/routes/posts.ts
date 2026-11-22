import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv, AuthUser, Env } from '../env';
import { requireAuth } from '../lib/auth';
import {
  ApiError,
  decodeCursor,
  encodeCursor,
  forbidden,
  iso,
  likePattern,
  newId,
  notFound,
  parseLimit,
  parseWith,
  readBody,
} from '../lib/http';
import { notify } from '../lib/notify';

/**
 * F09 — Lounge board: server-side sort + cursor pagination, secret comments,
 * likes. "DM from post" lives in POST /dm/requests { postId }.
 *
 * Sort keys (all stable via id tiebreak):
 *   latest  = created_at DESC, id DESC   (최신순)
 *   oldest  = created_at ASC,  id ASC    (등록순)
 *   popular = like_count DESC, created_at DESC, id DESC (공감순)
 * Note: popular cursors are keyset-based; a like that lands between page loads
 * can move an item across the page boundary. Clients should dedupe by id.
 */
export const posts = new Hono<AppEnv>();
posts.use('*', requireAuth);

type Sort = 'latest' | 'oldest' | 'popular';
const sortSchema = z.enum(['latest', 'oldest', 'popular']).default('latest');

interface Keyed {
  id: string;
  created_at: number;
  like_count: number;
}
interface Cursor {
  s: Sort;
  c: number;
  i: string;
  l?: number;
}

function keyset(sort: Sort, cur: Cursor | null, alias: string): { sql: string; args: unknown[]; order: string } {
  const a = alias;
  const order = {
    latest: `${a}.created_at DESC, ${a}.id DESC`,
    oldest: `${a}.created_at ASC, ${a}.id ASC`,
    popular: `${a}.like_count DESC, ${a}.created_at DESC, ${a}.id DESC`,
  }[sort];
  if (!cur) return { sql: '', args: [], order };
  if (cur.s !== sort) throw new ApiError(400, 'invalid_cursor', 'cursor was issued for a different sort');
  if (sort === 'latest') return { sql: `AND (${a}.created_at < ? OR (${a}.created_at = ? AND ${a}.id < ?))`, args: [cur.c, cur.c, cur.i], order };
  if (sort === 'oldest') return { sql: `AND (${a}.created_at > ? OR (${a}.created_at = ? AND ${a}.id > ?))`, args: [cur.c, cur.c, cur.i], order };
  return {
    sql: `AND (${a}.like_count < ? OR (${a}.like_count = ? AND (${a}.created_at < ? OR (${a}.created_at = ? AND ${a}.id < ?))))`,
    args: [cur.l, cur.l, cur.c, cur.c, cur.i],
    order,
  };
}

const cursorFrom = (sort: Sort, r: Keyed): string =>
  encodeCursor({ s: sort, c: r.created_at, i: r.id, ...(sort === 'popular' ? { l: r.like_count } : {}) });

interface PostRow extends Keyed {
  author_id: string;
  nickname: string;
  board: string;
  category: string;
  title: string;
  body: string;
  is_notice: number;
  comment_count: number;
  liked: number;
}

const postOut = (r: PostRow, viewer: AuthUser, summaryOnly: boolean) => ({
  id: r.id,
  board: r.board,
  category: r.category,
  title: r.title,
  body: summaryOnly ? r.body.slice(0, 120) : r.body,
  author: { id: r.author_id, nickname: r.nickname },
  isNotice: !!r.is_notice,
  likeCount: r.like_count,
  commentCount: r.comment_count,
  likedByMe: !!r.liked,
  isMine: r.author_id === viewer.id,
  createdAt: iso(r.created_at),
});

const POST_SELECT = `SELECT p.*, u.nickname,
  EXISTS (SELECT 1 FROM post_likes l WHERE l.post_id = p.id AND l.user_id = ?) AS liked
  FROM posts p JOIN users u ON u.id = p.author_id`;
const NOT_BLOCKED = (col: string) => `NOT EXISTS (SELECT 1 FROM blocks b WHERE b.blocker_id = ? AND b.blocked_id = ${col})`;

posts.get('/', async c => {
  const viewer = c.get('user');
  const q = parseWith(
    z.object({
      board: z.string().min(1).max(40),
      category: z.string().max(40).optional(),
      sort: sortSchema,
      q: z.string().trim().min(1).max(60).optional(),
      cursor: z.string().optional(),
      display: z.enum(['summary', 'title', 'full']).default('summary'),
    }),
    c.req.query()
  );
  const limit = parseLimit(c.req.query('limit'));
  const ks = keyset(q.sort, decodeCursor<Cursor>(q.cursor), 'p');
  const filters: string[] = [];
  const fargs: unknown[] = [];
  if (q.category) (filters.push('p.category = ?'), fargs.push(q.category));
  if (q.q) (filters.push("(p.title LIKE ? ESCAPE '\\' OR p.body LIKE ? ESCAPE '\\')"), fargs.push(likePattern(q.q), likePattern(q.q)));
  // Pinned notices are fetched separately (/posts/notices) and never paginated here.
  const { results } = await c.env.DB.prepare(
    `${POST_SELECT}
      WHERE p.board = ? AND p.is_notice = 0 AND p.deleted_at IS NULL AND ${NOT_BLOCKED('p.author_id')}
        ${filters.map(f => 'AND ' + f).join(' ')} ${ks.sql}
      ORDER BY ${ks.order} LIMIT ?`
  )
    .bind(viewer.id, q.board, viewer.id, ...fargs, ...ks.args, limit + 1)
    .all<PostRow>();
  const page = results.slice(0, limit);
  return c.json({
    items: page.map(r => {
      const o = postOut(r, viewer, true);
      return q.display === 'title' ? { ...o, body: null } : q.display === 'full' ? postOut(r, viewer, false) : o;
    }),
    nextCursor: results.length > limit ? cursorFrom(q.sort, page[page.length - 1]!) : null,
    hasMore: results.length > limit,
  });
});

posts.get('/notices', async c => {
  const viewer = c.get('user');
  const board = parseWith(z.string().min(1).max(40), c.req.query('board'));
  const { results } = await c.env.DB.prepare(
    `${POST_SELECT} WHERE p.board = ? AND p.is_notice = 1 AND p.deleted_at IS NULL ORDER BY p.created_at DESC LIMIT 5`
  )
    .bind(viewer.id, board)
    .all<PostRow>();
  return c.json({ items: results.map(r => postOut(r, viewer, true)) });
});

posts.post('/', async c => {
  const me = c.get('user');
  const input = await readBody(
    c,
    z.object({
      board: z.string().min(1).max(40),
      category: z.string().min(1).max(40),
      title: z.string().trim().min(1).max(100),
      body: z.string().trim().min(1).max(10_000),
      isNotice: z.boolean().optional(),
      mutationId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
    })
  );
  if (input.isNotice && me.role !== 'admin') throw forbidden('admin_only', 'only admins can post notices');
  const id = newId();
  const ins = await c.env.DB.prepare(
    `INSERT INTO posts (id, author_id, board, category, title, body, is_notice, mutation_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (author_id, mutation_id) DO NOTHING RETURNING id`
  )
    .bind(id, me.id, input.board, input.category, input.title, input.body, input.isNotice ? 1 : 0, input.mutationId, Date.now())
    .first<{ id: string }>();
  const postId = ins?.id ?? (await c.env.DB.prepare('SELECT id FROM posts WHERE author_id = ? AND mutation_id = ?').bind(me.id, input.mutationId).first<{ id: string }>())!.id;
  const row = await c.env.DB.prepare(`${POST_SELECT} WHERE p.id = ?`).bind(me.id, postId).first<PostRow>();
  return c.json({ post: postOut(row!, me, false), duplicate: !ins }, ins ? 201 : 200);
});

async function loadPost(env: Env, id: string, viewerId: string) {
  const r = await env.DB.prepare(`${POST_SELECT} WHERE p.id = ? AND p.deleted_at IS NULL`).bind(viewerId, id).first<PostRow>();
  if (!r) throw notFound('post');
  return r;
}

posts.get('/:id', async c => {
  const viewer = c.get('user');
  return c.json(postOut(await loadPost(c.env, c.req.param('id'), viewer.id), viewer, false));
});

posts.delete('/:id', async c => {
  const me = c.get('user');
  const p = await loadPost(c.env, c.req.param('id'), me.id);
  if (p.author_id !== me.id && me.role !== 'admin') throw forbidden('author_only');
  await c.env.DB.prepare('UPDATE posts SET deleted_at = ? WHERE id = ?').bind(Date.now(), p.id).run();
  return c.body(null, 204);
});

async function setLike(env: Env, table: 'post_likes' | 'comment_likes', target: 'posts' | 'comments', id: string, userId: string, on: boolean) {
  const col = table === 'post_likes' ? 'post_id' : 'comment_id';
  const [, , cnt] = await env.DB.batch([
    on
      ? env.DB.prepare(`INSERT OR IGNORE INTO ${table} (${col}, user_id, created_at) VALUES (?, ?, ?)`).bind(id, userId, Date.now())
      : env.DB.prepare(`DELETE FROM ${table} WHERE ${col} = ? AND user_id = ?`).bind(id, userId),
    env.DB.prepare(`UPDATE ${target} SET like_count = (SELECT COUNT(*) FROM ${table} WHERE ${col} = ?1) WHERE id = ?1`).bind(id),
    env.DB.prepare(`SELECT like_count FROM ${target} WHERE id = ?`).bind(id),
  ]);
  return { liked: on, likeCount: (cnt!.results[0] as { like_count: number }).like_count };
}

posts.put('/:id/like', async c => {
  const p = await loadPost(c.env, c.req.param('id'), c.get('user').id);
  return c.json(await setLike(c.env, 'post_likes', 'posts', p.id, c.get('user').id, true));
});
posts.delete('/:id/like', async c => {
  const p = await loadPost(c.env, c.req.param('id'), c.get('user').id);
  return c.json(await setLike(c.env, 'post_likes', 'posts', p.id, c.get('user').id, false));
});

// ── Comments ───────────────────────────────────────────────────────────
interface CommentRow extends Keyed {
  post_id: string;
  author_id: string;
  nickname: string;
  body: string;
  is_secret: number;
  liked: number;
}

/** Secret comment: visible only to its author, the post author, and admins. */
function commentOut(r: CommentRow, viewer: AuthUser, postAuthorId: string) {
  const canSee = !r.is_secret || r.author_id === viewer.id || postAuthorId === viewer.id || viewer.role === 'admin';
  return {
    id: r.id,
    isSecret: !!r.is_secret,
    visible: canSee,
    body: canSee ? r.body : null,
    author: canSee ? { id: r.author_id, nickname: r.nickname } : null,
    likeCount: r.like_count,
    likedByMe: !!r.liked,
    isMine: r.author_id === viewer.id,
    createdAt: iso(r.created_at),
  };
}

const COMMENT_SELECT = `SELECT cm.*, u.nickname,
  EXISTS (SELECT 1 FROM comment_likes l WHERE l.comment_id = cm.id AND l.user_id = ?) AS liked
  FROM comments cm JOIN users u ON u.id = cm.author_id`;

posts.get('/:id/comments', async c => {
  const viewer = c.get('user');
  const post = await loadPost(c.env, c.req.param('id'), viewer.id);
  const sort = parseWith(sortSchema.default('oldest'), c.req.query('sort'));
  const limit = parseLimit(c.req.query('limit'), 30, 100);
  const ks = keyset(sort, decodeCursor<Cursor>(c.req.query('cursor')), 'cm');
  const { results } = await c.env.DB.prepare(
    `${COMMENT_SELECT} WHERE cm.post_id = ? AND cm.deleted_at IS NULL AND ${NOT_BLOCKED('cm.author_id')} ${ks.sql}
      ORDER BY ${ks.order} LIMIT ?`
  )
    .bind(viewer.id, post.id, viewer.id, ...ks.args, limit + 1)
    .all<CommentRow>();
  const page = results.slice(0, limit);
  return c.json({
    items: page.map(r => commentOut(r, viewer, post.author_id)),
    nextCursor: results.length > limit ? cursorFrom(sort, page[page.length - 1]!) : null,
    hasMore: results.length > limit,
  });
});

posts.post('/:id/comments', async c => {
  const me = c.get('user');
  const post = await loadPost(c.env, c.req.param('id'), me.id);
  const input = await readBody(
    c,
    z.object({
      body: z.string().trim().min(1).max(2000),
      isSecret: z.boolean().default(false),
      mutationId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
    })
  );
  const id = newId();
  const now = Date.now();
  const ins = await c.env.DB.prepare(
    `INSERT INTO comments (id, post_id, author_id, body, is_secret, mutation_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (author_id, mutation_id) DO NOTHING RETURNING id`
  )
    .bind(id, post.id, me.id, input.body, input.isSecret ? 1 : 0, input.mutationId, now)
    .first<{ id: string }>();
  if (ins) {
    await c.env.DB.prepare(
      'UPDATE posts SET comment_count = (SELECT COUNT(*) FROM comments WHERE post_id = ?1 AND deleted_at IS NULL) WHERE id = ?1'
    )
      .bind(post.id)
      .run();
    if (post.author_id !== me.id) {
      await notify(c.env, {
        userId: post.author_id,
        type: 'comment',
        title: input.isSecret ? '내 글에 비밀 댓글이 달렸습니다' : '내 글에 새 댓글이 달렸습니다',
        body: input.body.slice(0, 80),
        link: `/posts/${post.id}`,
        sensitive: input.isSecret, // secret comment text never leaves via notifications
      });
    }
  }
  const commentId = ins?.id ?? (await c.env.DB.prepare('SELECT id FROM comments WHERE author_id = ? AND mutation_id = ?').bind(me.id, input.mutationId).first<{ id: string }>())!.id;
  const row = await c.env.DB.prepare(`${COMMENT_SELECT} WHERE cm.id = ?`).bind(me.id, commentId).first<CommentRow>();
  return c.json({ comment: commentOut(row!, me, post.author_id), duplicate: !ins }, ins ? 201 : 200);
});

export const comments = new Hono<AppEnv>();
comments.use('*', requireAuth);

async function loadComment(env: Env, id: string) {
  const r = await env.DB.prepare('SELECT id, post_id, author_id FROM comments WHERE id = ? AND deleted_at IS NULL')
    .bind(id)
    .first<{ id: string; post_id: string; author_id: string }>();
  if (!r) throw notFound('comment');
  return r;
}

comments.put('/:id/like', async c => {
  const cm = await loadComment(c.env, c.req.param('id'));
  return c.json(await setLike(c.env, 'comment_likes', 'comments', cm.id, c.get('user').id, true));
});
comments.delete('/:id/like', async c => {
  const cm = await loadComment(c.env, c.req.param('id'));
  return c.json(await setLike(c.env, 'comment_likes', 'comments', cm.id, c.get('user').id, false));
});
comments.delete('/:id', async c => {
  const me = c.get('user');
  const cm = await loadComment(c.env, c.req.param('id'));
  if (cm.author_id !== me.id && me.role !== 'admin') throw forbidden('author_only');
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE comments SET deleted_at = ? WHERE id = ?').bind(Date.now(), cm.id),
    c.env.DB.prepare(
      'UPDATE posts SET comment_count = (SELECT COUNT(*) FROM comments WHERE post_id = ?1 AND deleted_at IS NULL) WHERE id = ?1'
    ).bind(cm.post_id),
  ]);
  return c.body(null, 204);
});
