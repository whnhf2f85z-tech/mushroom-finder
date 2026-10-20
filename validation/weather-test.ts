/**
 * Part A, weather test (case-control). For each record since 2021 (precise, all of Switzerland): the weather part of
 * the score on the record date vs. control dates at the same place, in the same season (±30 days, same year), on the
 * same kind of day (weekend vs weekday). A placebo, tinder fungus (Fomes fomentarius, visible all year), measures
 * how much "signal" comes from observer behaviour alone.
 *   npx tsx validation/weather-test.ts   → validation/results/weather.json
 * Weather is cached per place and window in validation/cache/weather/ (resumable if the daily API limit is hit).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DEFAULT_CONFIG,
  HISTORICAL_FORECAST_URL,
  RateLimiter,
  SpeciesFileSchema,
  adjustForElevation,
  defaultDeps,
  fetchWeather,
  lv95ToWgs84,
  scoreSpecies,
  wgs84ToLv95,
  type DailyWeather,
  type Habitat,
  type Species,
} from '@mf/scoring';

const DIR = import.meta.dirname;
const ROOT = join(DIR, '..');
const CACHE = join(DIR, 'cache', 'weather');
mkdirSync(CACHE, { recursive: true });
mkdirSync(join(DIR, 'results'), { recursive: true });

const BLOCK_M = 3000;
const WINDOW = 30;
const EXCLUDE = 5;
const LOOKBACK = 61;
const LAST_DAY = '2026-10-18'; // historical-forecast data is complete up to ~2 days ago

const species = SpeciesFileSchema.parse(
  JSON.parse(readFileSync(join(ROOT, 'data/species.json'), 'utf8')),
).species;
const occ = JSON.parse(readFileSync(join(DIR, 'data/occurrences.json'), 'utf8')) as {
  ch: { species: string; date: string; E: number; N: number; elevation: number | null }[];
};

const addDays = (d: string, n: number) => {
  const t = new Date(`${d}T12:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
};
const weekend = (d: string) => [0, 6].includes(new Date(`${d}T12:00:00Z`).getUTCDay());

// Placebo: tinder fungus, precise records since 2021 in Switzerland.
async function placebo(): Promise<
  { date: string; E: number; N: number; elevation: number | null }[]
> {
  const path = join(DIR, 'cache', 'gbif-fomes-ch.json');
  if (!existsSync(path)) {
    const out: unknown[] = [];
    for (let offset = 0; ; offset += 300) {
      const q = new URLSearchParams({
        taxonKey: '8068867',
        country: 'CH',
        coordinateUncertaintyInMeters: '0,1000',
        year: '2021,2026',
        occurrenceStatus: 'PRESENT',
        limit: '300',
        offset: String(offset),
      });
      const page = (await (
        await fetch(`https://api.gbif.org/v1/occurrence/search?${q}`)
      ).json()) as { results: unknown[]; endOfRecords: boolean };
      out.push(...page.results);
      if (page.endOfRecords) break;
    }
    writeFileSync(path, JSON.stringify(out));
  }
  const raw = JSON.parse(readFileSync(path, 'utf8')) as {
    year?: number;
    month?: number;
    day?: number;
    decimalLatitude: number;
    decimalLongitude: number;
    elevation?: number;
  }[];
  return raw
    .filter((r) => r.year && r.month && r.day)
    .map((r) => {
      const { E, N } = wgs84ToLv95(r.decimalLatitude, r.decimalLongitude);
      return {
        date: `${r.year}-${String(r.month).padStart(2, '0')}-${String(r.day).padStart(2, '0')}`,
        E: Math.round(E),
        N: Math.round(N),
        elevation: null,
      };
    });
}

interface Case {
  species: string;
  date: string;
  E: number;
  N: number;
  elevation: number;
  placebo: boolean;
}

const cases: Case[] = occ.ch
  .filter((o) => o.date >= '2021-01-01' && o.date <= LAST_DAY && o.elevation !== null)
  .map((o) => ({ ...o, elevation: o.elevation!, placebo: false }));
// Placebo records are scored with every species' model, within each species' months.
const fomes = await placebo();
// Fomes records have no elevation in GBIF: use the mean elevation of the target records in the same block, or 600 m.
const blockOf = (E: number, N: number) => `${Math.floor(E / BLOCK_M)}_${Math.floor(N / BLOCK_M)}`;
const blockElev = new Map<string, number[]>();
for (const c of cases)
  blockElev.set(blockOf(c.E, c.N), [...(blockElev.get(blockOf(c.E, c.N)) ?? []), c.elevation]);
const placeboCases: Case[] = fomes
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

// Weather windows per block and year (merged), fetched once each.
const windows = new Map<
  string,
  { E: number; N: number; elev: number[]; start: string; end: string }
>();
for (const c of [...cases, ...placeboCases]) {
  const key = `${blockOf(c.E, c.N)}_${c.date.slice(0, 4)}`;
  const start = addDays(c.date, -WINDOW - LOOKBACK);
  const end = addDays(c.date, WINDOW) > LAST_DAY ? LAST_DAY : addDays(c.date, WINDOW);
  const w = windows.get(key);
  if (!w) windows.set(key, { E: c.E, N: c.N, elev: [c.elevation], start, end });
  else {
    w.elev.push(c.elevation);
    if (start < w.start) w.start = start;
    if (end > w.end) w.end = end;
  }
}

const limiter = new RateLimiter(450, defaultDeps.sleep);
const deps = { ...defaultDeps, limiter, log: () => {} };
let fetched = 0;
let calls = 0;
const weather = new Map<string, { w: DailyWeather[]; elevation: number }>();
const keys = [...windows.keys()];
for (const [n, key] of keys.entries()) {
  const win = windows.get(key)!;
  const [bx, by] = key.split('_').map(Number) as [number, number];
  const elevation = Math.round(win.elev.reduce((a, b) => a + b, 0) / win.elev.length);
  const path = join(CACHE, `${key}_${win.start}_${win.end}_${elevation}.json`);
  if (existsSync(path)) {
    weather.set(key, { w: JSON.parse(readFileSync(path, 'utf8')), elevation });
    continue;
  }
  const { lat, lon } = lv95ToWgs84((bx + 0.5) * BLOCK_M, (by + 0.5) * BLOCK_M);
  const r = await fetchWeather(
    HISTORICAL_FORECAST_URL,
    [{ id: 'x', lat, lon, elevation }],
    { start_date: win.start, end_date: win.end },
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
  weather.set(key, { w, elevation });
  fetched++;
  if (fetched % 50 === 0)
    console.log(`  ${n + 1}/${keys.length} windows, ${calls.toFixed(0)} calls`);
}
console.log(
  `Weather: ${keys.length} block-year windows (${fetched} fetched now, ${calls.toFixed(0)} weighted calls)`,
);

/** Weather part of the score (no season, no habitat): (M^0.6 · T^0.4) · F · D, plus the components. */
function parts(s: Species, w: DailyWeather[], date: string, elevation: number) {
  const upTo = w.filter((d) => d.date <= date);
  if (upTo.at(-1)?.date !== date || upTo.length < LOOKBACK) return null;
  const habitat: Habitat = { elevation, ph_class: 'unknown' };
  const r = scoreSpecies(s, upTo, habitat, {}, DEFAULT_CONFIG);
  const c = r.components;
  const wm = DEFAULT_CONFIG.moistureWeight;
  return {
    W: Math.pow(c.M, wm) * Math.pow(c.T, 1 - wm) * c.F * c.D,
    M: c.M,
    T: c.T,
    score: r.score,
  };
}

