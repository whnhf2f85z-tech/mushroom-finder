import type { ScoringConfig } from './config.js';
import type { Species } from './schemas.js';
import type { DailyWeather } from './types.js';

export interface FrostResult {
  F: number;
  frostNights: number;
  hardFrostNights: number;
}

/** F: 0–1 multiplier; each frost night in the last 7 days reduces it, hard frosts much more. */
export function frostFactor(
  weather: DailyWeather[],
  species: Species,
  cfg: ScoringConfig,
): FrostResult {
  const f = cfg.frost;
  const p = f.penalties[species.frostTolerance];
  let F = 1;
  let frostNights = 0;
  let hardFrostNights = 0;
  for (const day of weather.slice(-f.lookbackDays)) {
    if (day.tmin < f.hardFrostC) {
      hardFrostNights++;
      F *= 1 - p.hard;
    } else if (day.tmin < f.frostC) {
      frostNights++;
      F *= 1 - p.frost;
    }
  }
  return { F, frostNights, hardFrostNights };
}
