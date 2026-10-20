/**
 * Part A, weather test (case-control). For each record since 2021 (precise, all of Switzerland): the weather part of
 * the score on the record date vs. control dates at the same place, in the same season (±30 days, same year), on the
 * same kind of day (weekend vs weekday). A placebo of perennial bracket fungi (visible all year) measures how much
 * "signal" comes from observer behaviour alone. Cases, weather windows and evaluation: lib/casecontrol.ts.
 *   npx tsx validation/weather-test.ts   → validation/results/weather.json
 * Weather is cached per place and window in validation/cache/weather/ (resumable if the daily API limit is hit).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DEFAULT_CONFIG,
  SpeciesFileSchema,
  scoreSpecies,
  type DailyWeather,
  type Habitat,
  type Species,
} from '@mf/scoring';
import {
  BLOCK_M,
  EXCLUDE,
  LAST_DAY,
  LOOKBACK,
  WINDOW,
  evaluate,
  loadCases,
  loadWeather,
  windowsOf,
  placeboFor,
  summarise,
} from './lib/casecontrol.js';

const DIR = import.meta.dirname;
const ROOT = join(DIR, '..');
mkdirSync(join(DIR, 'results'), { recursive: true });

const species = SpeciesFileSchema.parse(
  JSON.parse(readFileSync(join(ROOT, 'data/species.json'), 'utf8')),
).species;
const { cases, placeboCases } = await loadCases();
const weather = await loadWeather(windowsOf([...cases, ...placeboCases]));

/** Weather part of the score (no season, no habitat): (M^0.6 · T^0.4) · F · D, plus the components. */
const parts = (s: Species) => (upTo: DailyWeather[], elevation: number) => {
  if (upTo.length < LOOKBACK) return null;
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
};

const results: Record<string, unknown> = {};
for (const s of species) {
  const t = summarise(
    evaluate(
      cases.filter((c) => c.species === s.id),
      weather,
      parts(s),
    ),
  );
  const p = summarise(evaluate(placeboFor(s.id, placeboCases), weather, parts(s)));
  const corrected = t.W !== null && p.W !== null ? t.W - p.W + 0.5 : null;
  results[s.id] = { target: t, placebo: p, corrected };
  console.log(
    `${s.id.padEnd(19)} n=${String(t.n).padStart(3)}  W percentile ${t.W?.toFixed(3)} [${t.W_ci?.map((x) => x.toFixed(2)).join('–')}]  M ${t.M?.toFixed(2)} T ${t.T?.toFixed(2)}  | placebo n=${p.n} W ${p.W?.toFixed(3)}  → corrected ${corrected?.toFixed(3)}`,
  );
}
writeFileSync(
  join(DIR, 'results', 'weather.json'),
  JSON.stringify({ design: { BLOCK_M, WINDOW, EXCLUDE, LOOKBACK, LAST_DAY }, results }, null, 1),
);
