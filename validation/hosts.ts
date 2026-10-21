/**
 * Host trees instead of conifer share. Ran on 2026-10-21 before the change was applied; since then the engine
 * itself uses host trees, so "current" in a new run equals the host-tree version. Compares the current habitat score with one whose
 * host part uses specific host trees.
 *   - Tree mix of a place: site type (SZ Waldstandorte / ZH Waldvegetationskarte) → natural main trees
 *     (pipeline/terrain/trees.ts), with the measured NFI conifer share split among them.
 *   - Host preference per species: SwissFungi mycorrhizal partner counts (validation/data/swissfungi-hosts.json)
 *     divided by each tree's share of Swiss forest stems (NFI 4), smoothed; literature where SwissFungi has
 *     too few partner records (winter chanterelle); none for honey fungus and parasol (not mycorrhizal).
 *   - Host score = Σ (tree share × preference), where preference 1 = found with that tree as often as the tree
 *     occurs in the Swiss forest. An average Swiss forest scores 1; a square of poor hosts less. Capped at 1,
 *     floor 0.2.
 * Then the Part A habitat test (AUC of record squares vs background) and the habitat maps, for both versions.
 *   npx tsx validation/hosts.ts   → validation/results/hosts.json
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DEFAULT_CONFIG,
  GridFileSchema,
  HabitatFileSchema,
  SpeciesFileSchema,
  cellHabitat,
  habitatScore,
  type Habitat,
  type Species,
} from '@mf/scoring';
import { TREES, currentTreeMix, naturalTrees, type Tree, type TreeMix } from '@mf/scoring';

const DIR = import.meta.dirname;
const ROOT = join(DIR, '..');
const readJson = (p: string) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'));
const grid = GridFileSchema.parse(readJson('web/public/data/static/grid.json'));
const species = SpeciesFileSchema.parse(readJson('data/species.json')).species;
const spots = HabitatFileSchema.parse(readJson('web/public/data/static/habitat.json')).spots;
const sf = readJson('validation/data/swissfungi-hosts.json').species as Record<
  string,
  { myko: Record<string, number> }
>;
const occ = readJson('validation/data/occurrences.json') as {
  strict: { species: string; cell: number | null }[];
  sf5km: { species: string; E: number; N: number }[];
};

/** Mann–Whitney AUC of a vs b (as in habitat-test.ts). */
function auc(a: number[], b: number[]): number {
  let s = 0;
  for (const x of a) for (const y of b) s += x > y ? 1 : x === y ? 0.5 : 0;
  return s / (a.length * b.length);
}

/** Share of stems in the Swiss forest, NFI 4 (2009–2017), via waldwissen.net "Die häufigsten Waldbäume der Schweiz". */
const NFI_STEMS: Record<Tree, number> = {
  spruce: 0.37,
  beech: 0.18,
  fir: 0.11,
  larch: 0.06,
  maple: 0.05,
  ash: 0.04,
  pine: 0.04, // Scots 2 %, stone pine 1 %, mountain pine ~1 %
  birch: 0.02,
  oak: 0.015, // sessile 1 %, pedunculate 0.5 %
  alder: 0.015,
  lime: 0.007,
  hornbeam: 0.005, // below the top 20 (< 0.5 %)
  other: 0.088,
};
const GROUP: [RegExp, Tree][] = [
  [/^Picea/, 'spruce'],
  [/^Abies/, 'fir'],
  [/^Pinus/, 'pine'],
  [/^Larix/, 'larch'],
  [/^Fagus/, 'beech'],
  [/^Quercus/, 'oak'],
  [/^Fraxinus/, 'ash'],
  [/^Acer/, 'maple'],
  [/^Carpinus/, 'hornbeam'],
  [/^Tilia/, 'lime'],
  [/^Betula/, 'birch'],
  [/^Alnus/, 'alder'],
];
const groupOf = (label: string): Tree | null =>
  label === 'keine Angabe' ? null : (GROUP.find(([re]) => re.test(label))?.[1] ?? 'other');

/** Smoothing: α pseudo-records spread like the forest itself, so trees with few records stay near neutral. */
const ALPHA = 10;
const MIN_PARTNER_RECORDS = 100;
/**
 * Literature where SwissFungi has too few partner records (Krieglsteiner 2000, via de.wikipedia
 * "Trompeten-Pfifferling": mainly spruce and fir, occasionally broadleaves), as preferences (1 = neutral).
 */
const LITERATURE: Record<string, Partial<Record<Tree, number>>> = {
  winter_chanterelle: { spruce: 1.5, fir: 1.5, pine: 1, larch: 1, beech: 0.5 },
};
const NOT_MYCORRHIZAL = new Set(['honey_fungus', 'parasol']);

