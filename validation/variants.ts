/**
 * Part C: compare model variants without touching data/species.json or config.ts. Each variant is a modified
 * copy of the config / species, or an adjustment of M or T on top of the engine's components. All variants are
 * scored on the same data:
 *   - Part B past seasons (spots and sample squares): documented good vs poor weeks, Pilz-Ticker weeks, year order
 *   - Part A case-control: weather part on record dates vs control dates, minus the placebo
 * Variants are chosen on 2021–2024 ("train") only; 2025–2026 ("test") is a held-out check.
 *   npx tsx validation/variants.ts   → validation/results/variants.json
 * Needs (no API calls here): validation/cache/seasons/ from the "Validation (manual)" workflow with lookback 150
 * (artifact "validation-cache"), and the case-control weather with a 60-day prefix (lib/casecontrol.ts).
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DEFAULT_CONFIG,
  DEFAULT_FAVOURITES,
  GridFileSchema,
  HabitatFileSchema,
  SpeciesFileSchema,
  SpotsFileSchema,
  adjustForElevation,
  cellHabitat,
  coolingTrigger,
  elevationAboveWeatherPoint,
  scoreSpecies,
  weatherDistanceKm,
  type DailyWeather,
  type Habitat,
  type ScoringConfig,
  type Species,
} from '@mf/scoring';
import {
  addDays,
  evaluate,
  loadCases,
  loadWeather,
  windowsOf,
  placeboFor,
  summarise,
} from './lib/casecontrol.js';

const DIR = import.meta.dirname;
const ROOT = join(DIR, '..');
const readJson = (p: string) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'));
const species = SpeciesFileSchema.parse(readJson('data/species.json')).species;
const spots = SpotsFileSchema.parse(readJson('data/spots.json')).spots;
const habitatFile = HabitatFileSchema.parse(readJson('web/public/data/static/habitat.json')).spots;
const grid = GridFileSchema.parse(readJson('web/public/data/static/grid.json'));
const documented = readJson('validation/data/documented-periods.json').periods as Record<
  string,
  [string, string, string][]
>;
const ticker = readJson('validation/results/ticker.json').weekly as Record<
  string,
  { reports: number; negative: number }
>;
const pastSeasons = readJson('validation/results/past-seasons.json') as {
  squares: string[];
  years: Record<string, { spots: Record<string, { favourites: number }> }>;
};

const YEARS = [2021, 2022, 2023, 2024, 2025, 2026];
const TRAIN = [2021, 2022, 2023, 2024];
const FIRST = '06-01';
const LAST = '11-15';
const LAST_AVAILABLE = '2026-10-18';
const clamp = (x: number) => Math.min(1, Math.max(0, x));
const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length;

// ---------------------------------------------------------------------------------------------------------------
// Variants. Parameters were fixed before looking at any result and are not tuned.

interface Variant {
  id: string;
  label: string;
  cfg: ScoringConfig;
  /** Species override (e.g. a different rain lag). */
  sp?: (s: Species) => Species;
  /** Adjust M and T after the engine (the score is recombined from the components). */
  adjust?: (
    s: Species,
    w: DailyWeather[],
    elevation: number,
    c: { M: number; T: number },
  ) => { M: number; T: number };
  /**
   * Days of history the variant needs at least. The 120-day soil range uses what exists beyond that (Open-Meteo's
   * historical forecast starts on 2021-03-23, so early summer 2021 has less than 120 days), as the app would.
   */
  history: number;
  /** Species the variant applies to (all if missing). */
  only?: string[];
}

const cfg120: ScoringConfig = {
  ...DEFAULT_CONFIG,
  moisture: { ...DEFAULT_CONFIG.moisture, soilRangeDays: 120 },
};

/**
 * Wet after dry: rain in the 21 days before the species' rain window, against the regional normal for 21 days.
 * At ≤ 0.5 × normal (a dry spell before) M is unchanged; at ≥ 1.5 × normal (it was already wet) M × 0.7.
 */
