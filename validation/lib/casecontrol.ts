/**
 * Shared by the weather test (Part A) and the variant comparison (Part C): the record cases, the placebo cases,
 * the weather window per 3 km block and year, and the case-control evaluation itself.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  HISTORICAL_FORECAST_URL,
  RateLimiter,
  adjustForElevation,
  defaultDeps,
  fetchWeather,
  lv95ToWgs84,
  mergeDays,
  wgs84ToLv95,
  type DailyWeather,
} from '@mf/scoring';

const DIR = join(import.meta.dirname, '..');
const CACHE = join(DIR, 'cache', 'weather');
mkdirSync(CACHE, { recursive: true });

export const BLOCK_M = 3000;
export const WINDOW = 30;
export const EXCLUDE = 5;
/** Days of weather before each control window in the Part A cache. */
export const LOOKBACK = 61;
export const LAST_DAY = '2026-10-18'; // historical-forecast data is complete up to ~2 days ago

export const addDays = (d: string, n: number) => {
  const t = new Date(`${d}T12:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
};
const weekend = (d: string) => [0, 6].includes(new Date(`${d}T12:00:00Z`).getUTCDay());
export const month = (d: string) => Number(d.slice(5, 7));

/**
 * Placebo: perennial bracket fungi, visible all year, so their record dates only reflect when observers are out:
 * tinder fungus (Fomes fomentarius), red-belted bracket (Fomitopsis pinicola), artist's bracket (Ganoderma
 * applanatum). Precise records since 2021 in Switzerland, March–November; a fixed random sample of up to 300
 * keeps the weather download within the daily API limit.
 */
const PLACEBO_TAXA = { fomes: 8068867, fomitopsis: 2542395, ganoderma: 2549834 };
const PLACEBO_MAX = 300;
async function placebo(): Promise<{ date: string; E: number; N: number; taxon: string }[]> {
  const out: { date: string; E: number; N: number; taxon: string }[] = [];
  for (const [taxon, key] of Object.entries(PLACEBO_TAXA)) {
    const path = join(DIR, 'cache', `gbif-placebo-${taxon}-ch.json`);
    if (!existsSync(path)) {
      const all: unknown[] = [];
      for (let offset = 0; ; offset += 300) {
        const q = new URLSearchParams({
          taxonKey: String(key),
          country: 'CH',
          coordinateUncertaintyInMeters: '0,1000',
          year: '2021,2026',
          occurrenceStatus: 'PRESENT',
          limit: '300',
          offset: String(offset),
        });
        const page = (await (
          await fetch(`https://api.gbif.org/v1/occurrence/search?${q}`)
        ).json()) as {
          results: unknown[];
          endOfRecords: boolean;
        };
        all.push(...page.results);
        if (page.endOfRecords) break;
      }
      writeFileSync(path, JSON.stringify(all));
    }
    const raw = JSON.parse(readFileSync(path, 'utf8')) as {
      year?: number;
      month?: number;
      day?: number;
      decimalLatitude: number;
      decimalLongitude: number;
    }[];
    for (const r of raw) {
      if (!r.year || !r.month || !r.day || r.month < 3 || r.month > 11) continue;
      const { E, N } = wgs84ToLv95(r.decimalLatitude, r.decimalLongitude);
      out.push({
        date: `${r.year}-${String(r.month).padStart(2, '0')}-${String(r.day).padStart(2, '0')}`,
        E: Math.round(E),
        N: Math.round(N),
        taxon,
      });
    }
  }
  // Fixed-seed shuffle, then the first PLACEBO_MAX: the same sample on every run.
  let seed = 42;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out.slice(0, PLACEBO_MAX);
}

export interface Case {
  species: string;
  date: string;
  E: number;
  N: number;
  elevation: number;
  placebo: boolean;
}

const blockOf = (E: number, N: number) => `${Math.floor(E / BLOCK_M)}_${Math.floor(N / BLOCK_M)}`;
const keyOf = (c: Case) => `${blockOf(c.E, c.N)}_${c.date.slice(0, 4)}`;

