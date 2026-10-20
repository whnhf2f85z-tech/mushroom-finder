import type { DailyWeather } from '@mf/scoring';

/** Verified endpoints and variables: see docs/DATA_SOURCES.md. */
export const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
export const HISTORICAL_FORECAST_URL = 'https://historical-forecast-api.open-meteo.com/v1/forecast';
/** best_match: the MeteoSwiss ICON-CH models have no soil moisture/temperature on Open-Meteo. */
export const MODEL = 'best_match';
export const TIMEZONE = 'Europe/Zurich';

export const DAILY_VARS = [
  'precipitation_sum',
  'temperature_2m_min',
  'temperature_2m_max',
  'temperature_2m_mean',
  'relative_humidity_2m_mean',
  'et0_fao_evapotranspiration',
] as const;
export const HOURLY_VARS = [
  'soil_moisture_0_to_7cm',
  'soil_moisture_7_to_28cm',
  'soil_temperature_0_to_7cm',
] as const;

/** Locations per request. 100 works; ~1,000 hits the per-minute limit. */
export const BATCH_SIZE = 50;

export interface WeatherLocation {
  id: string;
  lat: number;
  lon: number;
  /** Elevation used by Open-Meteo for temperature downscaling (m). */
  elevation: number;
}

type Series = Record<string, (number | null)[] | string[]>;
interface RawLocation {
  daily?: Series & { time: string[] };
  hourly?: Series & { time: string[] };
}

export interface FetchDeps {
  fetch: typeof fetch;
  sleep: (ms: number) => Promise<void>;
  log: (msg: string) => void;
  /** Optional shared budget of weighted calls per minute (Open-Meteo allows 600/min). */
  limiter?: RateLimiter;
}

/**
 * Keeps the weighted Open-Meteo calls in any 60 s window under `perMinute`. Requests heavier than the budget are
 * sent alone in an otherwise empty window.
 */
export class RateLimiter {
  private sent: { at: number; weight: number }[] = [];
  constructor(
    private readonly perMinute: number,
    private readonly sleep: (ms: number) => Promise<void>,
    private readonly now: () => number = Date.now,
  ) {}

  async take(weight: number): Promise<void> {
    for (;;) {
      const t = this.now();
      this.sent = this.sent.filter((s) => t - s.at < 60_000);
      const used = this.sent.reduce((a, s) => a + s.weight, 0);
      if (used === 0 || used + weight <= this.perMinute) {
        this.sent.push({ at: t, weight });
        return;
      }
      await this.sleep(60_000 - (t - this.sent[0]!.at) + 50);
    }
  }
}

export const defaultDeps: FetchDeps = {
  fetch: globalThis.fetch.bind(globalThis),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  log: (msg) => console.log(msg),
};

/** Open-Meteo's fractional call weight: per location, ×(variables / 10) and ×(days / 14), each at least 1. */
export function estimateCalls(locations: number, variables: number, days: number): number {
  return locations * Math.max(1, variables / 10) * Math.max(1, days / 14);
}

export class FetchError extends Error {}

/** POST with retries and exponential backoff. 429 (rate limit) waits a full minute. */
export async function postWithRetry(
  url: string,
  body: URLSearchParams,
  deps: FetchDeps,
  attempts = 4,
): Promise<unknown> {
  let lastError = '';
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await deps.fetch(url, {
        method: 'POST',
        body,
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
      });
      if (res.ok) return await res.json();
      const text = await res.text();
      lastError = `HTTP ${res.status}: ${text.slice(0, 200)}`;
      // Client errors other than rate limits won't get better with retries.
      if (res.status >= 400 && res.status < 500 && res.status !== 429) break;
      if (i < attempts - 1) await deps.sleep(res.status === 429 ? 61_000 : 2_000 * 2 ** i);
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
      if (i < attempts - 1) await deps.sleep(2_000 * 2 ** i);
    }
    deps.log(`  retry ${i + 1}/${attempts - 1} for ${url}: ${lastError}`);
  }
  throw new FetchError(`${url} failed: ${lastError}`);
}

const num = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? v : undefined;

/** Daily mean of hourly values per local date; needs at least 20 of 24 hours. */
export function hourlyToDaily(time: string[], values: (number | null)[]): Map<string, number> {
  const groups = new Map<string, number[]>();
  time.forEach((t, i) => {
    const v = num(values[i]);
    if (v === undefined) return;
    const day = t.slice(0, 10);
    const g = groups.get(day) ?? [];
    g.push(v);
    groups.set(day, g);
  });
  const out = new Map<string, number>();
  for (const [day, g] of groups)
    if (g.length >= 20) out.set(day, g.reduce((a, b) => a + b, 0) / g.length);
  return out;
}