function wetAfterDry(
  s: Species,
  w: DailyWeather[],
  elevation: number,
  c: { M: number; T: number },
) {
  const n = w.length;
  let prior = 0;
  for (let lag = s.rainLag.max + 1; lag <= s.rainLag.max + 21 && lag < n; lag++)
    prior += Math.min(w[n - 1 - lag]!.precip, DEFAULT_CONFIG.moisture.maxDailyRainMm);
  const d = DEFAULT_CONFIG.drought;
  const normal21 = ((d.annualNormalBaseMm + d.annualNormalPerMetreMm * elevation) / 365) * 21;
  const ratio = prior / normal21;
  return { M: c.M * (1 - 0.3 * clamp((ratio - 0.5) / 1.0)), T: c.T };
}

function plateau(x: number, min: number, max: number, tail: number) {
  if (x >= min && x <= max) return 1;
  const d = x < min ? min - x : x - max;
  if (d >= tail) return 0;
  return 0.5 * (1 + Math.cos((Math.PI * d) / tail));
}

/** Cool-period cap: T is at most the temperature score of the 30-day mean (a cool month caps a warm week). */
function coolCap(s: Species, w: DailyWeather[], _e: number, c: { M: number; T: number }) {
  const m30 = mean(w.slice(-30).map((d) => d.tmean));
  const t = s.temperature;
  return { M: c.M, T: Math.min(c.T, plateau(m30, t.min, t.max, t.tail)) };
}

/** Honey fungus: T halved unless a cooling trigger happened on any of the last 21 days. */
function needsCooling(_s: Species, w: DailyWeather[], _e: number, c: { M: number; T: number }) {
  for (let k = 0; k < 21 && w.length - k > 13; k++)
    if (coolingTrigger(w.slice(0, w.length - k), DEFAULT_CONFIG)) return c;
  return { M: c.M, T: c.T * 0.5 };
}

const honeyLag = (s: Species): Species =>
  s.id === 'honey_fungus' ? { ...s, rainLag: { min: 10, max: 20 } } : s;
/** 3a with the same rain per day: full rain scaled with the window length (6 → 11 days). */
const honeyLagSameRate = (s: Species): Species =>
  s.id === 'honey_fungus'
    ? {
        ...s,
        rainLag: { min: 10, max: 20 },
        fullRainMm: (s.fullRainMm * 11) / (s.rainLag.max - s.rainLag.min + 1),
      }
    : s;
const halfTail = (s: Species): Species => ({
  ...s,
  temperature: { ...s.temperature, tail: s.temperature.tail / 2 },
});

const VARIANTS: Variant[] = [
  { id: 'V0', label: 'Current model', cfg: DEFAULT_CONFIG, history: 61 },
  { id: 'V1', label: '1: soil range 120 days', cfg: cfg120, history: 61 },
  { id: 'V2', label: '2: wet after dry', cfg: DEFAULT_CONFIG, adjust: wetAfterDry, history: 61 },
  { id: 'V12', label: '1 + 2', cfg: cfg120, adjust: wetAfterDry, history: 61 },
  { id: 'T1', label: 'Temp: 30-day cool cap', cfg: DEFAULT_CONFIG, adjust: coolCap, history: 61 },
  { id: 'T2', label: 'Temp: band tails halved', cfg: DEFAULT_CONFIG, sp: halfTail, history: 61 },
  {
    id: 'H1',
    label: '3a honey: rain lag 10–20 d',
    cfg: DEFAULT_CONFIG,
    sp: honeyLag,
    history: 61,
    only: ['honey_fungus'],
  },
  {
    id: 'H1b',
    label: '3a, same rain per day',
    cfg: DEFAULT_CONFIG,
    sp: honeyLagSameRate,
    history: 61,
    only: ['honey_fungus'],
  },
  {
    id: 'H2',
    label: '3b honey: needs cooling',
    cfg: DEFAULT_CONFIG,
    adjust: needsCooling,
    history: 61,
    only: ['honey_fungus'],
  },
  {
    id: 'H3',
    label: '3a + 3b',
    cfg: DEFAULT_CONFIG,
    sp: honeyLag,
    adjust: needsCooling,
    history: 61,
    only: ['honey_fungus'],
  },
];