interface Affinity {
  source: 'SwissFungi' | 'literature' | 'none';
  records: number;
  a: Record<Tree, number>;
}
function affinity(id: string): Affinity {
  const flat = Object.fromEntries(TREES.map((t) => [t, 1])) as Record<Tree, number>;
  if (NOT_MYCORRHIZAL.has(id)) return { source: 'none', records: 0, a: flat };
  const counts = Object.fromEntries(TREES.map((t) => [t, 0])) as Record<Tree, number>;
  for (const [label, n] of Object.entries(sf[id]?.myko ?? {})) {
    const g = groupOf(label);
    if (g) counts[g] += n;
  }
  const N = Object.values(counts).reduce((a, b) => a + b, 0);
  if (N < MIN_PARTNER_RECORDS) {
    const lit = LITERATURE[id] ?? {};
    return {
      source: 'literature',
      records: N,
      a: Object.fromEntries(TREES.map((t) => [t, lit[t] ?? 0.3])) as Record<Tree, number>,
    };
  }
  // Preference = observed partner share / the tree's share of the forest (smoothed towards 1).
  const pref = Object.fromEntries(
    TREES.map((t) => [t, (counts[t] + ALPHA * NFI_STEMS[t]) / ((N + ALPHA) * NFI_STEMS[t])]),
  ) as Record<Tree, number>;
  return { source: 'SwissFungi', records: N, a: pref };
}

const FLOOR = DEFAULT_CONFIG.habitat.pctFloor;
const hostFromMix = (mix: TreeMix, a: Record<Tree, number>) =>
  Math.min(
    1,
    Math.max(
      FLOOR,
      // Rounded so a mix summing to 0.9999999 isn't below a neutral host's 1.
      Math.round(Object.entries(mix).reduce((s, [t, v]) => s + v * a[t as Tree], 0) * 1e6) / 1e6,
    ),
  );

/** H as in packages/scoring/src/habitat.ts, with the host part replaced. */
function habitatWith(h: Habitat, s: Species, host: number) {
  const cfg = DEFAULT_CONFIG;
  const base = habitatScore(h, s, 1, cfg);
  const w = { ...cfg.habitat.weights, ...s.habitatWeights };
  const parts: [number, number][] = [
    [host, w.host],
    [base.phScore, w.ph],
    [base.elevationScore, w.elevation],
  ];
  if (base.forestScore !== null) parts.push([base.forestScore, w.forest]);
  const totalW = parts.reduce((x, [, wi]) => x + wi, 0);
  return Math.exp(
    parts.reduce((x, [v, wi]) => x + wi * Math.log(Math.max(cfg.habitat.componentFloor, v)), 0) /
      totalW,
  );
}

// Tree mix per cell and spot.
const cells = [...Array(grid.count).keys()];
const cellMix = cells.map((i) => {
  const k = grid.cells.site[i];
  const st = k !== null && k !== undefined ? grid.siteTypes[k]! : null;
  return currentTreeMix(naturalTrees(st?.code, st?.name), grid.cells.conifer[i] ?? null);
});
const spotMix = Object.fromEntries(
  Object.entries(spots).map(([id, s]) => [
    id,
    currentTreeMix(naturalTrees(s.site_type_code, s.site_type_name), s.conifer_pct),
  ]),
);
const meanMix = Object.fromEntries(
  TREES.map((t) => [t, cells.reduce((a, i) => a + (cellMix[i]![t] ?? 0), 0) / cells.length]),
);

