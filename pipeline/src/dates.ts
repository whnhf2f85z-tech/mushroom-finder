/** Today's date (YYYY-MM-DD) in Europe/Zurich. */
export const zurichToday = (now = new Date()): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Zurich' }).format(now);

export const addDays = (date: string, n: number): string => {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** Inclusive list of dates from start to end. */
export const dateRange = (start: string, end: string): string[] => {
  const out: string[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) out.push(d);
  return out;
};
