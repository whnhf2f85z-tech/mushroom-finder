/**
 * Part C, sanity checks (no API calls):
 *   1. Sensitivity: change one input at a time from a good base day, per species → score change.
 *   2. Grid score spread: the daily grid files of the app (web/public/data/grid/) → distribution per species and day.
 *   3. Habitat map: H (habitat score, no weather) for every forest square and species.
 * Monotonicity itself is a unit test: packages/scoring/test/monotonicity.test.ts.
 *   npx tsx validation/sanity.ts   → validation/results/sanity.json (charts: plots.py)
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DEFAULT_CONFIG,
  GridDayFileSchema,
  GridFileSchema,
  NO_SCORE,
  SpeciesFileSchema,
  cellHabitat,
  decodeScores,
  habitatScore,
  scoreSpecies,
  type DailyWeather,
  type Habitat,
  type Species,
} from '@mf/scoring';

const DIR = import.meta.dirname;
const ROOT = join(DIR, '..');
const readJson = (p: string) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'));
const species = SpeciesFileSchema.parse(readJson('data/species.json')).species;
const grid = GridFileSchema.parse(readJson('web/public/data/static/grid.json'));

const addDays = (d: string, n: number) => {
  const t = new Date(`${d}T12:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
};
const midOf = (r: { min: number; max: number }) => (r.min + r.max) / 2;

// 1. Sensitivity --------------------------------------------------------------------------------------------------

const midPeak = (s: Species) => {
  const doy = (md: string) => {
    const [m, d] = md.split('-').map(Number) as [number, number];
    return Math.round((Date.UTC(2026, m - 1, d) - Date.UTC(2026, 0, 1)) / 86_400_000);
  };
  const mid = Math.round((doy(s.season.peakStart) + doy(s.season.peakEnd)) / 2);
  return new Date(Date.UTC(2026, 0, 1 + mid)).toISOString().slice(0, 10);
};
const PH = ['acidic', 'neutral', 'calcareous'] as const;
const bestPh = (s: Species) => PH.reduce((a, b) => (s.ph[b] > s.ph[a] ? b : a));
const worstPh = (s: Species) => PH.reduce((a, b) => (s.ph[b] < s.ph[a] ? b : a));

interface Base {
  date: string;
  rainFactor: number;
  tempShift: number;
  soil: number;
  frostNights: number;
  background: number;
  habitat: Habitat;
}
function weather(s: Species, b: Base): DailyWeather[] {
  const t = midOf(s.temperature) + b.tempShift;
  const rain = (b.rainFactor * 1.5 * s.fullRainMm) / (s.rainLag.max - s.rainLag.min + 1);
  const out: DailyWeather[] = [];
  for (let lag = 89; lag >= 0; lag--) {
    const inLag = lag >= s.rainLag.min && lag <= s.rainLag.max;
    out.push({
      date: addDays(b.date, -lag),
      precip: inLag ? rain : b.background,
      tmean: t,
      tmin: lag < b.frostNights ? -2 : t - 4,
      tmax: t + 4,
      rh: 85,
      et0: 1,
      soilTemp0_7: t,
      soilMoisture7_28: inLag ? b.soil : 0.25,
    });
  }
  return out;
}
const run = (s: Species, b: Base) => scoreSpecies(s, weather(s, b), b.habitat).score;

const sensitivity: Record<string, { base: number; changes: Record<string, number> }> = {};
for (const s of species) {
  const base: Base = {
    date: midPeak(s),
    rainFactor: 1,
    tempShift: 0,
    soil: 0.35,
    frostNights: 0,
    background: 2,
    habitat: {
      elevation: s.elevationShift.referenceElevation,
      forest_pct: midOf(s.forest_pct),
      conifer_pct: midOf(s.conifer_pct),
      ph_class: bestPh(s),
    },
  };
  const b0 = run(s, base);
  const tw = (k: Partial<Base>) => run(s, { ...base, ...k }) - b0;
  const h = base.habitat;
  sensitivity[s.id] = {
    base: b0,
    changes: {
      'Half the rain': tw({ rainFactor: 1 / 3 }),
      'No rain in the window': tw({ rainFactor: 0 }),
      'Drier soil (0.35 → 0.28 m³/m³)': tw({ soil: 0.28 }),
      'Temperature −3 °C': tw({ tempShift: -3 }),
      'Temperature +3 °C': tw({ tempShift: 3 }),
      'Temperature −6 °C': tw({ tempShift: -6 }),
      'Temperature +6 °C': tw({ tempShift: 6 }),
      'One frost night': tw({ frostNights: 1 }),
      'Dry 60 days': tw({ background: 0 }),
      'Two weeks earlier': tw({ date: addDays(base.date, -14) }),
      'Six weeks earlier': tw({ date: addDays(base.date, -42) }),
      '300 m above its range': tw({ habitat: { ...h, elevation: s.elevation.max + 300 } }),
      'Worst pH class': tw({ habitat: { ...h, ph_class: worstPh(s) } }),
      'pH unknown': tw({ habitat: { ...h, ph_class: 'unknown' } }),
      'Conifer share −40 points outside range': tw({
        habitat: {
          ...h,
          conifer_pct:
            s.conifer_pct.min >= 40
              ? s.conifer_pct.min - 40
              : Math.min(100, s.conifer_pct.max + 40),
        },
      }),
    },
  };
}

// 2. Grid score spread --------------------------------------------------------------------------------------------

const gridDir = join(ROOT, 'web/public/data/grid');
const days = readdirSync(gridDir)
  .filter((f) => /^\d{4}-\d\d-\d\d\.json$/.test(f))
  .sort();
const pct = (sorted: number[], p: number) =>
  sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]!;
const spread: Record<
  string,
  {
    date: string;
    source: string;
    p10: number;
    p50: number;
    p90: number;
    max: number;
    good: number;
    zero: number;
  }[]
> = {};
const histogram: Record<string, number[]> = {};
let today = '';
for (const f of days) {
  const g = GridDayFileSchema.parse(JSON.parse(readFileSync(join(gridDir, f), 'utf8')));
  if (g.source !== 'forecast') today = g.date;
  for (const [id, b64] of Object.entries(g.species)) {
    const v = [...decodeScores(b64)].filter((x) => x !== NO_SCORE).sort((a, b) => a - b);
    (spread[id] ??= []).push({
      date: g.date,
      source: g.source,
      p10: pct(v, 0.1),
      p50: pct(v, 0.5),
      p90: pct(v, 0.9),
      max: v.at(-1)!,
      good: v.filter((x) => x >= 60).length / v.length,
      zero: v.filter((x) => x === 0).length / v.length,
    });
  }
}
{
  const g = GridDayFileSchema.parse(
    JSON.parse(readFileSync(join(gridDir, `${today}.json`), 'utf8')),
  );
  for (const [id, b64] of Object.entries(g.species)) {
    const h = Array(11).fill(0) as number[];
    for (const x of decodeScores(b64)) if (x !== NO_SCORE) h[Math.min(10, Math.floor(x / 10))]!++;
    histogram[id] = h;
  }
}

// 3. Habitat map --------------------------------------------------------------------------------------------------

const n = grid.cells.e.length;
const habitatMap: Record<string, number[]> = {};
const habitatStats: Record<string, { p10: number; p50: number; p90: number; above07: number }> = {};
for (const s of species) {
  const H = Array.from(
    { length: n },
    (_, i) => habitatScore(cellHabitat(grid, i), s, 1, DEFAULT_CONFIG).H,
  );
  habitatMap[s.id] = H.map((x) => Math.round(x * 1000) / 1000);
  const sorted = [...H].sort((a, b) => a - b);
  habitatStats[s.id] = {
    p10: pct(sorted, 0.1),
    p50: pct(sorted, 0.5),
    p90: pct(sorted, 0.9),
    above07: H.filter((x) => x >= 0.7).length / n,
  };
}

writeFileSync(
  join(DIR, 'results', 'sanity.json'),
  JSON.stringify({
    sensitivity,
    grid: { days: days.map((f) => f.slice(0, 10)), today, spread, histogram },
    habitat: {
      e: grid.cells.e,
      n: grid.cells.n,
      canton: grid.cells.canton,
      H: habitatMap,
      stats: habitatStats,
    },
  }),
);
for (const s of species) {
  const sp = spread[s.id]!.find((x) => x.date === today)!;
  const hs = habitatStats[s.id]!;
  console.log(
    `${s.id.padEnd(19)} base ${String(sensitivity[s.id]!.base).padStart(3)} | grid ${today}: p10 ${sp.p10} p50 ${sp.p50} p90 ${sp.p90} max ${sp.max} ≥60 ${(100 * sp.good).toFixed(0)} % | H p10 ${hs.p10.toFixed(2)} p50 ${hs.p50.toFixed(2)} p90 ${hs.p90.toFixed(2)} ≥0.7 ${(100 * hs.above07).toFixed(0)} %`,
  );
}
