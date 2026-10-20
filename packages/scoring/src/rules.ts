import type { CantonT, RulesFile } from './schemas.js';

/** True if picking is not allowed in this canton on this date (YYYY-MM-DD), e.g. ZH on the 1st–10th. */
export function isClosedDay(rules: RulesFile, canton: CantonT, date: string): boolean {
  const day = Number(date.slice(8, 10));
  return rules.cantons[canton]?.closedDaysOfMonth.includes(day) ?? false;
}
