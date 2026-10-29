/**
 * Calendar-date helpers. Dates are ISO strings (YYYY-MM-DD) and all arithmetic
 * is done in UTC on whole days, so a time zone can never shift a deadline.
 */

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isISODate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const m = ISO.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

function toUTC(iso: string): number {
  const m = ISO.exec(iso);
  if (!m) throw new Error(`Invalid ISO date: ${iso}`);
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

export function addDays(iso: string, days: number): string {
  const dt = new Date(toUTC(iso) + days * 86_400_000);
  return dt.toISOString().slice(0, 10);
}

/** Whole days from b to a (a - b). Positive when a is later than b. */
export function diffDays(a: string, b: string): number {
  return Math.round((toUTC(a) - toUTC(b)) / 86_400_000);
}
