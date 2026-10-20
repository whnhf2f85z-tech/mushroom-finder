import {
  FORECAST_URL,
  HISTORICAL_FORECAST_URL,
  adjustForElevation,
  fetchWeather,
  mergeDays,
  scoreLocation,
  type DailyWeather,
  type FetchDeps,
  type Habitat,
  type LocationResult,
  type ScoreContext,
  type Species,
} from '@mf/scoring';

/** Days of weather needed before the first scored day (same as the daily job). */
const LOOKBACK = 61;

const addDays = (date: string, n: number): string => {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** Browser fetch with short waits: never keep the viewer waiting a minute on a rate limit. */
const deps: FetchDeps = {
  fetch: (...a) => fetch(...a),
  sleep: (ms) => new Promise((r) => setTimeout(r, Math.min(ms, 3000))),
  log: (m) => console.debug(m),
};

export interface LiveLocation {
  lat: number;
  lon: number;
  elevation: number;
}

const memory = new Map<string, Promise<DailyWeather[]>>();

/**
 * Weather for one place from `firstDay − 61 days` to 3 days after `today`, like the daily job: historical-forecast
 * API for the past, forecast API for the last 2 days and the forecast. Cached in memory and for the browser session.
 */
export function liveWeather(
  loc: LiveLocation,
  today: string,
  firstDay: string,
): Promise<DailyWeather[]> {
  const key = `mf.weather.v1|${loc.lat.toFixed(4)},${loc.lon.toFixed(4)},${Math.round(loc.elevation)}|${today}|${firstDay}`;
  let p = memory.get(key);
  if (!p) {
    p = (async () => {
      try {
        const cached = sessionStorage.getItem(key);
        if (cached) return JSON.parse(cached) as DailyWeather[];
      } catch {
        // No session storage: fetch again.
      }
      // Offline: fail at once instead of retrying for half a minute.
      if (!navigator.onLine) throw new Error('offline');
      const one = [{ id: 'x', ...loc }];
      const hist = await fetchWeather(
        HISTORICAL_FORECAST_URL,
        one,
        { start_date: addDays(firstDay, -LOOKBACK), end_date: addDays(today, -2) },
        deps,
      );
      const fc = await fetchWeather(FORECAST_URL, one, { past_days: 2, forecast_days: 4 }, deps);
      if (hist.failed.length || fc.failed.length)
        throw new Error('Weather could not be loaded (Open-Meteo).');
      const w = mergeDays(hist.weather.get('x') ?? [], fc.weather.get('x') ?? []);
      try {
        sessionStorage.setItem(key, JSON.stringify(w));
      } catch {
        // Storage full or blocked: fine, it's only a cache.
      }
      return w;
    })();
    p.catch(() => memory.delete(key));
    memory.set(key, p);
  }
  return p;
}

/**
 * Score a place for every date in `dates` with the shared engine. `dz` shifts the temperatures for a place that is
 * `dz` metres above its weather location (grid squares).
 */
export async function scorePlaceLive(
  species: Species[],
  loc: LiveLocation,
  habitat: Habitat,
  dates: string[],
  today: string,
  opts: { dz?: number; ctx?: ScoreContext } = {},
): Promise<{ results: Map<string, LocationResult>; weather: DailyWeather[] }> {
  const raw = await liveWeather(loc, today, dates[0]!);
  const weather = adjustForElevation(raw, opts.dz ?? 0);
  const results = new Map<string, LocationResult>();
  for (const date of dates) {
    const upTo = weather.filter((d) => d.date <= date);
    if (upTo.at(-1)?.date === date)
      results.set(date, scoreLocation(species, upTo, habitat, opts.ctx ?? {}));
  }
  return { results, weather };
}
