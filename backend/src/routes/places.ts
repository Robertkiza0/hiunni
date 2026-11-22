import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv, Env } from '../env';
import { requireAuth } from '../lib/auth';
import { decodeCursor, encodeCursor, forbidden, likePattern, notFound, parseLimit, parseWith, readBody } from '../lib/http';
import {
  hasWeekendHours,
  hoursKnown,
  isAllDay,
  isLateNight,
  isOpenAt,
  validateInterval,
  type Hours,
  type Interval,
} from '../lib/hours';
import { formatHm, isDateString, kstParts } from '../lib/time';

/**
 * F10 — Places with late-night / 24h / weekend filters. Hours are evaluated in
 * KST from the place_hours rows (see lib/hours.ts for definitions). Because the
 * filters are computed from interval data, the list scans in id order in
 * bounded batches and returns a cursor at the last scanned row, so filtered
 * pages are correct and never skip items.
 */
export const places = new Hono<AppEnv>();
places.use('*', requireAuth);

const FILTERS = ['lateNight', 'allDay', 'weekend', 'openNow'] as const;
type Filter = (typeof FILTERS)[number];
const SCAN_BATCH = 100;
const MAX_SCAN = 2000;

interface PlaceRow {
  id: string;
  name: string;
  category: string;
  region: string;
  recommended: number;
}

async function loadHours(env: Env, ids: string[]): Promise<Map<string, Hours>> {
  const map = new Map<string, Hours>(ids.map(id => [id, { intervals: [], closures: new Set() }]));
  if (!ids.length) return map;
  const ph = ids.map(() => '?').join(',');
  const [iv, cl] = await env.DB.batch([
    env.DB.prepare(`SELECT place_id, weekday, open_min, close_min FROM place_hours WHERE place_id IN (${ph})`).bind(...ids),
    env.DB.prepare(`SELECT place_id, date FROM place_closures WHERE place_id IN (${ph})`).bind(...ids),
  ]);
  for (const r of iv!.results as { place_id: string; weekday: number; open_min: number; close_min: number }[]) {
    map.get(r.place_id)!.intervals.push({ weekday: r.weekday, openMin: r.open_min, closeMin: r.close_min });
  }
  for (const r of cl!.results as { place_id: string; date: string }[]) map.get(r.place_id)!.closures.add(r.date);
  return map;
}

function summarize(h: Hours, date: string, now: number) {
  const known = hoursKnown(h);
  return {
    hoursStatus: known ? 'known' : 'unknown', // unknown ≠ closed
    closedOnDate: h.closures.has(date),
    lateNight: known ? isLateNight(h, date) : null,
    allDay: known ? isAllDay(h, date) : null,
    weekend: known ? hasWeekendHours(h) : null,
    openNow: known ? isOpenAt(h, now) : null,
  };
}

const matches = (s: ReturnType<typeof summarize>, filters: Filter[]) => filters.every(f => s[f] === true);

