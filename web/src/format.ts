const tz = 'Europe/Zurich';

/** "Mon 20 Oct" for a YYYY-MM-DD date. */
export const shortDate = (date: string): string =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: tz,
  });

/** "20 Oct" for a YYYY-MM-DD date. */
export const dayMonth = (date: string): string =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: tz,
  });

/** "20 Oct, 05:31" in Zurich time for an ISO timestamp. */
export const dateTime = (iso: string): string =>
  new Date(iso).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: tz,
  });

/** Unix seconds at noon UTC, for chart x values. */
export const toUnix = (date: string): number => Date.parse(`${date}T12:00:00Z`) / 1000;

export const esc = (s: string): string =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
