/**
 * Part A, habitat test: habitat score H of forest squares with records vs. background squares, per species.
 *   npx tsx validation/habitat-test.ts   → validation/results/habitat.json
 *
 * AUC = probability that a square with a record has a higher H than a background square (0.5 = no signal).
 * Backgrounds: (1) all forest squares; (2) "target group": squares with a record of any of the 9 species, which
 * partly corrects for where observers go. Supplement: SwissFungi 5 km squares (mean H of their forest squares).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DEFAULT_CONFIG,
  GridFileSchema,
  SpeciesFileSchema,
  cellHabitat,
  habitatScore,
} from '@mf/scoring';

const DIR = import.meta.dirname;
const ROOT = join(DIR, '..');
mkdirSync(join(DIR, 'results'), { recursive: true });
const grid = GridFileSchema.parse(
  JSON.parse(readFileSync(join(ROOT, 'web/public/data/static/grid.json'), 'utf8')),
);
const species = SpeciesFileSchema.parse(
  JSON.parse(readFileSync(join(ROOT, 'data/species.json'), 'utf8')),
).species;
const occ = JSON.parse(readFileSync(join(DIR, 'data/occurrences.json'), 'utf8')) as {
  strict: { species: string; cell: number | null }[];
  sf5km: { species: string; E: number; N: number }[];
};

/** Mann–Whitney AUC of a vs b. */
export function auc(a: number[], b: number[]): number {
  let s = 0;
  for (const x of a) for (const y of b) s += x > y ? 1 : x === y ? 0.5 : 0;
  return s / (a.length * b.length);
}

function bootstrapAuc(a: number[], b: number[], reps = 1000): [number, number] {
  let seed = 11;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
  const v: number[] = [];
  for (let r = 0; r < reps; r++)
    v.push(
      auc(
        a.map(() => a[Math.floor(rnd() * a.length)]!),
        b,
      ),
    );
  v.sort((x, y) => x - y);
  return [v[Math.floor(reps * 0.025)]!, v[Math.floor(reps * 0.975)]!];
}

const cells = [...Array(grid.count).keys()];
const anyRecordCells = new Set(occ.strict.filter((o) => o.cell !== null).map((o) => o.cell!));
const PH = ['acidic', 'neutral', 'calcareous', 'unknown'] as const;

// 5 km squares of SwissFungi: forest cells whose centre lies in the square around the record point.
const sfSquares = new Map<string, number[]>();
for (const o of occ.sf5km) {
  const key = `${o.E}_${o.N}`;
  if (sfSquares.has(key)) continue;
  sfSquares.set(
    key,
    cells.filter(
      (i) =>
        Math.abs(grid.cells.e[i]! * 1000 + 500 - o.E) <= 2500 &&
        Math.abs(grid.cells.n[i]! * 1000 + 500 - o.N) <= 2500,
    ),
  );
}

const results: Record<string, unknown> = {};
const hValues: Record<string, { all: number[]; cases: number[] }> = {};
for (const s of species) {
  const parts = cells.map((i) => habitatScore(cellHabitat(grid, i), s, 1, DEFAULT_CONFIG));
  const H = parts.map((p) => p.H);
  const caseCells = [
    ...new Set(occ.strict.filter((o) => o.species === s.id && o.cell !== null).map((o) => o.cell!)),
  ];
  const caseH = caseCells.map((i) => H[i]!);
  const allH = H;
  const tgH = [...anyRecordCells].map((i) => H[i]!);
  hValues[s.id] = { all: allH, cases: caseH };

  // Which part of H separates? AUC per component against all forest squares.
  const comp = (f: (p: (typeof parts)[number]) => number | null) => {
    const a = caseCells.map((i) => f(parts[i]!)).filter((x): x is number => x !== null);
    const b = cells.map((i) => f(parts[i]!)).filter((x): x is number => x !== null);
    return a.length ? auc(a, b) : null;
  };
  const phShare = (list: number[]) =>
    Object.fromEntries(
      PH.map((p) => [
        p,
        list.filter((i) => grid.cells.ph[i] === p).length / Math.max(1, list.length),
      ]),
    );
  const conifer = (list: number[]) => {
    const v = list
      .map((i) => grid.cells.conifer[i])
      .filter((x): x is number => x !== null)
      .sort((x, y) => x - y);
    return v.length ? v[Math.floor(v.length / 2)]! : null;
  };
  const elev = (list: number[]) => {
    const v = list.map((i) => grid.cells.elevation[i]!).sort((x, y) => x - y);
    return v.length
      ? [
          v[Math.floor(v.length * 0.1)]!,
          v[Math.floor(v.length / 2)]!,
          v[Math.floor(v.length * 0.9)]!,
        ]
      : null;
  };

  // SwissFungi 5 km: mean H per square; cases = squares with this species; background = all SF squares.
  const sqMean = (idx: number[]) =>
    idx.length ? idx.reduce((a, i) => a + H[i]!, 0) / idx.length : null;
  const sfCase = [
    ...new Set(occ.sf5km.filter((o) => o.species === s.id).map((o) => `${o.E}_${o.N}`)),
  ]
    .map((k) => sqMean(sfSquares.get(k)!))
    .filter((x): x is number => x !== null);
  const sfAll = [...sfSquares.values()].map(sqMean).filter((x): x is number => x !== null);

  results[s.id] = {
    nCells: caseCells.length,
    aucAll: caseH.length ? auc(caseH, allH) : null,
    aucAllCi: caseH.length >= 3 ? bootstrapAuc(caseH, allH) : null,
    aucTargetGroup: caseH.length ? auc(caseH, tgH) : null,
    medianH: {
      cases: caseH.length ? [...caseH].sort((a, b) => a - b)[Math.floor(caseH.length / 2)] : null,
      all: [...allH].sort((a, b) => a - b)[Math.floor(allH.length / 2)],
    },
    components: {
      host: comp((p) => p.hostScore),
      ph: comp((p) => p.phScore),
      elevation: comp((p) => p.elevationScore),
      forest: comp((p) => p.forestScore),
    },
    phShare: { cases: phShare(caseCells), all: phShare(cells) },
    coniferMedian: { cases: conifer(caseCells), all: conifer(cells) },
    elevationP10P50P90: { cases: elev(caseCells), all: elev(cells) },
    sf5km: {
      nSquares: sfCase.length,
      nAll: sfAll.length,
      auc: sfCase.length ? auc(sfCase, sfAll) : null,
    },
  };
  const r = results[s.id] as {
    aucAll: number | null;
    aucAllCi: number[] | null;
    aucTargetGroup: number | null;
    sf5km: { nSquares: number; auc: number | null };
  };
  console.log(
    `${s.id.padEnd(19)} squares ${String(caseCells.length).padStart(3)}  AUC all ${r.aucAll?.toFixed(2) ?? '–'} ${r.aucAllCi ? `[${r.aucAllCi.map((x) => x.toFixed(2)).join('–')}]` : ''}  target-group ${r.aucTargetGroup?.toFixed(2) ?? '–'}  | SF 5 km: ${r.sf5km.nSquares} squares, AUC ${r.sf5km.auc?.toFixed(2)}`,
  );
}
writeFileSync(join(DIR, 'results', 'habitat.json'), JSON.stringify({ results, hValues }, null, 0));
