/**
 * Part A, season test: record dates by elevation vs. the season curves of data/species.json.
 *   npx tsx validation/season-test.ts   → validation/results/season.json
 * Main: precise records in ZH + SZ ("strict"). Supplement: precise records from all of Switzerland ("ch"), and the
 * SwissFungi dates in ZH + SZ (5 km squares, no elevation) for the season shape pooled over all elevations.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { SpeciesFileSchema, dayOfYear, seasonScore, shiftedSeason } from '@mf/scoring';

const DIR = import.meta.dirname;
const ROOT = join(DIR, '..');
mkdirSync(join(DIR, 'results'), { recursive: true });
const species = SpeciesFileSchema.parse(
  JSON.parse(readFileSync(join(ROOT, 'data/species.json'), 'utf8')),
).species;
type Rec = { species: string; date: string; elevation: number | null };
const occ = JSON.parse(readFileSync(join(DIR, 'data/occurrences.json'), 'utf8')) as {
  strict: Rec[];
  ch: Rec[];
  sf5km: Rec[];
};

const BANDS = [
  [0, 700],
  [700, 1000],
  [1000, 1300],
  [1300, 3000],
] as const;

/** Least-squares slope of y on x. */
function slope(x: number[], y: number[]): number | null {
  if (x.length < 5) return null;
  const mx = x.reduce((a, b) => a + b, 0) / x.length;
  const my = y.reduce((a, b) => a + b, 0) / y.length;
  let num = 0;
  let den = 0;
  x.forEach((xi, i) => {
    num += (xi - mx) * (y[i]! - my);
    den += (xi - mx) ** 2;
  });
  return den ? num / den : null;
}

const results: Record<string, unknown> = {};
for (const s of species) {
  const evalSet = (list: Rec[]) => {
    const recs = list.filter((r) => r.species === s.id && r.elevation !== null);
    const S = recs.map((r) => seasonScore(s, r.date, r.elevation!));
    const bands = BANDS.map(([lo, hi]) => {
      const idx = recs
        .map((r, i) => (r.elevation! >= lo && r.elevation! < hi ? i : -1))
        .filter((i) => i >= 0);
      const doy = idx.map((i) => dayOfYear(recs[i]!.date)).sort((a, b) => a - b);
      const mid = (lo + Math.min(hi, 1800)) / 2;
      const [a, b, c, d] = shiftedSeason(s, mid);
      return {
        band: `${lo}–${hi === 3000 ? '' : hi} m`,
        n: idx.length,
        inSeason: idx.length ? idx.filter((i) => S[i]! > 0).length / idx.length : null,
        inPeak: idx.length ? idx.filter((i) => S[i]! === 1).length / idx.length : null,
        medianDoy: doy.length ? doy[Math.floor(doy.length / 2)] : null,
        modelPeakMid: (b + c) / 2,
        modelRange: [a, d],
      };
    });
    // Elevation shift: days per 100 m (records within the model's season months only, to avoid off-season noise).
    const inMonths = recs.filter(
      (r) => seasonScore(s, r.date, 1000) > 0 || seasonScore(s, r.date, r.elevation!) > 0,
    );
    return {
      n: recs.length,
      inSeason: recs.length ? S.filter((v) => v > 0).length / recs.length : null,
      inPeak: recs.length ? S.filter((v) => v === 1).length / recs.length : null,
      bands,
      shiftDaysPer100m: slope(
        inMonths.map((r) => r.elevation! / 100),
        inMonths.map((r) => dayOfYear(r.date)),
      ),
      points: recs.map((r) => [dayOfYear(r.date), r.elevation!]),
    };
  };
  // Pooled SwissFungi dates (no elevation): share inside the model season at 600 m and 1,200 m.
  const sfDoy = occ.sf5km.filter((r) => r.species === s.id).map((r) => dayOfYear(r.date));
  const inAt = (elev: number) =>
    sfDoy.length
      ? sfDoy.filter(
          (d) =>
            seasonScore(s, `2026-${String(Math.ceil(d / 31)).padStart(2, '0')}-01`, elev) >= 0 &&
            inRange(d, elev),
        ).length / sfDoy.length
      : null;
  const inRange = (d: number, elev: number) => {
    const [a, , , e] = shiftedSeason(s, elev);
    return (d > a && d < e) || (d + 365 > a && d + 365 < e);
  };
  const curve = Array.from({ length: 16 }, (_, k) => 300 + k * 100).map((elev) => [
    elev,
    ...shiftedSeason(s, elev),
  ]);
  results[s.id] = {
    strict: evalSet(occ.strict),
    ch: evalSet(occ.ch),
    sf5km: { n: sfDoy.length, inSeason600: inAt(600), inSeason1200: inAt(1200), doy: sfDoy },
    curve,
    modelShift: s.elevationShift,
  };
  const r = results[s.id] as {
    strict: { n: number; inSeason: number | null };
    ch: {
      n: number;
      inSeason: number | null;
      inPeak: number | null;
      shiftDaysPer100m: number | null;
    };
    sf5km: { n: number; inSeason600: number | null; inSeason1200: number | null };
  };
  const pct = (x: number | null) => (x === null ? '–' : `${Math.round(x * 100)} %`);
  console.log(
    `${s.id.padEnd(19)} strict n=${String(r.strict.n).padStart(3)} in season ${pct(r.strict.inSeason).padStart(5)} | CH n=${String(r.ch.n).padStart(3)} in season ${pct(r.ch.inSeason).padStart(5)}, in peak ${pct(r.ch.inPeak).padStart(5)}, shift ${r.ch.shiftDaysPer100m?.toFixed(1) ?? '–'} d/100 m (model start ${s.elevationShift.startDaysPer100m}, end ${s.elevationShift.endDaysPer100m}) | SF n=${r.sf5km.n} in season @600 ${pct(r.sf5km.inSeason600)} @1200 ${pct(r.sf5km.inSeason1200)}`,
  );
}
writeFileSync(join(DIR, 'results', 'season.json'), JSON.stringify(results));
