import type { ScoringConfig } from './config.js';
import type { Species } from './schemas.js';
import type { DailyWeather } from './types.js';
import { clamp, smoothstep } from './util.js';

/** Weight of rain that fell `lag` days before the target day (0 = target day). */
export function lagWeight(lag: number, window: { min: number; max: number }, ramp: number): number {
  if (lag >= window.min && lag <= window.max) return 1;
  const d = lag < window.min ? window.min - lag : lag - window.max;
  return Math.max(0, 1 - d / ramp);
}

/** Rain in the species' lag window, capped per day, minus a share of ET0. mm, ≥ 0. */
export function effectiveRain(
  weather: DailyWeather[],
  species: Species,
  cfg: ScoringConfig,
): number {
  const m = cfg.moisture;
  let rain = 0;
  let et = 0;
  for (let lag = 0; lag < weather.length; lag++) {
    const day = weather[weather.length - 1 - lag]!;
    const w = lagWeight(lag, species.rainLag, m.kernelRampDays);
    if (w === 0 && lag > species.rainLag.max) break;
    rain += w * Math.min(day.precip, m.maxDailyRainMm);
    et += w * (day.et0 ?? 0);
  }
  return Math.max(0, rain - m.et0Factor * et);
}

/**
 * Soil moisture 7–28 cm, normalised to the location's recent range and averaged with the same lag kernel
 * as rain, so wet soil counts with the same delay before fruiting. null if missing.
 */
export function soilMoistureScore(
  weather: DailyWeather[],
  species: Species,
  cfg: ScoringConfig,
): number | null {
  const m = cfg.moisture;
  if (weather[weather.length - 1]?.soilMoisture7_28 === undefined) return null;
  const values = weather
    .slice(-m.soilRangeDays)
    .map((d) => d.soilMoisture7_28)
    .filter((v): v is number => v !== undefined);
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const norm = (v: number): number =>
    hi - lo < m.soilMinRange
      ? clamp((v - m.soilAbsDry) / (m.soilAbsWet - m.soilAbsDry))
      : clamp((v - lo) / (hi - lo));
  let sum = 0;
  let wSum = 0;
  for (let lag = 0; lag < weather.length; lag++) {
    const w = lagWeight(lag, species.rainLag, m.kernelRampDays);
    if (w === 0 && lag > species.rainLag.max) break;
    const v = weather[weather.length - 1 - lag]!.soilMoisture7_28;
    if (w === 0 || v === undefined) continue;
    sum += w * norm(v);
    wSum += w;
  }
  return wSum === 0 ? null : sum / wSum;
}

export interface MoistureResult {
  M: number;
  effectiveRainMm: number;
  rainScore: number;
  soilScore: number | null;
}

/** M: 0–1 moisture score. */
export function moistureScore(
  weather: DailyWeather[],
  species: Species,
  cfg: ScoringConfig,
): MoistureResult {
  const effectiveRainMm = effectiveRain(weather, species, cfg);
  const rainScore = smoothstep(effectiveRainMm / species.fullRainMm);
  const soilScore = soilMoistureScore(weather, species, cfg);
  const share = cfg.moisture.rainShare;
  const M = soilScore === null ? rainScore : share * rainScore + (1 - share) * soilScore;
  return { M, effectiveRainMm, rainScore, soilScore };
}
