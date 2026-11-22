import { addDays, kstParts, weekdayOf } from './time';

/**
 * F10 business-hours logic (pure, KST).
 *
 * An interval belongs to the business day it opens on. closeMin may exceed 1440
 * when it crosses midnight: Friday 20:00–03:00 is {weekday: 5, openMin: 1200, closeMin: 1620},
 * so it is still "open" at Saturday 01:00. A closure date removes all intervals that
 * open on that day (including their after-midnight tail).
 *
 * Definitions (mock-spec values; align with the production policy once received):
 *  - lateNight(date): any opening overlaps 22:00 on `date` → 06:00 the next day.
 *  - allDay(date):    00:00–24:00 of `date` is fully covered (by `date` intervals and
 *                     the previous day's after-midnight tail).
 *  - weekend:         has registered hours on Saturday or Sunday (weekly pattern,
 *                     independent of a specific date's closure).
 *  - known:           any hours registered. Unknown is NOT the same as closed.
 */
export interface Interval {
  weekday: number;
  openMin: number;
  closeMin: number;
}

export interface Hours {
  intervals: Interval[];
  closures: Set<string>;
}

const LATE_START = 22 * 60;
const LATE_END = 30 * 60; // 06:00 next day

/** Intervals opening on `date`, as [start, end) minutes relative to `date` 00:00. */
function opensOn(h: Hours, date: string): [number, number][] {
  if (h.closures.has(date)) return [];
  const wd = weekdayOf(date);
  return h.intervals.filter(i => i.weekday === wd).map(i => [i.openMin, i.closeMin]);
}

const overlaps = (a: [number, number], s: number, e: number) => a[0] < e && s < a[1];

export const hoursKnown = (h: Hours) => h.intervals.length > 0;

export function isOpenAt(h: Hours, ms: number): boolean {
  const { date, minute } = kstParts(ms);
  if (opensOn(h, date).some(([s, e]) => s <= minute && minute < e)) return true;
  const m = minute + 1440;
  return opensOn(h, addDays(date, -1)).some(([s, e]) => s <= m && m < e);
}

export function isLateNight(h: Hours, date: string): boolean {
  if (opensOn(h, date).some(iv => overlaps(iv, LATE_START, LATE_END))) return true;
  // Next day's early-morning opening (e.g. Sat 02:00) also falls inside the window.
  return opensOn(h, addDays(date, 1)).some(([s, e]) => overlaps([s + 1440, e + 1440], LATE_START, LATE_END));
}

export function isAllDay(h: Hours, date: string): boolean {
  const segs: [number, number][] = [
    ...opensOn(h, date),
    ...opensOn(h, addDays(date, -1)).map(([s, e]) => [s - 1440, e - 1440] as [number, number]),
  ]
    .map(([s, e]) => [Math.max(0, s), Math.min(1440, e)] as [number, number])
    .filter(([s, e]) => e > s)
    .sort((a, b) => a[0] - b[0]);
  let covered = 0;
  for (const [s, e] of segs) {
    if (s > covered) return false;
    covered = Math.max(covered, e);
    if (covered >= 1440) return true;
  }
  return false;
}

export const hasWeekendHours = (h: Hours) => h.intervals.some(i => i.weekday === 0 || i.weekday === 6);

export function validateInterval(i: Interval): string | null {
  if (!Number.isInteger(i.weekday) || i.weekday < 0 || i.weekday > 6) return 'weekday must be 0..6';
  if (!Number.isInteger(i.openMin) || i.openMin < 0 || i.openMin > 1439) return 'openMin must be 0..1439';
  if (!Number.isInteger(i.closeMin) || i.closeMin <= i.openMin || i.closeMin > i.openMin + 1440) {
    return 'closeMin must be > openMin and at most 24h later';
  }
  return null;
}