export async function loadCases(): Promise<{ cases: Case[]; placeboCases: Case[] }> {
  const occ = JSON.parse(readFileSync(join(DIR, 'data/occurrences.json'), 'utf8')) as {
    ch: { species: string; date: string; E: number; N: number; elevation: number | null }[];
  };
  const cases: Case[] = occ.ch
    .filter((o) => o.date >= '2021-01-01' && o.date <= LAST_DAY && o.elevation !== null)
    .map((o) => ({ ...o, elevation: o.elevation!, placebo: false }));
  // Placebo records: elevation from the target records in the same block, or 600 m (GBIF has none for most).
  const blockElev = new Map<string, number[]>();
  for (const c of cases)
    blockElev.set(blockOf(c.E, c.N), [...(blockElev.get(blockOf(c.E, c.N)) ?? []), c.elevation]);
  const placeboCases: Case[] = (await placebo())
    .filter((f) => f.date <= LAST_DAY)
    .map((f) => {
      const e = blockElev.get(blockOf(f.E, f.N));
      return {
        species: 'placebo',
        date: f.date,
        E: f.E,
        N: f.N,
        elevation: e ? e.reduce((a, b) => a + b, 0) / e.length : 600,
        placebo: true,
      };
    });
  return { cases, placeboCases };
}

export type WeatherByWindow = Map<string, { w: DailyWeather[]; elevation: number }>;
export interface WeatherWindow {
  key: string;
  start: string;
  end: string;
  elevation: number;
}

/** One weather window per 3 km block and year, covering all its cases' control periods plus LOOKBACK. */
export function windowsOf(all: Case[]): Map<string, WeatherWindow> {
  const acc = new Map<string, { elev: number[]; start: string; end: string }>();
  for (const c of all) {
    const key = keyOf(c);
    const start = addDays(c.date, -WINDOW - LOOKBACK);
    const end = addDays(c.date, WINDOW) > LAST_DAY ? LAST_DAY : addDays(c.date, WINDOW);
    const w = acc.get(key);
    if (!w) acc.set(key, { elev: [c.elevation], start, end });
    else {
      w.elev.push(c.elevation);
      if (start < w.start) w.start = start;
      if (end > w.end) w.end = end;
    }
  }
  return new Map(
    [...acc].map(([key, w]) => [
      key,
      {
        key,
        start: w.start,
        end: w.end,
        elevation: Math.round(w.elev.reduce((a, b) => a + b, 0) / w.elev.length),
      },
    ]),
  );
}

/**
 * Weather per block and year (merged windows), fetched once each and cached. `extraLookback` days are added in
 * front of the Part A window as a separate cached prefix, for variants that need a longer history.
 * `prefixOnly` fetches only those prefixes, for the given windows (fetch-history.ts).
 * Exits with code 3 when Open-Meteo refuses (daily limit); the cache is kept, so a re-run continues.
 */
export async function loadWeather(
  windows: Map<string, WeatherWindow>,
  extraLookback = 0,
  prefixOnly = false,
): Promise<WeatherByWindow> {
  const limiter = new RateLimiter(450, defaultDeps.sleep);
  const deps = { ...defaultDeps, limiter, log: () => {} };
  let fetched = 0;
  let calls = 0;
  const get = async (path: string, key: string, elevation: number, start: string, end: string) => {
    if (existsSync(path)) return JSON.parse(readFileSync(path, 'utf8')) as DailyWeather[];
    const [bx, by] = key.split('_').map(Number) as [number, number];
    const { lat, lon } = lv95ToWgs84((bx + 0.5) * BLOCK_M, (by + 0.5) * BLOCK_M);
    const r = await fetchWeather(
      HISTORICAL_FORECAST_URL,
      [{ id: 'x', lat, lon, elevation }],
      { start_date: start, end_date: end },
      deps,
    );
    calls += r.calls;
    if (r.failed.length) {
      console.log(
        `Stopped after ${fetched} new windows (${calls.toFixed(0)} calls): Open-Meteo refused (daily limit?). Run again later; cached windows are kept.`,
      );
      process.exit(3);
    }
    const w = r.weather.get('x')!;
    writeFileSync(path, JSON.stringify(w));
    fetched++;
    if (fetched % 50 === 0) console.log(`  ${fetched} windows fetched, ${calls.toFixed(0)} calls`);
    return w;
  };
  const weather: WeatherByWindow = new Map();
  for (const { key, start, end, elevation } of windows.values()) {
    const pStart = addDays(start, -extraLookback);
    const pEnd = addDays(start, -1);
    const prefixPath = join(CACHE, `${key}_prefix_${pStart}_${pEnd}_${elevation}.json`);
    if (prefixOnly) {
      await get(prefixPath, key, elevation, pStart, pEnd);
      continue;
    }
    let w = await get(
      join(CACHE, `${key}_${start}_${end}_${elevation}.json`),
      key,
      elevation,
      start,
      end,
    );
    if (extraLookback > 0) w = mergeDays(await get(prefixPath, key, elevation, pStart, pEnd), w);
    weather.set(key, { w, elevation });
  }
  console.log(
    `Weather: ${windows.size} block-year windows (${fetched} fetched now, ${calls.toFixed(0)} weighted calls)`,
  );
  return weather;
}

