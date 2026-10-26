import type { HistoryStore } from "../adapters/types.js";
import { config } from "../config.js";
import { addDays, weekday } from "../time.js";
import type { BinBase, IntervalLabel, Zone, ZoneBase, ZoneSchedule } from "../types.js";

const f = config.frequency;
const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;

export interface Interval {
  days_to_85: number;
  interval_days: number;
  interval_label: IntervalLabel;
}

/** days_to_85 = (85 - 10) / rate; bands from CLAUDE.md §4. */
export function intervalFor(ratePctPerDay: number): Interval {
  const days = (f.targetPct - f.startPct) / Math.max(ratePctPerDay, 0.01);
  const base = { days_to_85: round2(days) };
  if (days < f.dailyBelowDays) return { ...base, interval_days: 1, interval_label: "daily" };
  if (days < f.every2BelowDays) return { ...base, interval_days: 2, interval_label: "every_2_days" };
  if (days < f.every3BelowDays) return { ...base, interval_days: 3, interval_label: "every_3_days" };
  return { ...base, interval_days: f.twiceAWeekIntervalDays, interval_label: "twice_a_week" };
}

/** Collection dates from `today` over the calendar horizon, today included. */
export function buildCalendar(interval: Interval, lastCollection: string, today: string): string[] {
  const dates: string[] = [];
  if (interval.interval_label === "twice_a_week") {
    for (let i = 0; i < f.calendarDays; i++) {
      const d = addDays(today, i);
      if ((f.twiceAWeekDays as readonly number[]).includes(weekday(d))) dates.push(d);
    }
    return dates;
  }
  // grid anchored on the last real collection: last + k * interval
  let d = addDays(lastCollection, interval.interval_days);
  while (d < today) d = addDays(d, interval.interval_days);
  for (; d <= addDays(today, f.calendarDays - 1); d = addDays(d, interval.interval_days)) dates.push(d);
  return dates;
}

export function scheduleFor(ratePctPerDay: number, lastCollection: string, today: string): ZoneSchedule {
  const interval = intervalFor(ratePctPerDay);
  const calendar = buildCalendar(interval, lastCollection, today);
  return {
    ...interval,
    last_collection_date: lastCollection,
    next_collection_date: calendar[0] ?? addDays(today, Math.ceil(interval.interval_days)),
    calendar,
  };
}

/**
 * First-boot zones. Open item F: staggered so not every zone is due on day 1.
 * Zone i has its next collection i % interval days from today.
 */
export function initialZones(zoneBases: ZoneBase[], today: string): Zone[] {
  return zoneBases.map((z, i) => {
    const interval = intervalFor(z.fill_rate_pct_per_day);
    const days = Math.max(1, Math.ceil(interval.interval_days));
    const last = addDays(today, (i % days) - days);
    return { ...z, ...scheduleFor(z.fill_rate_pct_per_day, last, today) };
  });
}

/** Least-squares slope of fill vs time, in % per hour. Null when history is too thin or not rising. */
export function fillSlopePerHour(points: { t: number; fill: number }[]): number | null {
  if (points.length < 2) return null;
  const hours = points.map((p) => p.t / 3_600_000);
  const spanH = Math.max(...hours) - Math.min(...hours);
  if (spanH < f.minHistoryHours) return null;
  const n = points.length;
  const mx = hours.reduce((a, b) => a + b, 0) / n;
  const my = points.reduce((a, p) => a + p.fill, 0) / n;
  let num = 0;
  let den = 0;
  points.forEach((p, i) => {
    num += (hours[i]! - mx) * (p.fill - my);
    den += (hours[i]! - mx) ** 2;
  });
  const slope = num / den;
  return slope > 0 ? slope : null;
}

/** Bin slope since its last emptying. */
export function binRatePerHour(bin: BinBase, history: HistoryStore): number | null {
  const emptied = [bin.last_emptied, ...history.emptyings(bin.bin_id).map((e) => e.at)].sort().pop()!;
  const pts = history
    .readings(bin.bin_id, emptied)
    .map((r) => ({ t: new Date(r.timestamp).getTime(), fill: r.fill_pct }));
  return fillSlopePerHour(pts);
}

/**
 * Recomputes each zone's rate from history (mean bin slope since last emptying, per day)
 * and rebuilds its interval and calendar. With too little history the zone keeps its current rate.
 */
export function planFrequency(zones: Zone[], bins: BinBase[], history: HistoryStore, today: string): Zone[] {
  return zones.map((z) => {
    const slopes = bins
      .filter((b) => b.zone_id === z.zone_id)
      .map((b) => binRatePerHour(b, history))
      .filter((s): s is number => s !== null);
    const rate = slopes.length >= f.minBinsForRate
      ? round1((slopes.reduce((a, b) => a + b, 0) / slopes.length) * 24)
      : z.fill_rate_pct_per_day;
    return { ...z, fill_rate_pct_per_day: rate, ...scheduleFor(rate, z.last_collection_date, today) };
  });
}