/** Score of one species with a variant: the engine, then the variant's M/T adjustment, recombined as the app does. */
function scoreWith(v: Variant, s0: Species, w: DailyWeather[], h: Habitat, distanceKm = 0) {
  const applies = !v.only || v.only.includes(s0.id);
  const s = applies && v.sp ? v.sp(s0) : s0;
  const r = scoreSpecies(
    s,
    w,
    h,
    { weatherDistanceKm: distanceKm },
    applies ? v.cfg : DEFAULT_CONFIG,
  );
  const c = r.components;
  const { M, T } = applies && v.adjust ? v.adjust(s, w, h.elevation, c) : c;
  const wm = DEFAULT_CONFIG.moistureWeight;
  const W = Math.pow(M, wm) * Math.pow(T, 1 - wm) * c.F * c.D;
  const score = Math.round(100 * clamp(c.H * Math.pow(c.S, DEFAULT_CONFIG.seasonExponent) * W));
  return { score, W, M, T, S: c.S, D: c.D, H: c.H };
}

// ---------------------------------------------------------------------------------------------------------------
// Past seasons (same places as Part B).

const SEASON_CACHE = join(DIR, 'cache', 'seasons');
if (!existsSync(SEASON_CACHE))
  throw new Error('Missing validation/cache/seasons (see the header).');
const seasonFiles = readdirSync(SEASON_CACHE);
const seasonWeather = new Map<string, DailyWeather[]>();
for (const y of YEARS) {
  const f = seasonFiles.find(
    (n) => n.startsWith(`${y}_`) && n.split('_')[1]! <= addDays(`${y}-${FIRST}`, -150),
  );
  if (!f)
    throw new Error(`No weather with 150 days of history for ${y} in validation/cache/seasons`);
  for (const [id, w] of Object.entries(
    JSON.parse(readFileSync(join(SEASON_CACHE, f), 'utf8')) as Record<string, DailyWeather[]>,
  ))
    seasonWeather.set(`${y}|${id}`, w);
}