/** Percentile of the case among its controls (0.5 = no difference). */
const rank = (v: number, controls: number[]) =>
  (controls.filter((x) => x < v).length + 0.5 * controls.filter((x) => x === v).length) /
  controls.length;

function evaluate(list: Case[], s: Species) {
  const out: { W: number; M: number; T: number; score: number; S: number }[] = [];
  for (const c of list) {
    const wx = weather.get(`${blockOf(c.E, c.N)}_${c.date.slice(0, 4)}`);
    if (!wx) continue;
    const w = adjustForElevation(wx.w, c.elevation - wx.elevation);
    const caseP = parts(s, w, c.date, c.elevation);
    if (!caseP) continue;
    const ctrl: NonNullable<ReturnType<typeof parts>>[] = [];
    for (let k = -WINDOW; k <= WINDOW; k++) {
      if (Math.abs(k) <= EXCLUDE) continue;
      const d = addDays(c.date, k);
      if (d > LAST_DAY || weekend(d) !== weekend(c.date)) continue;
      const p = parts(s, w, d, c.elevation);
      if (p) ctrl.push(p);
    }
    if (ctrl.length < 8) continue;
    out.push({
      W: rank(
        caseP.W,
        ctrl.map((x) => x.W),
      ),
      M: rank(
        caseP.M,
        ctrl.map((x) => x.M),
      ),
      T: rank(
        caseP.T,
        ctrl.map((x) => x.T),
      ),
      score: rank(
        caseP.score,
        ctrl.map((x) => x.score),
      ),
      S: 0,
    });
  }
  return out;
}

function summarise(r: { W: number; M: number; T: number; score: number }[]) {
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

const month = (d: string) => Number(d.slice(5, 7));
const results: Record<string, unknown> = {};
for (const s of species) {
  const own = cases.filter((c) => c.species === s.id);
  const spring = s.id === 'morel';
  const pl = placeboCases.filter((c) =>
    spring ? month(c.date) >= 3 && month(c.date) <= 5 : month(c.date) >= 7 && month(c.date) <= 11,
  );
  const t = summarise(evaluate(own, s));
  const p = summarise(evaluate(pl, s));
  results[s.id] = {
    target: t,
    placebo: p,
    corrected: t.W !== null && p.W !== null ? t.W - p.W + 0.5 : null,
  };
  console.log(
    `${s.id.padEnd(19)} n=${String(t.n).padStart(3)}  W percentile ${t.W?.toFixed(3)} [${t.W_ci?.map((x) => x.toFixed(2)).join('–')}]  M ${t.M?.toFixed(2)} T ${t.T?.toFixed(2)}  | placebo n=${p.n} W ${p.W?.toFixed(3)}  → corrected ${(results[s.id] as { corrected: number | null }).corrected?.toFixed(3)}`,
  );
}
writeFileSync(
  join(DIR, 'results', 'weather.json'),
  JSON.stringify({ design: { BLOCK_M, WINDOW, EXCLUDE, LOOKBACK, LAST_DAY }, results }, null, 1),
);
