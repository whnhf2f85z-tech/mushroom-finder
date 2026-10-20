/**
 * Part B: recompute the seasons 2021–2026 (1 June – 15 November) for the 14 spots and a fixed sample of 30 forest
 * squares (15 ZH, 15 SZ), with the app's engine and current parameters.
 *   npx tsx validation/past-seasons.ts   → validation/results/past-seasons.json
 * ~4,600 weighted Open-Meteo calls; run it where the daily quota allows (manual GitHub workflow "Validation").
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DEFAULT_FAVOURITES,
  GridFileSchema,
  HISTORICAL_FORECAST_URL,
  HabitatFileSchema,
  RateLimiter,
  SpeciesFileSchema,
  SpotsFileSchema,
  adjustForElevation,
  cellHabitat,
  defaultDeps,
  elevationAboveWeatherPoint,
  fetchWeather,
  scoreSpecies,
  weatherDistanceKm,
  type DailyWeather,
  type Habitat,
  type WeatherLocation,
} from '@mf/scoring';

const DIR = import.meta.dirname;
const ROOT = join(DIR, '..');
const CACHE = join(DIR, 'cache', 'seasons');
mkdirSync(CACHE, { recursive: true });
mkdirSync(join(DIR, 'results'), { recursive: true });

const YEARS = [2021, 2022, 2023, 2024, 2025, 2026];
const FIRST = '06-01';
const LAST = '11-15';
const LOOKBACK = 61;
/** Historical-forecast data is complete until ~2 days ago. */
const LAST_AVAILABLE =
  process.env.LAST_AVAILABLE ?? new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10);
const N_SQUARES = 30;

const readJson = (p: string) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'));
const species = SpeciesFileSchema.parse(readJson('data/species.json')).species;
const spots = SpotsFileSchema.parse(readJson('data/spots.json')).spots;
const habitat = HabitatFileSchema.parse(readJson('web/public/data/static/habitat.json')).spots;
const grid = GridFileSchema.parse(readJson('web/public/data/static/grid.json'));