places.get('/', async c => {
  const viewer = c.get('user');
  const now = Date.now();
  const q = parseWith(
    z.object({
      category: z.string().max(40).optional(),
      region: z.string().max(40).optional(),
      q: z.string().trim().min(1).max(60).optional(),
      filter: z
        .string()
        .optional()
        .transform(s => (s ? s.split(',').filter(Boolean) : []))
        .pipe(z.array(z.enum(FILTERS))),
      date: z.string().refine(isDateString, 'date must be YYYY-MM-DD').optional(),
      saved: z.enum(['true', 'false']).optional(),
      cursor: z.string().optional(),
    }),
    c.req.query()
  );
  const limit = parseLimit(c.req.query('limit'));
  const date = q.date ?? kstParts(now).date;
  let after = decodeCursor<{ i: string }>(q.cursor)?.i ?? '';

  const where = ['p.id > ?'];
  const args: unknown[] = [];
  if (q.category) (where.push('p.category = ?'), args.push(q.category));
  if (q.region) (where.push('p.region = ?'), args.push(q.region));
  if (q.q) (where.push("p.name LIKE ? ESCAPE '\\'"), args.push(likePattern(q.q)));
  if (q.saved === 'true') {
    where.push("EXISTS (SELECT 1 FROM saved_items s WHERE s.user_id = ? AND s.target_type = 'place' AND s.target_id = p.id)");
    args.push(viewer.id);
  }

  const out: (PlaceRow & { summary: ReturnType<typeof summarize> })[] = [];
  let scanned = 0;
  let exhausted = false;
  while (out.length < limit && scanned < MAX_SCAN) {
    const { results } = await c.env.DB.prepare(
      `SELECT p.id, p.name, p.category, p.region, p.recommended FROM places p WHERE ${where.join(' AND ')} ORDER BY p.id LIMIT ?`
    )
      .bind(after, ...args, SCAN_BATCH)
      .all<PlaceRow>();
    if (!results.length) {
      exhausted = true;
      break;
    }
    const hours = await loadHours(c.env, results.map(r => r.id));
    for (const r of results) {
      scanned++;
      after = r.id;
      const summary = summarize(hours.get(r.id)!, date, now);
      if (matches(summary, q.filter)) out.push({ ...r, summary });
      if (out.length === limit) break;
    }
    if (results.length < SCAN_BATCH && out.length < limit) {
      exhausted = true;
      break;
    }
  }
  // If we filled the page exactly at the end of the table, a follow-up call returns an empty page.
  const hasMore = !exhausted;
  const savedSet = new Set<string>();
  if (out.length) {
    const { results } = await c.env.DB.prepare(
      `SELECT target_id FROM saved_items WHERE user_id = ? AND target_type = 'place' AND target_id IN (${out.map(() => '?').join(',')})`
    )
      .bind(viewer.id, ...out.map(o => o.id))
      .all<{ target_id: string }>();
    results.forEach(r => savedSet.add(r.target_id));
  }
  return c.json({
    date,
    items: out.map(p => ({
      id: p.id,
      name: p.name,
      category: p.category,
      region: p.region,
      recommended: !!p.recommended,
      saved: savedSet.has(p.id),
      ...p.summary,
    })),
    nextCursor: hasMore ? encodeCursor({ i: after }) : null,
    hasMore,
  });
});

places.get('/:id', async c => {
  const p = await c.env.DB.prepare('SELECT id, name, category, region, recommended FROM places WHERE id = ?')
    .bind(c.req.param('id'))
    .first<PlaceRow>();
  if (!p) throw notFound('place');
  const date = parseWith(z.string().refine(isDateString).optional(), c.req.query('date')) ?? kstParts(Date.now()).date;
  const h = (await loadHours(c.env, [p.id])).get(p.id)!;
  return c.json({
    id: p.id,
    name: p.name,
    category: p.category,
    region: p.region,
    recommended: !!p.recommended,
    hours: h.intervals
      .sort((a, b) => a.weekday - b.weekday || a.openMin - b.openMin)
      .map(i => ({
        weekday: i.weekday,
        open: formatHm(i.openMin),
        close: i.closeMin === 1440 ? '24:00' : formatHm(i.closeMin % 1440),
        overnight: i.closeMin > 1440, // closes the next calendar day
      })),
    closures: [...h.closures].sort(),
    date,
    ...summarize(h, date, Date.now()),
  });
});

/** Replace a place's weekly hours (admin/operator). */
places.put('/:id/hours', async c => {
  const me = c.get('user');
  if (me.role === 'member') throw forbidden('operator_only');
  const id = c.req.param('id');
  const exists = await c.env.DB.prepare('SELECT 1 FROM places WHERE id = ?').bind(id).first();
  if (!exists) throw notFound('place');
  const { intervals, closures } = await readBody(
    c,
    z.object({
      intervals: z
        .array(z.object({ weekday: z.number().int(), openMin: z.number().int(), closeMin: z.number().int() }))
        .max(50)
        .superRefine((list, ctx) => {
          list.forEach((i, idx) => {
            const err = validateInterval(i as Interval);
            if (err) ctx.addIssue({ code: 'custom', path: [idx], message: err });
          });
        }),
      closures: z.array(z.string().refine(isDateString)).max(366).default([]),
    })
  );
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM place_hours WHERE place_id = ?').bind(id),
    c.env.DB.prepare('DELETE FROM place_closures WHERE place_id = ?').bind(id),
    ...intervals.map(i =>
      c.env.DB.prepare('INSERT INTO place_hours (place_id, weekday, open_min, close_min) VALUES (?, ?, ?, ?)').bind(id, i.weekday, i.openMin, i.closeMin)
    ),
    ...[...new Set(closures)].map(d => c.env.DB.prepare('INSERT INTO place_closures (place_id, date) VALUES (?, ?)').bind(id, d)),
  ]);
  return c.json({ ok: true, intervals: intervals.length, closures: closures.length });
});
