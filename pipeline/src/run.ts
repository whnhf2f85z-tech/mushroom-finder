import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import {
  GridDayFileSchema,
  HabitatFileSchema,
  encodeScores,
  decodeScores,
  NO_SCORE,
  HistoryFileSchema,
  LatestFileSchema,
  SpeciesFileSchema,
  SpotsFileSchema,
  type DailyWeather,
  type HabitatEntry,
  type HistoryFile,
  type LocationResult,
} from '@mf/scoring';
import { buildLatest, isComplete, scoreSpotOn, spotLocation, toSpotDay } from './build.js';
import { gridLocations, pointId, scoreGrid } from './grid.js';
import { addDays, dateRange, zurichToday } from './dates.js';
import {
  FORECAST_URL,
  HISTORICAL_FORECAST_URL,
  MODEL,
  defaultDeps,
  fetchWeather,
  mergeDays,
  RateLimiter,
  type FetchDeps,
} from './openmeteo.js';
import {
  historyPath,
  latestPath,
  listHistoryDates,
  gridDayPath,
  listGridDates,
  pruneGrid,
  pruneHistory,
  readGrid,
  readGridDay,
  readHistory,
  readLatest,
  writeJsonValidated,
} from './store.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/** Days shown in the charts, days kept in the repo, days of weather needed before a scored day. */
export const SHOW_DAYS = 14;
export const KEEP_DAYS = 30;
export const WEATHER_LOOKBACK = 61;
export const FORECAST_DAYS = 3;

export interface RunOptions {
  today: string;
  /** Recompute (overwrite) the last N days. Missing days within the last 14 are always filled. */
  backfill: number;
  outDir: string;
  dataDir: string;
  deps?: FetchDeps;
  now?: () => Date;
}

export interface RunSummary {
  today: string;
  written: string[];
  pruned: string[];
  failed: string[];
  apiCalls: number;
  stale: boolean;
}