interface Place {
  id: string;
  kind: 'spot' | 'square';
  wid: string;
  habitat: Habitat;
  dz: number;
  distanceKm: number;
}
const squareIdx = new Map(grid.cells.e.map((e, i) => [`sq-${e}-${grid.cells.n[i]}`, i]));
const places: Place[] = [
  ...spots.map((s) => {
    const h = habitatFile[s.id]!;
    return {
      id: s.id,
      kind: 'spot' as const,
      wid: s.id,
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
  ...pastSeasons.squares.map((id) => {
    const i = squareIdx.get(id)!;
    return {
      id,
      kind: 'square' as const,
      wid: `wp${grid.cells.weather[i]}`,
      habitat: cellHabitat(grid, i),
      dz: elevationAboveWeatherPoint(grid, i),
      distanceKm: weatherDistanceKm(grid, i),
    };
  }),
];
const favSpecies = species.filter((s) => DEFAULT_FAVOURITES.includes(s.id));
const weekOf = (d: string) => {
  const t = new Date(`${d}T12:00:00Z`);
  t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7));
  return t.toISOString().slice(0, 10);
};

/** Weekly mean favourites score per year, spots and squares, plus component means for the diagnosis. */
function seasons(v: Variant) {
  const weekly: Record<string, { spot: Record<string, number>; square: Record<string, number> }> =
    {};
  const comp: Record<string, { S: number; M: number; T: number; D: number; n: number }> = {};
  for (const y of YEARS) {
    const sums = { spot: {} as Record<string, number[]>, square: {} as Record<string, number[]> };
    for (const p of places) {
      const w0 = seasonWeather.get(`${y}|${p.wid}`);
      if (!w0) continue;
      const w = adjustForElevation(w0, p.dz);
      let idx = 0;
      for (let d = `${y}-${FIRST}`; d <= `${y}-${LAST}` && d <= LAST_AVAILABLE; d = addDays(d, 1)) {
        while (idx < w.length && w[idx]!.date <= d) idx++;
        const upTo = w.slice(0, idx);
        if (upTo.at(-1)?.date !== d || upTo.length < v.history) continue;
        let best = -1;
        let bestR: ReturnType<typeof scoreWith> | null = null;
        for (const s of favSpecies) {
          const r = scoreWith(v, s, upTo, p.habitat, p.distanceKm);
          if (r.score > best) [best, bestR] = [r.score, r];
        }
        (sums[p.kind][weekOf(d)] ??= []).push(best);
        if (p.kind === 'spot' && bestR && d.slice(5) >= '08-15' && d.slice(5) <= '10-31') {
          const c = (comp[y] ??= { S: 0, M: 0, T: 0, D: 0, n: 0 });
          c.S += bestR.S;
          c.M += bestR.M;
          c.T += bestR.T;
          c.D += bestR.D;
          c.n++;
        }
      }
    }
    weekly[y] = {
      spot: Object.fromEntries(Object.entries(sums.spot).map(([k, a]) => [k, mean(a)])),
      square: Object.fromEntries(Object.entries(sums.square).map(([k, a]) => [k, mean(a)])),
    };
  }
  const components = Object.fromEntries(
    Object.entries(comp).map(([y, c]) => [
      y,
      { S: c.S / c.n, M: c.M / c.n, T: c.T / c.n, D: c.D / c.n },
    ]),
  );
  return { weekly, components };
}

/** AUC: probability that a random value from `a` is above one from `b` (0.5 = no separation). */
function auc(a: number[], b: number[]) {
  if (!a.length || !b.length) return null;
  let s = 0;
  for (const x of a) for (const y of b) s += x > y ? 1 : x === y ? 0.5 : 0;
  return s / (a.length * b.length);
}

/** Documented good weeks vs poor weeks (week midpoint inside a period), and Pilz-Ticker weeks. */
function seasonMetrics(
  weekly: ReturnType<typeof seasons>['weekly'],
  years: number[],
  kind: 'spot' | 'square',
) {
  const good: number[] = [];
  const poor: number[] = [];
  const tickPos: number[] = [];
  const tickOther: number[] = [];
  for (const y of years) {
    for (const [wk, v] of Object.entries(weekly[y]![kind])) {
      const mid = addDays(wk, 3).slice(5);
      for (const [sign, a, b] of documented[y] ?? [])
        if (mid >= a && mid <= b) (sign === '+' ? good : poor).push(v);
      const t = ticker[wk];
      (t && t.reports - t.negative > 0 ? tickPos : tickOther).push(v);
    }
  }
  return {
    periodAUC: auc(good, poor),
    goodMinusPoor: good.length && poor.length ? mean(good) - mean(poor) : null,
    weeks: { good: good.length, poor: poor.length },
    tickerAUC: auc(tickPos, tickOther),
  };
}

/** Season strength (mean 15 Aug – 31 Oct at the spots) and the documented order of the training years. */
const CLEAR_PAIRS: [number, number][] = [
  [2022, 2021],
  [2022, 2023],
  [2024, 2021],
  [2024, 2023],
];
function yearOrder(weekly: ReturnType<typeof seasons>['weekly']) {
  const strength = Object.fromEntries(
    YEARS.map((y) => {
      const v = Object.entries(weekly[y]!.spot).filter(
        ([wk]) => wk.slice(5) >= '08-15' && wk.slice(5) <= '10-31',
      );
      return [y, mean(v.map(([, x]) => x))];
    }),
  );
  return {
    strength,
    concordantPairs: CLEAR_PAIRS.filter(([a, b]) => strength[a]! > strength[b]!).length,
  };
}

/** Honey fungus score level at the spots, mean 15 Aug – 31 Oct per year, and share of days ≥ 60. */
function honeyLevel(v: Variant) {
  const honey = species.find((s) => s.id === 'honey_fungus')!;
  const out: Record<string, { mean: number; good: number }> = {};
  for (const y of YEARS) {
    const xs: number[] = [];
    for (const p of places.filter((p) => p.kind === 'spot')) {
      const w = seasonWeather.get(`${y}|${p.wid}`);
      if (!w) continue;
      for (let d = `${y}-08-15`; d <= `${y}-10-31` && d <= LAST_AVAILABLE; d = addDays(d, 1)) {
        const upTo = w.filter((x) => x.date <= d);
        if (upTo.at(-1)?.date === d) xs.push(scoreWith(v, honey, upTo, p.habitat).score);
      }
    }
    out[y] = { mean: mean(xs), good: xs.filter((x) => x >= 60).length / xs.length };
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Case-control (Part A weather test), split by year.

const { cases, placeboCases } = await loadCases();
/** SKIP_CC=1: past seasons only (e.g. while the case-control history is still being fetched). */
const SKIP_CC = process.env.SKIP_CC === '1';
const ccWeather = SKIP_CC
  ? new Map()
  : await loadWeather(windowsOf([...cases, ...placeboCases]), 60);

function caseControl(v: Variant) {
  if (SKIP_CC) return {};
  const out: Record<
    string,
    Record<
      'train' | 'test',
      { n: number; target: number | null; placebo: number | null; corrected: number | null }
    >
  > = {};
  for (const s of species) {
    if (v.only && !v.only.includes(s.id)) continue;
    const parts = (upTo: DailyWeather[], elevation: number) => {
      if (upTo.length < v.history) return null;
      const r = scoreWith(v, s, upTo, { elevation, ph_class: 'unknown' });
      return { W: r.W, M: r.M, T: r.T, score: r.score };
    };
    const t = evaluate(
      cases.filter((c) => c.species === s.id),
      ccWeather,
      parts,
    );
    const p = evaluate(placeboFor(s.id, placeboCases), ccWeather, parts);
    const split = (r: typeof t, train: boolean) =>
      r.filter((x) => Number(x.date.slice(0, 4)) <= 2024 === train);
    out[s.id] = Object.fromEntries(
      (['train', 'test'] as const).map((k) => {
        const tt = summarise(split(t, k === 'train'));
        const pp = summarise(split(p, k === 'train'));
        return [
          k,
          {
            n: tt.n,
            target: tt.W,
            placebo: pp.W,
            corrected: tt.W !== null && pp.W !== null ? tt.W - pp.W + 0.5 : null,
          },
        ];
      }),
    ) as (typeof out)[string];
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------

const results: Record<string, unknown> = {};
for (const v of VARIANTS) {
  const t0 = Date.now();
  const cc = caseControl(v);
  const meanCorr = (k: 'train' | 'test', ids: string[]) =>
    mean(ids.filter((id) => cc[id]?.[k].corrected != null).map((id) => cc[id]![k].corrected!));
  const row: Record<string, unknown> = { label: v.label, caseControl: cc };
  if (v.id === 'V0' || v.only?.includes('honey_fungus')) row.honeyLevel = honeyLevel(v);
  if (!v.only) {
    const { weekly, components } = seasons(v);
    // Check: the current model must reproduce Part B.
    if (v.id === 'V0')
      for (const y of YEARS)
        for (const [wk, x] of Object.entries(pastSeasons.years[y]!.spots))
          if (Math.abs((weekly[y]!.spot[wk] ?? -99) - x.favourites) > 0.06)
            throw new Error(
              `V0 differs from Part B in ${wk}: ${weekly[y]!.spot[wk]} vs ${x.favourites}`,
            );
    Object.assign(row, {
      train: {
        ...seasonMetrics(weekly, TRAIN, 'spot'),
        squares: seasonMetrics(weekly, TRAIN, 'square'),
        weather: meanCorr(
          'train',
          species.map((s) => s.id),
        ),
      },
      test: {
        ...seasonMetrics(weekly, [2025, 2026], 'spot'),
        squares: seasonMetrics(weekly, [2025, 2026], 'square'),
        weather: meanCorr(
          'test',
          species.map((s) => s.id),
        ),
      },
      years: yearOrder(weekly),
      components,
      weekly: Object.fromEntries(YEARS.map((y) => [y, weekly[y]!.spot])),
    });
  }
  results[v.id] = row;
  const r = row as {
    train?: { periodAUC: number; tickerAUC: number; weather: number };
    years?: { concordantPairs: number; strength: Record<string, number> };
  };
  console.log(
    `${v.id.padEnd(4)} ${v.label.padEnd(28)}`,
    r.train
      ? `period AUC ${r.train.periodAUC.toFixed(3)}  ticker AUC ${r.train.tickerAUC.toFixed(3)}  weather ${r.train.weather.toFixed(3)}  pairs ${r.years!.concordantPairs}/4  2021 ${r.years!.strength[2021]!.toFixed(0)} 2022 ${r.years!.strength[2022]!.toFixed(0)}`
      : '',
    cc.honey_fungus
      ? `honey train ${cc.honey_fungus.train.corrected?.toFixed(3)} test ${cc.honey_fungus.test.corrected?.toFixed(3)}`
      : '',
    `(${((Date.now() - t0) / 1000).toFixed(0)} s)`,
  );
}

/**
 * Uncertainty of the period AUC: resample the documented periods (whole periods, since neighbouring weeks are
 * alike) 2,000 times; 95 % range of each variant's AUC and of its difference to the current model (paired).
 */
function periodBootstrap(years: number[]) {
  const periods: { year: number; sign: string; a: string; b: string }[] = [];
  for (const y of years)
    for (const [sign, a, b] of documented[y] ?? []) periods.push({ year: y, sign, a, b });
  const valuesOf = (id: string, p: (typeof periods)[number]) =>
    Object.entries(
      (results[id] as { weekly: Record<number, Record<string, number>> }).weekly[p.year]!,
    )
      .filter(([wk]) => {
        const mid = addDays(wk, 3).slice(5);
        return mid >= p.a && mid <= p.b;
      })
      .map(([, v]) => v);
  const ids = VARIANTS.filter((v) => !v.only).map((v) => v.id);
  let seed = 11;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
  const draws: Record<string, number[]> = Object.fromEntries(ids.map((id) => [id, []]));
  const diffs: Record<string, number[]> = Object.fromEntries(ids.map((id) => [id, []]));
  for (let b = 0; b < 2000; b++) {
    const pick = periods.map(() => periods[Math.floor(rnd() * periods.length)]!);
    const aucs: Record<string, number | null> = {};
    for (const id of ids) {
      const good = pick.filter((p) => p.sign === '+').flatMap((p) => valuesOf(id, p));
      const poor = pick.filter((p) => p.sign === '-').flatMap((p) => valuesOf(id, p));
      aucs[id] = auc(good, poor);
    }
    if (aucs.V0 == null) continue;
    for (const id of ids)
      if (aucs[id] != null) {
        draws[id]!.push(aucs[id]!);
        diffs[id]!.push(aucs[id]! - aucs.V0);
      }
  }
  const ci = (a: number[]) => {
    const s = [...a].sort((x, y) => x - y);
    return [s[Math.floor(0.025 * s.length)]!, s[Math.floor(0.975 * s.length)]!];
  };
  return Object.fromEntries(
    ids.map((id) => [id, { auc: ci(draws[id]!), diffToV0: ci(diffs[id]!) }]),
  );
}
const bootTrain = periodBootstrap(TRAIN);
const bootTest = periodBootstrap([2025, 2026]);
for (const [id, b] of Object.entries(bootTrain)) {
  const r = results[id] as {
    train: { periodCI?: unknown; periodDiffCI?: unknown };
    test: { periodCI?: unknown; periodDiffCI?: unknown };
  };
  r.train.periodCI = b.auc;
  r.train.periodDiffCI = b.diffToV0;
  r.test.periodCI = bootTest[id]!.auc;
  r.test.periodDiffCI = bootTest[id]!.diffToV0;
  console.log(
    `${id.padEnd(4)} train period AUC 95 % ${b.auc.map((x) => x.toFixed(2)).join('–')}, difference to V0 ${b.diffToV0.map((x) => x.toFixed(3)).join(' to ')}`,
  );
}

writeFileSync(
  join(DIR, 'results', 'variants.json'),
  JSON.stringify({ train: TRAIN, test: [2025, 2026], results }, null, 1),
);
