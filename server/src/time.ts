import { config } from "./config.js";

const MS_PER_MIN = 60_000;

/** YYYY-MM-DD in Gwalior local time (fixed UTC+05:30, no DST). */
export function localDate(d: Date): string {
  return new Date(d.getTime() + config.utcOffsetMinutes * MS_PER_MIN).toISOString().slice(0, 10);
}

export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** 0 = Sunday. */
export function weekday(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

/** Instant of `hour:minute` local time on `date`. */
export function localInstant(date: string, hour: number, minute = 0): Date {
  const midnightUtc = new Date(`${date}T00:00:00Z`).getTime();
  return new Date(midnightUtc + (hour * 60 + minute) * MS_PER_MIN - config.utcOffsetMinutes * MS_PER_MIN);
}

/** Instant a zone's collection run starts on `date`. */
export function collectionStart(date: string): Date {
  const midnightUtc = new Date(`${date}T00:00:00Z`).getTime();
  return new Date(midnightUtc + config.collectionStartHour * 3_600_000 - config.utcOffsetMinutes * MS_PER_MIN);
}