/** Convert one location of an Open-Meteo response into days. Days without precipitation or temperature are dropped. */
export function parseLocation(raw: RawLocation): DailyWeather[] {
  const d = raw.daily;
  if (!d?.time) return [];
  const col = (k: string) => (d[k] ?? []) as (number | null)[];
  const h = raw.hourly;
  const hourly = (k: string) =>
    h?.time ? hourlyToDaily(h.time, (h[k] ?? []) as (number | null)[]) : new Map<string, number>();
  const sm0 = hourly('soil_moisture_0_to_7cm');
  const sm7 = hourly('soil_moisture_7_to_28cm');
  const st0 = hourly('soil_temperature_0_to_7cm');

  const out: DailyWeather[] = [];
  d.time.forEach((date, i) => {
    const precip = num(col('precipitation_sum')[i]);
    const tmin = num(col('temperature_2m_min')[i]);
    const tmax = num(col('temperature_2m_max')[i]);
    const tmean =
      num(col('temperature_2m_mean')[i]) ??
      (tmin !== undefined && tmax !== undefined ? (tmin + tmax) / 2 : undefined);
    if (precip === undefined || tmin === undefined || tmax === undefined || tmean === undefined)
      return;
    const day: DailyWeather = { date, precip, tmin, tmax, tmean };
    const rh = num(col('relative_humidity_2m_mean')[i]);
    const et0 = num(col('et0_fao_evapotranspiration')[i]);
    if (rh !== undefined) day.rh = rh;
    if (et0 !== undefined) day.et0 = et0;
    if (sm0.has(date)) day.soilMoisture0_7 = sm0.get(date)!;
    if (sm7.has(date)) day.soilMoisture7_28 = sm7.get(date)!;
    if (st0.has(date)) day.soilTemp0_7 = st0.get(date)!;
    out.push(day);
  });
  return out;
}

export type DateRange =
  { start_date: string; end_date: string } | { past_days: number; forecast_days: number };

export interface FetchResult {
  weather: Map<string, DailyWeather[]>;
  failed: string[];
  calls: number;
}

function body(locations: WeatherLocation[], range: DateRange): URLSearchParams {
  const p = new URLSearchParams({
    latitude: locations.map((l) => l.lat).join(','),
    longitude: locations.map((l) => l.lon).join(','),
    elevation: locations.map((l) => Math.round(l.elevation)).join(','),
    timezone: TIMEZONE,
    models: MODEL,
    daily: DAILY_VARS.join(','),
    hourly: HOURLY_VARS.join(','),
  });
  for (const [k, v] of Object.entries(range)) p.set(k, String(v));
  return p;
}

const rangeDays = (r: DateRange): number =>
  'past_days' in r
    ? r.past_days + r.forecast_days
    : Math.round((Date.parse(r.end_date) - Date.parse(r.start_date)) / 86_400_000) + 1;

/**
 * Fetch weather for many locations in batches. If a batch fails after retries, its locations are retried one by one,
 * so a single bad location doesn't fail the rest. Locations that still fail are listed in `failed`.
 */
export async function fetchWeather(
  url: string,
  locations: WeatherLocation[],
  range: DateRange,
  deps: FetchDeps = defaultDeps,
): Promise<FetchResult> {
  const weather = new Map<string, DailyWeather[]>();
  const failed: string[] = [];
  let calls = 0;
  const vars = DAILY_VARS.length + HOURLY_VARS.length;

  const run = async (batch: WeatherLocation[]): Promise<void> => {
    const weight = estimateCalls(batch.length, vars, rangeDays(range));
    await deps.limiter?.take(weight);
    calls += weight;
    const json = await postWithRetry(url, body(batch, range), deps);
    const list = (Array.isArray(json) ? json : [json]) as RawLocation[];
    if (list.length !== batch.length)
      throw new FetchError(`expected ${batch.length} locations, got ${list.length}`);
    batch.forEach((loc, i) => weather.set(loc.id, parseLocation(list[i]!)));
  };

  for (let i = 0; i < locations.length; i += BATCH_SIZE) {
    const batch = locations.slice(i, i + BATCH_SIZE);
    try {
      await run(batch);
    } catch (e) {
      deps.log(`  batch of ${batch.length} failed (${(e as Error).message}); retrying one by one`);
      for (const loc of batch) {
        try {
          await run([loc]);
        } catch {
          failed.push(loc.id);
        }
      }
    }
  }
  return { weather, failed, calls };
}

/** Merge day lists by date; later lists win on overlap. Result is sorted oldest first. */
export function mergeDays(...lists: DailyWeather[][]): DailyWeather[] {
  const byDate = new Map<string, DailyWeather>();
  for (const list of lists) for (const d of list) byDate.set(d.date, d);
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}
