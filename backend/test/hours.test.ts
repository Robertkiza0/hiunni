import { describe, expect, it } from 'vitest';
import { hasWeekendHours, hoursKnown, isAllDay, isLateNight, isOpenAt, validateInterval, type Hours } from '../src/lib/hours';
import { inDnd } from '../src/lib/notify';
import { weekdayOf } from '../src/lib/time';

const kst = (s: string) => Date.parse(s + '+09:00');
const FRI = '2026-11-20';
const SAT = '2026-11-21';
const hm = (h: number, m = 0) => h * 60 + m;

const hours = (intervals: Hours['intervals'], closures: string[] = []): Hours => ({ intervals, closures: new Set(closures) });

describe('F10 business hours (KST)', () => {
  it('test dates are the weekdays we think they are', () => {
    expect(weekdayOf(FRI)).toBe(5);
    expect(weekdayOf(SAT)).toBe(6);
  });

  // Friday 20:00 – Saturday 03:00
  const bar = hours([{ weekday: 5, openMin: hm(20), closeMin: hm(27) }]);

  it('Friday→Saturday midnight: open at Sat 01:00, closed at Sat 03:00', () => {
    expect(isOpenAt(bar, kst('2026-11-20T23:59:00'))).toBe(true);
    expect(isOpenAt(bar, kst('2026-11-21T00:00:00'))).toBe(true);
    expect(isOpenAt(bar, kst('2026-11-21T01:00:00'))).toBe(true);
    expect(isOpenAt(bar, kst('2026-11-21T03:00:00'))).toBe(false);
    expect(isOpenAt(bar, kst('2026-11-20T19:59:00'))).toBe(false);
  });

  it('late night is judged on the business day the interval opens', () => {
    expect(isLateNight(bar, FRI)).toBe(true);
    // Saturday's own window (22:00 Sat–06:00 Sun) has no opening.
    expect(isLateNight(bar, SAT)).toBe(false);
  });

  it('an early-morning opening on the next day counts for the previous night', () => {
    const earlyCafe = hours([{ weekday: 6, openMin: hm(5), closeMin: hm(12) }]); // Sat 05:00–12:00
    expect(isLateNight(earlyCafe, FRI)).toBe(true);
    const lunch = hours([{ weekday: 5, openMin: hm(11), closeMin: hm(21) }]);
    expect(isLateNight(lunch, FRI)).toBe(false);
    // Ending exactly at 22:00 does not overlap.
    expect(isLateNight(hours([{ weekday: 5, openMin: hm(12), closeMin: hm(22) }]), FRI)).toBe(false);
  });

  it('closure on Friday removes its after-midnight tail too', () => {
    const closed = hours(bar.intervals, [FRI]);
    expect(isOpenAt(closed, kst('2026-11-21T01:00:00'))).toBe(false);
    expect(isLateNight(closed, FRI)).toBe(false);
  });

  it('24h: single full-day interval, and chained overnight intervals', () => {
    expect(isAllDay(hours([{ weekday: 5, openMin: 0, closeMin: 1440 }]), FRI)).toBe(true);
    // Thu 18:00 → Fri 06:00, then Fri 06:00 → Sat 06:00 covers all of Friday.
    const chained = hours([
      { weekday: 4, openMin: hm(18), closeMin: hm(30) },
      { weekday: 5, openMin: hm(6), closeMin: hm(30) },
    ]);
    expect(isAllDay(chained, FRI)).toBe(true);
    const gap = hours([
      { weekday: 4, openMin: hm(18), closeMin: hm(29) },
      { weekday: 5, openMin: hm(6), closeMin: hm(30) },
    ]);
    expect(isAllDay(gap, FRI)).toBe(false);
  });

  it('weekend and unknown hours', () => {
    expect(hasWeekendHours(bar)).toBe(false);
    expect(hasWeekendHours(hours([{ weekday: 0, openMin: hm(10), closeMin: hm(20) }]))).toBe(true);
    expect(hoursKnown(hours([]))).toBe(false);
  });

  it('rejects malformed intervals', () => {
    expect(validateInterval({ weekday: 7, openMin: 0, closeMin: 10 })).not.toBeNull();
    expect(validateInterval({ weekday: 1, openMin: 600, closeMin: 600 })).not.toBeNull();
    expect(validateInterval({ weekday: 1, openMin: 600, closeMin: 600 + 1441 })).not.toBeNull();
    expect(validateInterval({ weekday: 1, openMin: 1200, closeMin: 1620 })).toBeNull();
  });
});

describe('F05 do-not-disturb window (KST)', () => {
  it('handles windows that wrap midnight', () => {
    const p = { dndStart: hm(23), dndEnd: hm(7) };
    expect(inDnd(p, kst('2026-11-20T23:30:00'))).toBe(true);
    expect(inDnd(p, kst('2026-11-21T06:59:00'))).toBe(true);
    expect(inDnd(p, kst('2026-11-21T07:00:00'))).toBe(false);
    expect(inDnd(p, kst('2026-11-21T12:00:00'))).toBe(false);
    expect(inDnd({ dndStart: null, dndEnd: null }, kst('2026-11-21T00:00:00'))).toBe(false);
  });
});