export async function run(opts: RunOptions): Promise<RunSummary> {
  const deps = opts.deps ?? defaultDeps;
  const log = deps.log;
  const now = opts.now ?? (() => new Date());
  const started = Date.now();
  const { today, outDir } = opts;

  const readJson = async (f: string) => JSON.parse(await readFile(join(opts.dataDir, f), 'utf8'));
  const spots = SpotsFileSchema.parse(await readJson('spots.json')).spots;
  const species = SpeciesFileSchema.parse(await readJson('species.json')).species;
  // Habitat build (npm run terrain). Optional: spots without an entry use their provisional hints.
  let habitat: Record<string, HabitatEntry> = {};
  try {
    habitat = HabitatFileSchema.parse(
      JSON.parse(await readFile(join(outDir, 'static/habitat.json'), 'utf8')),
    ).spots;
  } catch {
    log('No valid static/habitat.json; using the provisional habitat hints');
  }
  // Forest grid (npm run grid). Optional: without it only the spots are scored.
  const grid = await readGrid(outDir);
  if (!grid) log('No valid static/grid.json; scoring spots only');

  // Which past days to score: today, missing days in the chart window, and the forced backfill window.
  const days = dateRange(addDays(today, -(SHOW_DAYS - 1)), today);
  const existing = new Set(await listHistoryDates(outDir));
  const forced = new Set(
    opts.backfill > 0 ? dateRange(addDays(today, -(opts.backfill - 1)), today) : [],
  );
  const toScore = [
    ...new Set([...forced, ...days.filter((d) => !existing.has(d) || d === today)]),
  ].sort();
  const forecastDays = dateRange(addDays(today, 1), addDays(today, FORECAST_DAYS));
  // Grid days: the same rule, judged by the grid files (they can be missing on their own, e.g. a new grid).
  const gridExisting = new Set(await listGridDates(outDir));
  const gridToScore = grid
    ? [...new Set([...forced, ...days.filter((d) => !gridExisting.has(d) || d === today)])].sort()
    : [];

  // Weather: historical forecast API for the past, forecast API for the last 2 days + forecast (it wins on overlap).
  const start = addDays([...toScore, ...gridToScore].sort()[0]!, -WEATHER_LOOKBACK);
  const locations = [
    ...spots.map((s) => spotLocation(s, habitat[s.id])),
    ...(grid ? gridLocations(grid) : []),
  ];
  // Stay under Open-Meteo's 600 weighted calls per minute.
  const fdeps: FetchDeps = deps.limiter
    ? deps
    : { ...deps, limiter: new RateLimiter(500, deps.sleep) };
  log(
    `Run for ${today}: ${spots.length} spots${grid ? ` + ${grid.count} grid cells (${grid.weatherPoints.lat.length} weather points)` : ''}, scoring ${toScore.length} past day(s) + ${forecastDays.length} forecast day(s)`,
  );
  log(`Weather ${start} → ${forecastDays.at(-1)} (${MODEL})`);
  const hist = await fetchWeather(
    HISTORICAL_FORECAST_URL,
    locations,
    { start_date: start, end_date: addDays(today, -2) },
    fdeps,
  );
  const fc = await fetchWeather(
    FORECAST_URL,
    locations,
    { past_days: 2, forecast_days: FORECAST_DAYS + 1 },
    fdeps,
  );
  const apiCalls = hist.calls + fc.calls;

  const weather = new Map<string, DailyWeather[]>();
  const failed: string[] = [];
  const needed = dateRange(start, today);
  for (const spot of spots) {
    const merged = mergeDays(hist.weather.get(spot.id) ?? [], fc.weather.get(spot.id) ?? []);
    if (
      hist.failed.includes(spot.id) ||
      fc.failed.includes(spot.id) ||
      !isComplete(merged, needed)
    ) {
      failed.push(spot.id);
      continue;
    }
    weather.set(spot.id, merged);
  }
  if (weather.size === 0)
    throw new Error('No spot has complete weather; keeping the previous data.');
  const gridWeather = new Map<string, DailyWeather[]>();
  let failedPoints = 0;
  for (const loc of grid ? gridLocations(grid) : []) {
    const merged = mergeDays(hist.weather.get(loc.id) ?? [], fc.weather.get(loc.id) ?? []);
    if (hist.failed.includes(loc.id) || fc.failed.includes(loc.id) || !isComplete(merged, needed))
      failedPoints++;
    else gridWeather.set(loc.id, merged);
  }
  if (failedPoints)
    log(`WARNING: ${failedPoints} grid weather point(s) failed; their cells keep the day before`);
  if (failed.length)
    log(
      `WARNING: no complete weather for ${failed.join(', ')}; their previous scores are kept and marked stale`,
    );

  // Score and write the history snapshots.
  const generatedAt = now().toISOString();
  const history = new Map<string, HistoryFile>();
  const written: string[] = [];
  const todayResults = new Map<string, LocationResult>();
  for (const date of toScore) {
    const prev = await readHistory(outDir, date);
    const file: HistoryFile =
      prev && !forced.has(date) && date !== today
        ? prev
        : {
            schemaVersion: 1,
            date,
            generatedAt,
            model: MODEL,
            source: date === today ? 'daily' : 'backfill',
            spots: { ...prev?.spots },
          };
    for (const spot of spots) {
      const w = weather.get(spot.id);
      if (!w) continue;
      const r = scoreSpotOn(species, w, spot, date, habitat[spot.id]);
      if (!r) continue;
      file.spots[spot.id] = toSpotDay(r);
      if (date === today) todayResults.set(spot.id, r);
    }
    if (Object.keys(file.spots).length === 0) continue;
    await writeJsonValidated(historyPath(outDir, date), HistoryFileSchema, file);
    history.set(date, file);
    written.push(date);
  }
  for (const d of days) {
    if (!history.has(d)) {
      const h = await readHistory(outDir, d);
      if (h) history.set(d, h);
    }
  }

  const forecast = new Map<string, Map<string, LocationResult>>();
  for (const date of forecastDays) {
    const m = new Map<string, LocationResult>();
    for (const spot of spots) {
      const w = weather.get(spot.id);
      const r = w ? scoreSpotOn(species, w, spot, date, habitat[spot.id]) : null;
      if (r) m.set(spot.id, r);
    }
    forecast.set(date, m);
  }

  // Grid: score, fill failed cells from the day before, write one file per day.
  const gridWritten: string[] = [];
  let staleToday = 0;
  if (grid) {
    const gridDates = [...gridToScore, ...forecastDays];
    const scores = scoreGrid(grid, species, gridWeather, gridDates);
    const failedCell = grid.cells.weather.map((k) => !gridWeather.has(pointId(k)));
    const byDate = new Map<string, Record<string, Uint8Array>>();
    for (const date of gridDates) {
      const day = scores.get(date)!;
      let stale = 0;
      if (failedCell.some((f) => f)) {
        const prevDate = addDays(date, -1);
        const prev =
          byDate.get(prevDate) ??
          (await readGridDay(outDir, prevDate).then((f) =>
            f && f.count === grid.count
              ? Object.fromEntries(Object.entries(f.species).map(([k, v]) => [k, decodeScores(v)]))
              : undefined,
          ));
        for (const s of species)
          day[s.id] = day[s.id]!.map((v, i) => {
            if (!failedCell[i]) return v;
            const p = prev?.[s.id]?.[i];
            return p === undefined || p === NO_SCORE ? null : p;
          });
        stale = failedCell.filter((f) => f).length;
      }
      if (date === today) staleToday = stale;
      byDate.set(
        date,
        Object.fromEntries(
          Object.entries(day).map(([k, v]) => [
            k,
            Uint8Array.from(v, (x) => (x === null ? NO_SCORE : x)),
          ]),
        ),
      );
      await writeJsonValidated(gridDayPath(outDir, date), GridDayFileSchema, {
        schemaVersion: 1,
        date,
        generatedAt,
        source: date > today ? 'forecast' : date === today ? 'daily' : 'backfill',
        count: grid.count,
        species: Object.fromEntries(Object.entries(day).map(([k, v]) => [k, encodeScores(v)])),
        staleCells: stale,
      });
      gridWritten.push(date);
    }
  }

  const latest = buildLatest({
    generatedAt,
    today,
    model: MODEL,
    apiCalls,
    days,
    forecastDays,
    spots,
    speciesIds: species.map((s) => s.id),
    history,
    todayResults,
    forecast,
    weather,
    previous: await readLatest(outDir),
  });
  if (grid)
    latest.grid = {
      count: grid.count,
      staleCells: staleToday,
      weatherPoints: grid.weatherPoints.lat.length,
    };
  await writeJsonValidated(latestPath(outDir), LatestFileSchema, latest);
  const pruned = await pruneHistory(outDir, addDays(today, -(KEEP_DAYS - 1)));
  await pruneGrid(outDir, addDays(today, -(KEEP_DAYS - 1)));

  log(
    `Wrote ${written.length} history file(s), ${gridWritten.length} grid file(s) and latest.json; pruned ${pruned.length}`,
  );
  log(
    `Open-Meteo calls (weighted estimate): ${apiCalls.toFixed(1)} · run time ${((Date.now() - started) / 1000).toFixed(1)} s`,
  );
  return { today, written, pruned, failed, apiCalls, stale: latest.stale };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const { values } = parseArgs({
    options: {
      backfill: { type: 'string', default: '0' },
      today: { type: 'string' },
      out: { type: 'string', default: join(ROOT, 'web/public/data') },
    },
  });
  const backfill = Number(values.backfill);
  if (!Number.isInteger(backfill) || backfill < 0 || backfill > KEEP_DAYS) {
    console.error(`--backfill must be 0–${KEEP_DAYS}`);
    process.exit(2);
  }
  run({
    today: values.today ?? process.env.TODAY ?? zurichToday(),
    backfill,
    outDir: resolve(values.out),
    dataDir: join(ROOT, 'data'),
  }).then(
    (s) => {
      if (s.failed.length) console.log(`::warning::Stale spots: ${s.failed.join(', ')}`);
    },
    (e) => {
      console.error(`::error::${(e as Error).message}`);
      process.exit(1);
    },
  );
}
