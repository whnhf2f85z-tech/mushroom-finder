import { DEFAULT_CONFIG, type ScoringConfig } from './config.js';
import { droughtFactor } from './drought.js';
import { frostFactor } from './frost.js';
import { habitatScore } from './habitat.js';
import { moistureScore } from './moisture.js';
import type { Species } from './schemas.js';
import { seasonScore } from './season.js';
import { temperatureScore } from './temperature.js';
import type {
  Confidence,
  DailyWeather,
  Habitat,
  LocationResult,
  ScoreContext,
  SpeciesResult,
} from './types.js';
import { clamp, dayOfYear } from './util.js';

/**
 * Score one species at one location.
 * `weather` is sorted oldest → newest and ends on the day being scored; give 60+ days for full confidence.
 */
export function scoreSpecies(
  species: Species,
  weather: DailyWeather[],
  habitat: Habitat,
  ctx: ScoreContext = {},
  cfg: ScoringConfig = DEFAULT_CONFIG,
): SpeciesResult {
  const target = weather[weather.length - 1];
  if (!target) throw new Error('scoreSpecies: weather must contain at least the target day');

  const S = seasonScore(species, target.date, habitat.elevation);
  const moisture = moistureScore(weather, species, cfg);
  const temp = temperatureScore(weather, species, cfg);
  const frost = frostFactor(weather, species, cfg);
  const drought = droughtFactor(weather, habitat.elevation, cfg);
  const hab = habitatScore(habitat, species, drought.D, cfg);

  const dynamic =
    Math.pow(S, cfg.seasonExponent) *
    (cfg.moistureWeight * moisture.M + (1 - cfg.moistureWeight) * temp.T);
  const score = Math.round(100 * clamp(hab.H * dynamic * frost.F * drought.D));

  const issues: string[] = [];
  if (habitat.ph_class === 'unknown') issues.push('ph_unknown');
  if (habitat.conifer_pct === undefined) issues.push('conifer_unknown');
  if (moisture.soilScore === null) issues.push('no_soil_moisture');
  if (temp.soilFallback) issues.push('no_soil_temperature');
  if (drought.days < cfg.drought.days) issues.push('short_weather_history');
  if ((ctx.weatherDistanceKm ?? 0) > cfg.confidence.maxWeatherDistanceKm)
    issues.push('weather_far');
  const confidence: Confidence =
    issues.length === 0 ? 'high' : issues.length <= cfg.confidence.mediumMax ? 'medium' : 'low';

  return {
    speciesId: species.id,
    score,
    components: { S, M: moisture.M, T: temp.T, F: frost.F, D: drought.D, H: hab.H },
    details: {
      dayOfYear: dayOfYear(target.date),
      effectiveRainMm: moisture.effectiveRainMm,
      rainWindow: [species.rainLag.min, species.rainLag.max],
      rainScore: moisture.rainScore,
      soilScore: moisture.soilScore,
      meanTemp7d: temp.meanTemp7d,
      tempSource: temp.tempSource,
      coolingTrigger: temp.coolingTrigger,
      frostNights: frost.frostNights,
      hardFrostNights: frost.hardFrostNights,
      precip60dMm: drought.precip60dMm,
      precip60dNormalMm: drought.precip60dNormalMm,
      hostScore: hab.hostScore,
      phScore: hab.phScore,
      elevationScore: hab.elevationScore,
      forestScore: hab.forestScore,
    },
    outOfSeason: S === 0,
    confidence,
    confidenceIssues: issues,
  };
}

/** Score all (or only the selected) species at a location; the metascore is the best species score. */
export function scoreLocation(
  speciesList: Species[],
  weather: DailyWeather[],
  habitat: Habitat,
  ctx: ScoreContext = {},
  cfg: ScoringConfig = DEFAULT_CONFIG,
  selectedIds?: string[],
): LocationResult {
  const chosen = selectedIds ? speciesList.filter((s) => selectedIds.includes(s.id)) : speciesList;
  const species = chosen.map((s) => scoreSpecies(s, weather, habitat, ctx, cfg));
  const best = species.reduce<SpeciesResult | null>(
    (b, r) => (b === null || r.score > b.score ? r : b),
    null,
  );
  return {
    date: weather[weather.length - 1]!.date,
    metascore: best?.score ?? 0,
    bestSpeciesId: best?.speciesId ?? null,
    species,
    protected: habitat.protected?.is ?? false,
  };
}