const addDays = (d: string, n: number) => {
  const t = new Date(`${d}T12:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
};

// Fixed sample of squares: 15 per canton, deterministic shuffle.
let seed = 2021;
const rnd = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
const pick = (canton: 'ZH' | 'SZ') => {
  const idx = grid.cells.canton.map((c, i) => (c === canton ? i : -1)).filter((i) => i >= 0);
  for (let i = idx.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [idx[i], idx[j]] = [idx[j]!, idx[i]!];
  }
  return idx.slice(0, N_SQUARES / 2);
};
const squares = [...pick('ZH'), ...pick('SZ')];

interface Place {
  id: string;
  kind: 'spot' | 'square';
  canton: string;
  weather: WeatherLocation;
  habitat: Habitat;
  dz: number;
  distanceKm: number;
}
const places: Place[] = [
  ...spots.map((s) => {
    const h = habitat[s.id]!;
    return {
      id: s.id,
      kind: 'spot' as const,
      canton: s.canton,
      weather: { id: s.id, lat: s.lat, lon: s.lon, elevation: h.elevation },
      habitat: {
        elevation: h.elevation,
        forest_pct: h.forest_pct,
        ph_class: h.ph_class,
        ...(h.conifer_pct !== null ? { conifer_pct: h.conifer_pct } : {}),
        ...(h.aspect !== null ? { aspect: h.aspect } : {}),
        ...(h.slope !== null ? { slope: h.slope } : {}),
      },
      dz: 0,
      distanceKm: 0,
    };
  }),
  ...squares.map((i) => {
    const k = grid.cells.weather[i]!;
    return {
      id: `sq-${grid.cells.e[i]}-${grid.cells.n[i]}`,
      kind: 'square' as const,
      canton: grid.cells.canton[i]!,
      weather: {
        id: `wp${k}`,
        lat: grid.weatherPoints.lat[k]!,
        lon: grid.weatherPoints.lon[k]!,
        elevation: grid.weatherPoints.elevation[k]!,
      },
      habitat: cellHabitat(grid, i),
      dz: elevationAboveWeatherPoint(grid, i),
      distanceKm: weatherDistanceKm(grid, i),
    };
  }),
];
const locations = [...new Map(places.map((p) => [p.weather.id, p.weather])).values()];

const limiter = new RateLimiter(450, defaultDeps.sleep);
const deps = { ...defaultDeps, limiter };
let calls = 0;
const weather = new Map<string, DailyWeather[]>();
for (const y of YEARS) {
  const end = `${y}-${LAST}` > LAST_AVAILABLE ? LAST_AVAILABLE : `${y}-${LAST}`;
  const start = addDays(`${y}-${FIRST}`, -LOOKBACK);
  const path = join(CACHE, `${y}_${start}_${end}_${locations.length}.json`);
  let byId: Record<string, DailyWeather[]>;
  if (existsSync(path)) byId = JSON.parse(readFileSync(path, 'utf8'));
  else {
    // Groups of 20: one request for all 44 places over 8 months would weigh ~765 calls, above the 600/min limit.
    byId = {};
    for (let i = 0; i < locations.length; i += 20) {
      const r = await fetchWeather(
        HISTORICAL_FORECAST_URL,
        locations.slice(i, i + 20),
        { start_date: start, end_date: end },
        deps,
      );
      calls += r.calls;
      if (r.failed.length)
        throw new Error(`Weather failed for ${r.failed.length} locations in ${y} (daily limit?)`);
      Object.assign(byId, Object.fromEntries(r.weather));
    }
    writeFileSync(path, JSON.stringify(byId));
  }
  for (const [id, w] of Object.entries(byId)) weather.set(`${y}|${id}`, w);
  console.log(
    `${y}: weather ${start} → ${end} for ${locations.length} locations (${calls.toFixed(0)} calls so far)`,
  );
}

/** Week starting Monday (ISO-ish) label, e.g. "2022-09-05". */
const weekOf = (d: string) => {
  const t = new Date(`${d}T12:00:00Z`);
  t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7));
  return t.toISOString().slice(0, 10);
};

// Daily scores → weekly means per year: best of the default favourites, and per species; spots and squares apart.
type Weekly = Record<string, { favourites: number; good: number; species: Record<string, number> }>;
const out: Record<string, { spots: Weekly; squares: Weekly }> = {};
for (const y of YEARS) {
  const sums: Record<
    'spot' | 'square',
    Record<string, { n: number; fav: number; good: number; sp: Record<string, number> }>
  > = { spot: {}, square: {} };
  for (const p of places) {
    const w0 = weather.get(`${y}|${p.weather.id}`);
    if (!w0) continue;
    const w = adjustForElevation(w0, p.dz);
    for (let d = `${y}-${FIRST}`; d <= `${y}-${LAST}` && d <= LAST_AVAILABLE; d = addDays(d, 1)) {
      const upTo = w.filter((x) => x.date <= d);
      if (upTo.at(-1)?.date !== d) continue;
      const scores = Object.fromEntries(
        species.map((s) => [
          s.id,
          scoreSpecies(s, upTo, p.habitat, { weatherDistanceKm: p.distanceKm }).score,
        ]),
      );
      const fav = Math.max(...DEFAULT_FAVOURITES.map((id) => scores[id] ?? 0));
      const wk = weekOf(d);
      const a = (sums[p.kind][wk] ??= { n: 0, fav: 0, good: 0, sp: {} });
      a.n++;
      a.fav += fav;
      a.good += fav >= 60 ? 1 : 0;
      for (const [id, v] of Object.entries(scores)) a.sp[id] = (a.sp[id] ?? 0) + v;
    }
  }
  const finish = (s: (typeof sums)['spot']): Weekly =>
    Object.fromEntries(
      Object.entries(s)
        .sort()
        .map(([wk, a]) => [
          wk,
          {
            favourites: Math.round((a.fav / a.n) * 10) / 10,
            good: Math.round((a.good / a.n) * 1000) / 1000,
            species: Object.fromEntries(
              Object.entries(a.sp).map(([id, v]) => [id, Math.round((v / a.n) * 10) / 10]),
            ),
          },
        ]),
    );
  out[y] = { spots: finish(sums.spot), squares: finish(sums.square) };
}

writeFileSync(
  join(DIR, 'results', 'past-seasons.json'),
  JSON.stringify({
    generated: new Date().toISOString(),
    lastAvailable: LAST_AVAILABLE,
    period: [FIRST, LAST],
    squares: places.filter((p) => p.kind === 'square').map((p) => p.id),
    calls: Math.round(calls),
    years: out,
  }),
);
console.log(`Wrote validation/results/past-seasons.json (${calls.toFixed(0)} weighted calls)`);
