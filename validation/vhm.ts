/**
 * Vegetation height model (NFI, BAFU; ch.bafu.landesforstinventar-vegetationshoehenmodell) as a habitat input
 * (test only, nothing in the app uses it). Per forest square, from the newest flight year that covers it
 * (each year ~1/6 of Switzerland is flown; 2025 → 2020), at the 8 m overview of the 1 m model:
 *   - tallShare:  share of tree pixels (≥ 3 m) that are ≥ 25 m tall (tall, older forest)
 *   - openEdge:   share of the square that is open (< 3 m) but within 16 m of trees (gaps, clearings, edges)
 *   - meanHeight: mean height of tree pixels
 * Then the Part A habitat test for each metric: record squares vs all forest squares (AUC), per species.
 *   npx tsx validation/vhm.ts   → validation/results/vhm.json (per-square values cached in validation/cache/vhm/)
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fromUrl, type GeoTIFFImage } from 'geotiff';
import { GridFileSchema, SpeciesFileSchema } from '@mf/scoring';

const DIR = import.meta.dirname;
const ROOT = join(DIR, '..');
const CACHE = join(DIR, 'cache', 'vhm');
mkdirSync(CACHE, { recursive: true });
const readJson = (p: string) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'));
const grid = GridFileSchema.parse(readJson('web/public/data/static/grid.json'));
const species = SpeciesFileSchema.parse(readJson('data/species.json')).species;
const occ = readJson('validation/data/occurrences.json') as {
  strict: { species: string; cell: number | null }[];
  sf5km: { species: string; E: number; N: number }[];
};

const YEARS = [2025, 2024, 2023, 2022, 2021, 2020];
const RES = 8; // m, overview level 3
const TREE_M = 3;
const TALL_M = 25;
const EDGE_PX = 2; // 16 m
const BLOCK_KM = 10;
const url = (y: number) =>
  `https://data.geo.admin.ch/ch.bafu.landesforstinventar-vegetationshoehenmodell/landesforstinventar-vegetationshoehenmodell_${y}/landesforstinventar-vegetationshoehenmodell_${y}_stereo_2056.tif`;

const images = new Map<number, { img: GeoTIFFImage; ox: number; oy: number }>();
for (const y of YEARS) {
  const tif = await fromUrl(url(y));
  const full = await tif.getImage(0);
  const [ox, oy] = full.getOrigin() as [number, number];
  let img: GeoTIFFImage | null = null;
  for (let k = 0; k < (await tif.getImageCount()); k++) {
    const im = await tif.getImage(k);
    if (Math.abs(full.getWidth() / im.getWidth() - RES) < 0.01) img = im;
  }
  if (!img) throw new Error(`No ${RES} m overview in ${y}`);
  images.set(y, { img, ox, oy });
}

interface CellVhm {
  year: number | null;
  coverage: number;
  tallShare: number | null;
  openEdge: number | null;
  meanHeight: number | null;
}
const cachePath = join(CACHE, `cells_${RES}m.json`);
const cellVhm: Record<number, CellVhm> = existsSync(cachePath)
  ? JSON.parse(readFileSync(cachePath, 'utf8'))
  : {};

const PX = 1000 / RES; // pixels per square side
const BPX = (BLOCK_KM * 1000) / RES;
const e0 = Math.min(...grid.cells.e);
const n0 = Math.min(...grid.cells.n);
const cells = [...Array(grid.count).keys()];
const todo = cells.filter((i) => !cellVhm[i]);
const blocks = new Map<string, number[]>();
for (const i of todo) {
  const be = e0 + Math.floor((grid.cells.e[i]! - e0) / BLOCK_KM) * BLOCK_KM;
  const bn = n0 + Math.floor((grid.cells.n[i]! - n0) / BLOCK_KM) * BLOCK_KM;
  const k = `${be}_${bn}`;
  blocks.set(k, [...(blocks.get(k) ?? []), i]);
}
let done = 0;
for (const [k, list] of blocks) {
  const [be, bn] = k.split('_').map(Number) as [number, number];
  // Newest valid value per pixel over the years.
  const height = new Float32Array(BPX * BPX).fill(NaN);
  const yearOf = new Int16Array(BPX * BPX);
  for (const y of YEARS) {
    const { img, ox, oy } = images.get(y)!;
    const x = Math.round((be * 1000 - ox) / RES);
    const yy = Math.round((oy - (bn + BLOCK_KM) * 1000) / RES);
    const r = (
      await img.readRasters({ window: [x, yy, x + BPX, yy + BPX] })
    )[0] as ArrayLike<number>;
    let missing = 0;
    for (let p = 0; p < height.length; p++) {
      if (!Number.isNaN(height[p]!)) continue;
      const v = r[p]!;
      if (v >= 0 && v < 80) {
        height[p] = v;
        yearOf[p] = y;
      } else missing++;
    }
    if (missing === 0) break;
  }
  for (const i of list) {
    const ci = (grid.cells.e[i]! - be) * PX;
    const cj = (bn + BLOCK_KM - 1 - grid.cells.n[i]!) * PX; // row 0 = north
    let valid = 0;
    let trees = 0;
    let tall = 0;
    let sumH = 0;
    let open = 0;
    let openEdge = 0;
    const years = new Map<number, number>();
    const at = (a: number, b: number) =>
      a < 0 || b < 0 || a >= BPX || b >= BPX ? NaN : height[b * BPX + a]!;
    for (let j = 0; j < PX; j++)
      for (let ii = 0; ii < PX; ii++) {
        const a = ci + ii;
        const b = cj + j;
        const h = at(a, b);
        if (Number.isNaN(h)) continue;
        valid++;
        years.set(yearOf[b * BPX + a]!, (years.get(yearOf[b * BPX + a]!) ?? 0) + 1);
        if (h >= TREE_M) {
          trees++;
          sumH += h;
          if (h >= TALL_M) tall++;
        } else {
          open++;
          let near = false;
          for (let dj = -EDGE_PX; dj <= EDGE_PX && !near; dj++)
            for (let di = -EDGE_PX; di <= EDGE_PX && !near; di++)
              if (at(a + di, b + dj) >= TREE_M) near = true;
          if (near) openEdge++;
        }
      }
    const year = [...years].sort((x, y) => y[1] - x[1])[0]?.[0] ?? null;
    cellVhm[i] = {
      year,
      coverage: valid / (PX * PX),
      tallShare: trees ? tall / trees : null,
      openEdge: valid ? openEdge / valid : null,
      meanHeight: trees ? sumH / trees : null,
    };
  }
  done += list.length;
  writeFileSync(cachePath, JSON.stringify(cellVhm));
  console.log(`block ${k}: ${list.length} squares (${done}/${todo.length})`);
}

// Habitat test (as Part A): AUC of record squares vs all forest squares; SwissFungi 5 km squares (mean).
function auc(a: number[], b: number[]) {
  let s = 0;
  for (const x of a) for (const y of b) s += x > y ? 1 : x === y ? 0.5 : 0;
  return s / (a.length * b.length);
}
const metrics = ['tallShare', 'openEdge', 'meanHeight'] as const;
const value = (i: number, m: (typeof metrics)[number]) => cellVhm[i]?.[m] ?? null;
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
const results: Record<string, unknown> = {};
for (const s of species) {
  const caseCells = [
    ...new Set(occ.strict.filter((o) => o.species === s.id && o.cell !== null).map((o) => o.cell!)),
  ];
  const row: Record<string, unknown> = { nCells: caseCells.length };
  for (const m of metrics) {
    const all = cells.map((i) => value(i, m)).filter((x): x is number => x !== null);
    const cs = caseCells.map((i) => value(i, m)).filter((x): x is number => x !== null);
    const sqMean = (idx: number[]) => {
      const v = idx.map((i) => value(i, m)).filter((x): x is number => x !== null);
      return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
    };
    const sfCase = [
      ...new Set(occ.sf5km.filter((o) => o.species === s.id).map((o) => `${o.E}_${o.N}`)),
    ]
      .map((k) => sqMean(sfSquares.get(k)!))
      .filter((x): x is number => x !== null);
    const sfAll = [...sfSquares.values()].map(sqMean).filter((x): x is number => x !== null);
    row[m] = {
      auc: cs.length ? auc(cs, all) : null,
      sf5km: sfCase.length ? auc(sfCase, sfAll) : null,
      sfN: sfCase.length,
      median: {
        cases: cs.length ? [...cs].sort((a, b) => a - b)[Math.floor(cs.length / 2)] : null,
        all: [...all].sort((a, b) => a - b)[Math.floor(all.length / 2)],
      },
    };
  }
  results[s.id] = row;
  const f = (x: unknown) => (typeof x === 'number' ? x.toFixed(2) : ' – ');
  const r = row as Record<string, { auc: number | null; sf5km: number | null }>;
  console.log(
    `${s.id.padEnd(19)} n=${String(caseCells.length).padStart(2)}  tall ${f(r.tallShare!.auc)} / SF ${f(r.tallShare!.sf5km)}   open-edge ${f(r.openEdge!.auc)} / SF ${f(r.openEdge!.sf5km)}   height ${f(r.meanHeight!.auc)} / SF ${f(r.meanHeight!.sf5km)}`,
  );
}
const years: Record<string, number> = {};
for (const v of Object.values(cellVhm)) years[String(v.year)] = (years[String(v.year)] ?? 0) + 1;
const cov = Object.values(cellVhm).map((v) => v.coverage);
writeFileSync(
  join(DIR, 'results', 'vhm.json'),
  JSON.stringify({
    res: RES,
    years,
    coverage: { min: Math.min(...cov), mean: cov.reduce((a, b) => a + b, 0) / cov.length },
    results,
    cells: cellVhm,
  }),
);
console.log('years used:', years, 'coverage min', Math.min(...cov).toFixed(2));