const anyRecordCells = new Set(occ.strict.filter((o) => o.cell !== null).map((o) => o.cell!));
const sfSquares = new Map<string, number[]>();
for (const o of occ.sf5km) {
  const key = `${o.E}_${o.N}`;
  if (!sfSquares.has(key))
    sfSquares.set(
      key,
      cells.filter(
        (i) =>
          Math.abs(grid.cells.e[i]! * 1000 + 500 - o.E) <= 2500 &&
          Math.abs(grid.cells.n[i]! * 1000 + 500 - o.N) <= 2500,
      ),
    );
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
const pct = (xs: number[], p: number) =>
  [...xs].sort((a, b) => a - b)[Math.floor(p * (xs.length - 1))]!;

const results: Record<string, unknown> = {};
const maps: Record<string, number[]> = {};
for (const s of species) {
  const aff = affinity(s.id);
  const Hold = cells.map((i) => habitatScore(cellHabitat(grid, i), s, 1, DEFAULT_CONFIG).H);
  const hostNew = cells.map((i) => hostFromMix(cellMix[i]!, aff.a));
  const Hnew = cells.map((i) => habitatWith(cellHabitat(grid, i), s, hostNew[i]!));
  // Check: replacing the host part with the current one gives the engine's H.
  for (const i of cells.slice(0, 50)) {
    const h = cellHabitat(grid, i);
    const r = habitatScore(h, s, 1, DEFAULT_CONFIG);
    if (
      Math.abs(habitatWith(h, s, r.hostScore ?? DEFAULT_CONFIG.habitat.unknownHost) - r.H) > 1e-9 &&
      !(h.aspect !== undefined && (h.slope ?? 0) >= DEFAULT_CONFIG.habitat.northMinSlope)
    )
      throw new Error(`H replica differs for ${s.id} cell ${i}`);
  }
  maps[s.id] = Hnew.map((x) => Math.round(x * 1000) / 1000);
  const caseCells = [
    ...new Set(occ.strict.filter((o) => o.species === s.id && o.cell !== null).map((o) => o.cell!)),
  ];
  const test = (H: number[]) => {
    const caseH = caseCells.map((i) => H[i]!);
    const sqMean = (idx: number[]) =>
      idx.length ? idx.reduce((a, i) => a + H[i]!, 0) / idx.length : null;
    const sfCase = [
      ...new Set(occ.sf5km.filter((o) => o.species === s.id).map((o) => `${o.E}_${o.N}`)),
    ]
      .map((k) => sqMean(sfSquares.get(k)!))
      .filter((x): x is number => x !== null);
    const sfAll = [...sfSquares.values()].map(sqMean).filter((x): x is number => x !== null);
    return {
      aucAll: caseH.length ? auc(caseH, H) : null,
      aucAllCi: caseH.length >= 3 ? bootstrapAuc(caseH, H) : null,
      aucTargetGroup: caseH.length
        ? auc(
            caseH,
            [...anyRecordCells].map((i) => H[i]!),
          )
        : null,
      sf5km: sfCase.length ? auc(sfCase, sfAll) : null,
      sfSquares: sfCase.length,
      spread: {
        p10: pct(H, 0.1),
        p50: pct(H, 0.5),
        p90: pct(H, 0.9),
        above07: H.filter((x) => x >= 0.7).length / H.length,
      },
    };
  };
  const hostOld = cells.map(
    (i) =>
      habitatScore(cellHabitat(grid, i), s, 1, DEFAULT_CONFIG).hostScore ??
      DEFAULT_CONFIG.habitat.unknownHost,
  );
  const hostAuc = (h: number[]) =>
    caseCells.length
      ? auc(
          caseCells.map((i) => h[i]!),
          h,
        )
      : null;
  const spotH = Object.fromEntries(
    Object.entries(spots).map(([id, sp]) => {
      const h: Habitat = {
        elevation: sp.elevation,
        forest_pct: sp.forest_pct,
        ph_class: sp.ph_class,
        ...(sp.conifer_pct !== null ? { conifer_pct: sp.conifer_pct } : {}),
      };
      const old = habitatScore(h, s, 1, DEFAULT_CONFIG);
      return [id, { old: old.H, new: habitatWith(h, s, hostFromMix(spotMix[id]!, aff.a)) }];
    }),
  );
  results[s.id] = {
    affinity: aff,
    nCells: caseCells.length,
    current: { ...test(Hold), hostAuc: hostAuc(hostOld) },
    hostTrees: { ...test(Hnew), hostAuc: hostAuc(hostNew) },
    spots: spotH,
  };
  const r = results[s.id] as {
    current: ReturnType<typeof test> & { hostAuc: number | null };
    hostTrees: ReturnType<typeof test> & { hostAuc: number | null };
  };
  const f = (x: number | null | undefined) => (x == null ? '  – ' : x.toFixed(2));
  console.log(
    `${s.id.padEnd(19)} ${aff.source.padEnd(10)} n=${String(caseCells.length).padStart(2)}  AUC all ${f(r.current.aucAll)} → ${f(r.hostTrees.aucAll)}  host part ${f(r.current.hostAuc)} → ${f(r.hostTrees.hostAuc)}  target-group ${f(r.current.aucTargetGroup)} → ${f(r.hostTrees.aucTargetGroup)}  SF 5 km ${f(r.current.sf5km)} → ${f(r.hostTrees.sf5km)}  H p10–p90 ${f(r.current.spread.p10)}–${f(r.current.spread.p90)} → ${f(r.hostTrees.spread.p10)}–${f(r.hostTrees.spread.p90)}`,
  );
  console.log(
    '   ',
    Object.entries(aff.a)
      .filter(([, v]) => v >= 0.5)
      .sort((a, b) => b[1] - a[1])
      .map(([t, v]) => `${t} ${v.toFixed(2)}`)
      .join(', '),
  );
}
writeFileSync(
  join(DIR, 'results', 'hosts.json'),
  JSON.stringify({
    nfiStems: NFI_STEMS,
    alpha: ALPHA,
    meanMix,
    results,
    habitat: { e: grid.cells.e, n: grid.cells.n, H: maps },
  }),
);
console.log(
  'Mean tree mix of the forest squares:',
  Object.entries(meanMix)
    .filter(([, v]) => v > 0.005)
    .map(([t, v]) => `${t} ${(100 * v).toFixed(0)} %`)
    .join(', '),
);
