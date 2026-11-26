import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { AppEnv } from './env';
import { ApiError } from './lib/http';
import { drainOutbox, fcmConfig } from './lib/push-send';
import { auth, me, notifications, push, safety } from './routes/account';
import { dm } from './routes/dm';
import { media } from './routes/media';
import { places } from './routes/places';
import { comments, posts } from './routes/posts';
import { realtime } from './routes/realtime';
import { rooms } from './routes/rooms';

export { ChannelHub } from './do/channel-hub';

const app = new Hono<AppEnv>();

app.use('*', async (c, next) => {
  const allowed = (c.env.ALLOWED_ORIGINS ?? '').split(',').map(s => s.trim()).filter(Boolean);
  return cors({
    origin: origin => (allowed.includes(origin) ? origin : null),
    allowHeaders: ['Authorization', 'Content-Type'],
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    maxAge: 600,
  })(c, next);
});

// F05: after a write (a comment, a DM, a status report…) send whatever it queued straight away.
// The cron trigger below picks up anything this misses, plus retries.
app.use('*', async (c, next) => {
  await next();
  if (c.req.method !== 'GET' && c.req.method !== 'OPTIONS' && fcmConfig(c.env)) {
    c.executionCtx.waitUntil(drainOutbox(c.env).catch(e => console.error('push drain', e)));
  }
});

app.get('/health', c => c.json({ ok: true, service: 'hiunni-api', environment: c.env.ENVIRONMENT }));

app.route('/auth', auth);
app.route('/me', me);
app.route('/safety', safety);
app.route('/push', push);
app.route('/notifications', notifications);
app.route('/media', media);
app.route('/realtime', realtime);
app.route('/rooms', rooms);
app.route('/dm', dm);
app.route('/posts', posts);
app.route('/comments', comments);
app.route('/places', places);

app.notFound(c => c.json({ error: { code: 'not_found', message: 'route not found' } }, 404));

app.onError((err, c) => {
  if (err instanceof ApiError) {
    return c.json({ error: { code: err.code, message: err.message, ...(err.details ?? {}) } }, err.status);
  }
  console.error('unhandled', err);
  return c.json({ error: { code: 'internal', message: 'internal error' } }, 500);
});

export default {
  fetch: app.fetch,
  // Every minute (wrangler.jsonc "triggers"): deliver queued pushes and retries.
  async scheduled(_event: ScheduledController, env: AppEnv['Bindings'], ctx: ExecutionContext) {
    ctx.waitUntil(drainOutbox(env).then(r => r.paused && console.warn('push paused', r.paused)));
  },
} satisfies ExportedHandler<AppEnv['Bindings']>;