/** Percentile of the case among its controls (0.5 = no difference). */
const rank = (v: number, controls: number[]) =>
  (controls.filter((x) => x < v).length + 0.5 * controls.filter((x) => x === v).length) /
  controls.length;

export type Parts = { W: number; M: number; T: number; score: number };

/**
 * For each case: percentile of `parts` on the record date among its controls (same place, ±WINDOW days, same
 * year, not within ±EXCLUDE days, same kind of day). `parts(weather up to the day, elevation)` returns null when
 * the history is too short.
 */
export function evaluate(
  list: Case[],
  weather: WeatherByWindow,
  parts: (upTo: DailyWeather[], elevation: number) => Parts | null,
) {
  const out: { date: string; W: number; M: number; T: number; score: number }[] = [];
  for (const c of list) {
    const wx = weather.get(keyOf(c));
    if (!wx) continue;
    const w = adjustForElevation(wx.w, c.elevation - wx.elevation);
    const at = (d: string) => {
      const upTo = w.filter((x) => x.date <= d);
      return upTo.at(-1)?.date === d ? parts(upTo, c.elevation) : null;
    };
    const caseP = at(c.date);
    if (!caseP) continue;
    const ctrl: Parts[] = [];
    for (let k = -WINDOW; k <= WINDOW; k++) {
      if (Math.abs(k) <= EXCLUDE) continue;
      const d = addDays(c.date, k);
      if (d > LAST_DAY || weekend(d) !== weekend(c.date)) continue;
      const p = at(d);
      if (p) ctrl.push(p);
    }
    if (ctrl.length < 8) continue;
    const r = (k: keyof Parts) =>
      rank(
        caseP[k],
        ctrl.map((x) => x[k]),
      );
    out.push({ date: c.date, W: r('W'), M: r('M'), T: r('T'), score: r('score') });
  }
  return out;
}

export function summarise(r: { W: number; M: number; T: number; score: number }[]) {
  const mean = (k: 'W' | 'M' | 'T' | 'score', a = r) => a.reduce((s, x) => s + x[k], 0) / a.length;
  // Bootstrap 95 % interval of the mean percentile of W.
  let seed = 7;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
  const boots: number[] = [];
  for (let b = 0; b < 2000 && r.length; b++)
    boots.push(
      mean(
        'W',
        r.map(() => r[Math.floor(rnd() * r.length)]!),
      ),
    );
  boots.sort((a, b) => a - b);
  return {
    n: r.length,
    W: r.length ? mean('W') : null,
    W_ci: r.length ? [boots[50]!, boots[1949]!] : null,
    M: r.length ? mean('M') : null,
    T: r.length ? mean('T') : null,
    score: r.length ? mean('score') : null,
  };
}

/** Placebo records used for a species: spring for morel, July–November otherwise. */
export const placeboFor = (speciesId: string, placeboCases: Case[]) =>
  placeboCases.filter((c) =>
    speciesId === 'morel'
      ? month(c.date) >= 3 && month(c.date) <= 5
      : month(c.date) >= 7 && month(c.date) <= 11,
  );
