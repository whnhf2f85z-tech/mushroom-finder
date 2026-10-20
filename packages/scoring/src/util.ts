export const clamp = (x: number, lo = 0, hi = 1): number => Math.min(hi, Math.max(lo, x));

export const mean = (xs: number[]): number | null =>
  xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;

/** Smooth 0→1 ease for x in [0, 1]. */
export const smoothstep = (x: number): number => {
  const t = clamp(x);
  return t * t * (3 - 2 * t);
};

/** 1 inside [min, max], cosine tail to 0 at `tail` beyond either edge. */
export const plateau = (x: number, min: number, max: number, tail: number): number => {
  const d = x < min ? min - x : x > max ? x - max : 0;
  if (d === 0) return 1;
  if (d >= tail) return 0;
  return 0.5 * (1 + Math.cos((Math.PI * d) / tail));
};

/** 1 inside [min, max], linear down to `floor` at `tail` beyond either edge. */
export const linearRange = (
  x: number,
  r: { min: number; max: number },
  tail: number,
  floor: number,
): number => {
  const d = x < r.min ? r.min - x : x > r.max ? x - r.max : 0;
  return Math.max(floor, 1 - (d / tail) * (1 - floor));
};

const CUM_DAYS = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];

/** Day of year 1–365 from month and day, ignoring leap years (29 Feb counts as 28 Feb). */
export const doyFromMonthDay = (month: number, day: number): number =>
  (CUM_DAYS[month - 1] ?? 0) + Math.min(day, month === 2 ? 28 : 31);

/** Day of year from "MM-DD" or "YYYY-MM-DD". */
export const dayOfYear = (s: string): number => {
  const parts = s.split('-').map(Number);
  const [m, d] = parts.length === 3 ? [parts[1]!, parts[2]!] : [parts[0]!, parts[1]!];
  return doyFromMonthDay(m, d);
};
