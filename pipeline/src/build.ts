import {
  scoreLocation,
  type DailyWeather,
  type Habitat,
  type HabitatEntry,
  type HistoryFile,
  type LatestFile,
  type LatestSpot,
  type LocationResult,
  type Species,
  type SpotDay,
  type Spot,
} from '@mf/scoring';
import type { WeatherLocation } from './openmeteo.js';

/**
 * Weather point for a spot. With a habitat entry: the (checked) pin at its terrain-model elevation.
 * Without one: the pin at the middle of its elevation band (pins mark areas, not exact spots).
 */
export const spotLocation = (spot: Spot, h?: HabitatEntry): WeatherLocation => ({
  id: spot.id,
  lat: spot.lat,
  lon: spot.lon,
  elevation: h?.elevation ?? (spot.elevation_band.min + spot.elevation_band.max) / 2,
});

/** Habitat from the habitat build; falls back to the band midpoint and the provisional hints from the notes. */
export const spotHabitat = (spot: Spot, e?: HabitatEntry): Habitat => {
  if (e) {
    const h: Habitat = {
      elevation: e.elevation,
      forest_pct: e.forest_pct,
      ph_class: e.ph_class,
      protected: {
        is: e.protected.is,
        noPicking: e.protected.noPicking,
        ...(e.protected.name ? { name: e.protected.name } : {}),
      },
    };
    if (e.conifer_pct !== null) h.conifer_pct = e.conifer_pct;
    if (e.site_type_code !== null) h.site_type_code = e.site_type_code;
    if (e.aspect !== null) h.aspect = e.aspect;
    if (e.slope !== null) h.slope = e.slope;
    return h;
  }
  const h: Habitat = {
    elevation: (spot.elevation_band.min + spot.elevation_band.max) / 2,
    ph_class: spot.habitat_hint?.ph_class ?? 'unknown',
  };
  if (spot.habitat_hint?.conifer_pct !== undefined) h.conifer_pct = spot.habitat_hint.conifer_pct;
  return h;
};

const r3 = (x: number): number => Math.round(x * 1000) / 1000;
const r1 = (x: number): number => Math.round(x * 10) / 10;

export const toSpotDay = (r: LocationResult): SpotDay => ({
  metascore: r.metascore,
  best: r.bestSpeciesId,
  species: Object.fromEntries(
    r.species.map((s) => [
      s.speciesId,
      {
        score: s.score,
        components: {
          S: r3(s.components.S),
          M: r3(s.components.M),
          T: r3(s.components.T),
          F: r3(s.components.F),
          D: r3(s.components.D),
          H: r3(s.components.H),
        },
        outOfSeason: s.outOfSeason,
        confidence: s.confidence,
      },
    ]),
  ),
});

/** Today's scores with the explanation details, for the spot detail panel. */
export const toTodayDetail = (r: LocationResult): LatestSpot['today'] => {
  const base = toSpotDay(r);
  return {
    ...base,
    species: Object.fromEntries(
      r.species.map((s) => [
        s.speciesId,
        {
          ...base.species[s.speciesId]!,
          confidenceIssues: s.confidenceIssues,
          details: Object.fromEntries(
            Object.entries(s.details).map(([k, v]) => [k, typeof v === 'number' ? r3(v) : v]),
          ),
        },
      ]),
    ),
  };
};

/** Score a spot for `date` using only the weather up to that date. null if that day's weather is missing. */
export function scoreSpotOn(
  species: Species[],
  weather: DailyWeather[],
  spot: Spot,
  date: string,
  habitat?: HabitatEntry,
): LocationResult | null {
  const upTo = weather.filter((d) => d.date <= date);
  if (upTo.at(-1)?.date !== date) return null;
  return scoreLocation(species, upTo, spotHabitat(spot, habitat));
}

/** True if the weather has every day from start to end (inclusive) without gaps. */
export function isComplete(weather: DailyWeather[], dates: string[]): boolean {
  const have = new Set(weather.map((d) => d.date));
  return dates.every((d) => have.has(d));
}

/** Re-align an array from old dates to new dates (missing → null). */
export function realign<T>(
  oldDates: string[],
  values: (T | null)[],
  newDates: string[],
): (T | null)[] {
  const byDate = new Map(oldDates.map((d, i) => [d, values[i] ?? null]));
  return newDates.map((d) => byDate.get(d) ?? null);
}

export interface LatestInput {
  generatedAt: string;
  today: string;
  model: string;
  apiCalls: number;
  days: string[];
  forecastDays: string[];
  spots: Spot[];
  speciesIds: string[];
  history: Map<string, HistoryFile>;
  /** Fresh results for today, by spot id (missing = failed). */
  todayResults: Map<string, LocationResult>;
  /** Forecast results by date, then spot id. */
  forecast: Map<string, Map<string, LocationResult>>;
  weather: Map<string, DailyWeather[]>;
  previous: LatestFile | null;
}

export function buildLatest(input: LatestInput): LatestFile {
  const allDates = [...input.days, ...input.forecastDays];
  const spots: Record<string, LatestSpot> = {};
  for (const spot of input.spots) {
    const fresh = input.todayResults.get(spot.id);
    const prev = input.previous?.spots[spot.id];
    if (!fresh && !prev) continue;

    const pastScore = (date: string, f: (d: SpotDay) => number | undefined): number | null => {
      const day = input.history.get(date)?.spots[spot.id];
      return day ? (f(day) ?? null) : null;
    };
    const forecastScore = (date: string, f: (d: SpotDay) => number | undefined): number | null => {
      const r = fresh ? input.forecast.get(date)?.get(spot.id) : undefined;
      return r ? (f(toSpotDay(r)) ?? null) : null;
    };
    const seriesOf = (f: (d: SpotDay) => number | undefined) => [
      ...input.days.map((d) => pastScore(d, f)),
      ...input.forecastDays.map((d) => forecastScore(d, f)),
    ];

    let weather: LatestSpot['weather'];
    const w = fresh ? input.weather.get(spot.id) : undefined;
    if (w) {
      const byDate = new Map(w.map((d) => [d.date, d]));
      weather = {
        precip: allDates.map((d) => (byDate.has(d) ? r1(byDate.get(d)!.precip) : null)),
        tmin: allDates.map((d) => (byDate.has(d) ? r1(byDate.get(d)!.tmin) : null)),
        tmax: allDates.map((d) => (byDate.has(d) ? r1(byDate.get(d)!.tmax) : null)),
      };
    } else {
      const old = [...input.previous!.days, ...input.previous!.forecastDays];
      weather = {
        precip: realign(old, prev!.weather.precip, allDates),
        tmin: realign(old, prev!.weather.tmin, allDates),
        tmax: realign(old, prev!.weather.tmax, allDates),
      };
    }

    spots[spot.id] = {
      stale: !fresh,
      updated: fresh ? input.today : prev!.updated,
      today: fresh ? toTodayDetail(fresh) : prev!.today,
      metaSeries: seriesOf((d) => d.metascore),
      series: Object.fromEntries(
        input.speciesIds.map((id) => [id, seriesOf((d) => d.species[id]?.score)]),
      ),
      weather,
    };
  }
  return {
    schemaVersion: 1,
    generatedAt: input.generatedAt,
    today: input.today,
    model: input.model,
    stale: Object.values(spots).some((s) => s.stale),
    apiCalls: Math.round(input.apiCalls * 10) / 10,
    days: input.days,
    forecastDays: input.forecastDays,
    spots,
  };
}
