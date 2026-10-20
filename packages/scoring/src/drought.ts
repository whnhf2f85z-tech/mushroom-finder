import type { ScoringConfig } from './config.js';
import type { DailyWeather } from './types.js';
import { clamp } from './util.js';

export interface DroughtResult {
  D: number;
  precip60dMm: number;
  precip60dNormalMm: number;
  /** Days of weather actually used (fewer than 60 lowers confidence). */
  days: number;
}

/** D: 0.6–1 multiplier; lower when the last 60 days were much drier than the regional normal. */
export function droughtFactor(
  weather: DailyWeather[],
  elevation: number,
  cfg: ScoringConfig,
): DroughtResult {
  const c = cfg.drought;
  const recent = weather.slice(-c.days);
  const precip60dMm = recent.reduce((s, d) => s + d.precip, 0);
  const annual = c.annualNormalBaseMm + c.annualNormalPerMetreMm * elevation;
  const precip60dNormalMm = (annual * recent.length) / 365;
  if (recent.length === 0) return { D: 1, precip60dMm, precip60dNormalMm, days: 0 };
  const ratio = precip60dMm / precip60dNormalMm;
  const t = clamp((ratio - c.floorRatio) / (c.fullRatio - c.floorRatio));
  return { D: c.min + (1 - c.min) * t, precip60dMm, precip60dNormalMm, days: recent.length };
}
