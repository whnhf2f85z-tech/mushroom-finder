import type { ScoringConfig } from './config.js';
import type { Species } from './schemas.js';
import type { DailyWeather } from './types.js';
import { mean, plateau } from './util.js';

/** True if the last 3 days are clearly cooler than a warm 3-day period 5–10 days ago. */
export function coolingTrigger(weather: DailyWeather[], cfg: ScoringConfig): boolean {
  const t = cfg.temperature;
  const n = weather.length;
  const avg3 = (endLag: number): number | null => {
    if (n - endLag - 3 < 0) return null;
    return mean(weather.slice(n - endLag - 3, n - endLag).map((d) => d.tmean));
  };
  const recent = avg3(0);
  if (recent === null) return false;
  for (let lag = 5; lag <= 10; lag++) {
    const earlier = avg3(lag);
    if (earlier !== null && earlier >= t.coolingWarmC && earlier - recent >= t.coolingDropC)
      return true;
  }
  return false;
}

export interface TemperatureResult {
  T: number;
  meanTemp7d: number | null;
  tempSource: 'air' | 'soil';
  coolingTrigger: boolean;
  /** True when the species wanted soil temperature but it was missing. */
  soilFallback: boolean;
}

/** T: 0–1 temperature score from the 7-day mean against the species band, plus the cooling bonus. */
export function temperatureScore(
  weather: DailyWeather[],
  species: Species,
  cfg: ScoringConfig,
): TemperatureResult {
  const last = weather.slice(-cfg.temperature.meanDays);
  const soil = last.map((d) => d.soilTemp0_7).filter((v): v is number => v !== undefined);
  const useSoil =
    species.temperature.source === 'soil' && soil.length === last.length && soil.length > 0;
  const meanTemp7d = useSoil ? mean(soil) : mean(last.map((d) => d.tmean));
  const cooling = coolingTrigger(weather, cfg);
  const band =
    meanTemp7d === null
      ? 0
      : plateau(
          meanTemp7d,
          species.temperature.min,
          species.temperature.max,
          species.temperature.tail,
        );
  return {
    T: Math.min(1, band + (cooling ? species.coolingBonus : 0)),
    meanTemp7d,
    tempSource: useSoil ? 'soil' : 'air',
    coolingTrigger: cooling,
    soilFallback: species.temperature.source === 'soil' && !useSoil,
  };
}
