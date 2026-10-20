/**
 * 1 km forest grid over ZH + SZ (SPEC §3.3, Milestone 4) → web/public/data/static/grid.json and the reserve
 * overlay web/public/data/static/reserves.geojson. Rarely re-run (manual workflow "Build habitat").
 *
 *   npm run grid
 */
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fromUrl } from 'geotiff';
import {
  GridFileSchema,
  RulesFileSchema,
  lv95ToWgs84,
  type GridFile,
  type PhClassT,
} from '@mf/scoring';
import { writeJsonValidated } from '../src/store.js';
import { CELL_M, WEATHER_BLOCK_KM, cellForest, cellTerrain, mode, simplify } from './cells.js';
import { majority, phFromLithology, phFromSiteType } from './ph.js';
import {
  FOREST_MIX_URL,
  federalMoorAreas,
  geology,
  getWithRetry,
  inArea,
  szProtectedAreas,
  szSiteType,
  zhProtectedAreas,
  zhSiteType,
  type Area,
} from './sources.js';
import { z } from 'zod';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const STATIC = join(ROOT, 'web/public/data/static');
const MIN_FOREST_PCT = 20;
/** Reserve overlay: simplify outlines to ~15 m and round coordinates to 4 decimals (~10 m), to keep the file small. */
const RESERVE_TOLERANCE_M = 15;
const KANTON_URL = (id: number) =>
  `https://api3.geo.admin.ch/rest/services/api/MapServer/ch.swisstopo.swissboundaries3d-kanton-flaeche.fill/${id}?geometryFormat=geojson&sr=2056`;
const CANTON_IDS = { ZH: 1, SZ: 5 } as const;
const ALTI_STAC =
  'https://data.geo.admin.ch/api/stac/v1/collections/ch.swisstopo.swissalti3d/items';
/** Sub-squares (of the 3×3) used for site type and protection: centre and the four corners. */
const SAMPLE_SLOTS = [4, 0, 2, 6, 8];

const log = (m: string) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);

/** Run `fn` over items with at most `n` at a time. */
async function pool<T, R>(
  items: T[],
  n: number,
  fn: (t: T, i: number) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]!, i);
      }
    }),
  );
  return out;
}

async function cantonAreas(): Promise<{ canton: 'ZH' | 'SZ'; area: Area }[]> {
  const out: { canton: 'ZH' | 'SZ'; area: Area }[] = [];
  for (const [canton, id] of Object.entries(CANTON_IDS) as ['ZH' | 'SZ', number][]) {
    const f = (
      (await (await getWithRetry(KANTON_URL(id))).json()) as {
        feature: { geometry: { type: string; coordinates: unknown } };
      }
    ).feature;
    const polys = (
      f.geometry.type === 'MultiPolygon' ? f.geometry.coordinates : [f.geometry.coordinates]
    ) as [number, number][][][];
    out.push({ canton, area: { name: canton, rings: polys.flat() } });
  }
  return out;
}

interface Cell {
  e: number;
  n: number;
  canton: 'ZH' | 'SZ';
  forest: number;
  conifer: number | null;
  /** Sample tree points (LV95). */
  samples: { E: number; N: number }[];
  /** 10 m tree mask, 100×100, for the elevation average. */
  tree: boolean[];
}

async function main(): Promise<void> {
  const started = Date.now();
  const rules = RulesFileSchema.parse(
    JSON.parse(await readFile(join(ROOT, 'data/rules.json'), 'utf8')),
  );

  // 1. Cantons and candidate cells (cell centre inside ZH or SZ).
  const cantons = await cantonAreas();
  const xs = cantons.flatMap((c) => c.area.rings.flat().map((p) => p[0]));
  const ys = cantons.flatMap((c) => c.area.rings.flat().map((p) => p[1]));
  const [e0, e1] = [Math.floor(Math.min(...xs) / CELL_M), Math.ceil(Math.max(...xs) / CELL_M)];
  const [n0, n1] = [Math.floor(Math.min(...ys) / CELL_M), Math.ceil(Math.max(...ys) / CELL_M)];
  const candidates: { e: number; n: number; canton: 'ZH' | 'SZ' }[] = [];
  for (let e = e0; e < e1; e++)
    for (let n = n0; n < n1; n++) {
      const c = cantons.find((k) => inArea(k.area, e * CELL_M + 500, n * CELL_M + 500));
      if (c) candidates.push({ e, n, canton: c.canton });
    }
  log(
    `${candidates.length} cells with their centre in ZH or SZ (box ${e0}–${e1} / ${n0}–${n1} km)`,
  );

  // 2. Forest share and conifer share from the NFI forest mix raster, read in 10 km blocks.
  const img = await (await fromUrl(FOREST_MIX_URL)).getImage();
  const [ox, oy] = img.getOrigin() as [number, number];
  const cells: Cell[] = [];
  for (let be = e0; be < e1; be += 10)
    for (let bn = n0; bn < n1; bn += 10) {
      const inBlock = candidates.filter(
        (c) => c.e >= be && c.e < be + 10 && c.n >= bn && c.n < bn + 10,
      );
      if (!inBlock.length) continue;
      const x = Math.round((be * CELL_M - ox) / 10);
      const y = Math.round((oy - (bn + 10) * CELL_M) / 10);
      const raw = (
        await img.readRasters({ window: [x, y, x + 1000, y + 1000] })
      )[0] as ArrayLike<number>;
      for (const c of inBlock) {
        const ci = (c.e - be) * 100;
        const cj = (bn + 10 - 1 - c.n) * 100; // row 0 of the block is its north edge
        const px: (number | null)[] = [];
        for (let j = 0; j < 100; j++)
          for (let i = 0; i < 100; i++) {
            const v = raw[(cj + j) * 1000 + ci + i]!;
            px.push(v < 0 || v > 100 ? null : v);
          }
        const f = cellForest(px);
        if (f.forest_pct < MIN_FOREST_PCT) continue;
        cells.push({
          ...c,
          forest: Math.round(f.forest_pct),
          conifer: f.conifer_pct === null ? null : Math.round(f.conifer_pct),
          samples: f.samples.map(([i, j]) => ({
            E: c.e * CELL_M + i * 10 + 5,
            N: (c.n + 1) * CELL_M - j * 10 - 5,
          })),
          tree: px.map((v) => v !== null),
        });
      }
    }
  cells.sort((a, b) => b.n - a.n || a.e - b.e); // north to south, west to east
  log(
    `${cells.length} cells with ≥ ${MIN_FOREST_PCT} % tree cover (ZH ${cells.filter((c) => c.canton === 'ZH').length}, SZ ${cells.filter((c) => c.canton === 'SZ').length})`,
  );

  // 3. Elevation, slope, aspect of the forested part, from swissALTI3D (one 1 km tile per cell, read at 20 m).
  const tiles = new Map<string, { year: number; href: string }>();
  const sw = lv95ToWgs84(e0 * CELL_M, n0 * CELL_M);
  const ne = lv95ToWgs84(e1 * CELL_M, n1 * CELL_M);
  let url: string | null = `${ALTI_STAC}?bbox=${sw.lon},${sw.lat},${ne.lon},${ne.lat}&limit=100`;
  while (url) {
    const page = (await (await getWithRetry(url)).json()) as {
      features: { id: string; assets: Record<string, { href: string }> }[];
      links: { rel: string; href: string }[];
    };
    for (const f of page.features) {
      const m = /swissalti3d_(\d{4})_(\d{4}-\d{4})/.exec(f.id);
      const a = Object.entries(f.assets).find(([k]) => k.endsWith('_2_2056_5728.tif'));
      if (!m || !a) continue;
      const prev = tiles.get(m[2]!);
      if (!prev || Number(m[1]) > prev.year)
        tiles.set(m[2]!, { year: Number(m[1]), href: a[1].href });
    }
    url = page.links.find((l) => l.rel === 'next')?.href ?? null;
  }
  log(`${tiles.size} swissALTI3D tiles listed`);
  const terrain = await pool(cells, 8, async (c) => {
    const t = tiles.get(`${c.e}-${c.n}`);
    if (!t) return null;
    const tiff = await fromUrl(t.href);
    const data = (
      await tiff.readRasters({
        bbox: [c.e * CELL_M, c.n * CELL_M, (c.e + 1) * CELL_M, (c.n + 1) * CELL_M],
        width: 50,
        height: 50,
      })
    )[0] as ArrayLike<number>;
    const elev = Array.from(data, (v) => (v < -1000 ? NaN : v));
    // 20 m tree mask: any tree in the 2×2 block of 10 m pixels, and an elevation value.
    const tree20 = Array.from({ length: 2500 }, (_, k) => {
      const i = (k % 50) * 2;
      const j = Math.floor(k / 50) * 2;
      const anyTree =
        c.tree[j * 100 + i]! ||
        c.tree[j * 100 + i + 1]! ||
        c.tree[(j + 1) * 100 + i]! ||
        c.tree[(j + 1) * 100 + i + 1]!;
      return anyTree && Number.isFinite(elev[k]!);
    });
    return cellTerrain(elev, tree20, 50, 20);
  });
  log(`terrain done (${terrain.filter((t) => t).length}/${cells.length} cells)`);

  // 4. Protected areas: SZ reserves, ZH protection zones, federal moors (also the map overlay).
  const box = (a: number, b: number, c: number, d: number): [number, number, number, number] => [
    a,
    b,
    c,
    d,
  ];
  const full = box(e0 * CELL_M, n0 * CELL_M, e1 * CELL_M, n1 * CELL_M);
  const sz = await szProtectedAreas(full, rules.cantons.SZ?.noPickingAreas ?? []);
  log(`SZ reserves: ${sz.length}`);
  const zh = await zhProtectedAreas(full);
  log(`ZH protection zones: ${zh.length}`);
  const moors = new Map<string, Area & { id: string }>();
  const moorBoxes: [number, number, number, number][] = [];
  for (let be = e0; be < e1; be += 5)
    for (let bn = n0; bn < n1; bn += 5)
      moorBoxes.push(box(be * CELL_M, bn * CELL_M, (be + 5) * CELL_M, (bn + 5) * CELL_M));
  for (const list of await pool(moorBoxes, 3, (b) => federalMoorAreas(b)))
    for (const m of list) moors.set(m.id, m);
  const areas: (Area & { noPicking: boolean; source: string })[] = [
    ...sz.map((a) => ({ ...a, source: 'Kanton Schwyz' })),
    ...zh.map((a) => ({ ...a, source: 'Kanton Zürich' })),
    ...[...moors.values()].map((a) => ({ ...a, noPicking: false, source: 'BAFU' })),
  ];
  log(`protected areas: SZ ${sz.length}, ZH ${zh.length}, federal moors ${moors.size}`);

  // 5. Site types (SZ Waldstandorte / ZH Waldvegetationskarte) at the sample points → pH; geology as fallback.
  let siteCalls = 0;
  let geoCalls = 0;
  const sites = await pool(cells, 6, async (c) => {
    const pts = SAMPLE_SLOTS.map((s) => c.samples[s] ?? null).filter(
      (p): p is { E: number; N: number } => !!p,
    );
    if (!pts.length) pts.push(...c.samples.slice(0, 3));
    const found: ({ code: string; name: string } | null)[] = [];
    for (const p of pts) {
      siteCalls++;
      found.push(
        await (c.canton === 'SZ' ? szSiteType(p.E, p.N) : zhSiteType(p.E, p.N)).catch(() => null),
      );
    }
    const sitePh = majority(
      found.map((f) => (f ? (phFromSiteType(f.code, f.name) ?? 'unknown') : 'unknown')),
    );
    const unit = mode(found.map((f) => (f ? `${f.code}\t${f.name}` : null)));
    let ph: PhClassT = sitePh;
    let src: 'site_type' | 'geology' | 'none' = sitePh !== 'unknown' ? 'site_type' : 'none';
    if (ph === 'unknown') {
      const g = [];
      for (const p of pts.slice(0, 3)) {
        geoCalls++;
        g.push(await geology(p.E, p.N).catch(() => ({ litho: null, description: null })));
      }
      ph = majority(g.map((x) => phFromLithology(x.litho, x.description)));
      if (ph !== 'unknown') src = 'geology';
    }
    // Protection: the strictest area that contains any sample point.
    let prot = 0;
    let protName: string | null = null;
    for (const p of c.samples) {
      const a = areas.find((x) => inArea(x, p.E, p.N));
      if (!a) continue;
      const level = a.noPicking ? 2 : 1;
      if (level > prot) [prot, protName] = [level, a.name];
    }
    return { unit, ph, src, prot, protName };
  });
  log(`site types done (${siteCalls} site queries, ${geoCalls} geology queries)`);

  // 6. Weather points: one per 3×3 km block, at the mean elevation of its cells.
  const blockKey = (c: Cell) =>
    `${Math.floor(c.e / WEATHER_BLOCK_KM)}_${Math.floor(c.n / WEATHER_BLOCK_KM)}`;
  const blocks = new Map<string, number[]>();
  cells.forEach((c, i) => blocks.set(blockKey(c), [...(blocks.get(blockKey(c)) ?? []), i]));
  const wp = { lat: [] as number[], lon: [] as number[], elevation: [] as number[] };
  const cellWeather = new Array<number>(cells.length);
  for (const [key, idx] of blocks) {
    const [bx, by] = key.split('_').map(Number) as [number, number];
    const { lat, lon } = lv95ToWgs84(
      (bx * WEATHER_BLOCK_KM + WEATHER_BLOCK_KM / 2) * CELL_M,
      (by * WEATHER_BLOCK_KM + WEATHER_BLOCK_KM / 2) * CELL_M,
    );
    const elevs = idx.map((i) => terrain[i]?.elevation).filter((v): v is number => v !== undefined);
    for (const i of idx) cellWeather[i] = wp.lat.length;
    wp.lat.push(Math.round(lat * 1e5) / 1e5);
    wp.lon.push(Math.round(lon * 1e5) / 1e5);
    wp.elevation.push(Math.round(elevs.reduce((a, b) => a + b, 0) / Math.max(1, elevs.length)));
  }
  log(`${wp.lat.length} weather points (${WEATHER_BLOCK_KM} km blocks)`);

  // 7. Write grid.json.
  const siteTypes: { code: string; name: string }[] = [];
  const siteIndex = new Map<string, number>();
  const names: string[] = [];
  const nameIndex = new Map<string, number>();
  const idx = <T>(m: Map<string, number>, list: T[], key: string, value: T) => {
    if (!m.has(key)) m.set(key, list.push(value) - 1);
    return m.get(key)!;
  };
  const grid: GridFile = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    cellSize: 1000,
    count: cells.length,
    cells: {
      e: cells.map((c) => c.e),
      n: cells.map((c) => c.n),
      canton: cells.map((c) => c.canton),
      forest: cells.map((c) => c.forest),
      conifer: cells.map((c) => c.conifer),
      elevation: cells.map((c, i) => Math.round(terrain[i]?.elevation ?? NaN)),
      slope: terrain.map((t) => Math.round((t?.slope ?? 0) * 10) / 10),
      aspect: terrain.map((t) =>
        t?.aspect === null || t?.aspect === undefined ? null : Math.round(t.aspect),
      ),
      ph: sites.map((s) => s.ph),
      phSource: sites.map((s) => s.src),
      site: sites.map((s) => {
        if (!s.unit) return null;
        const [code, name] = s.unit.split('\t') as [string, string];
        return idx(siteIndex, siteTypes, s.unit, { code, name });
      }),
      protected: sites.map((s) => s.prot),
      protectedName: sites.map((s) =>
        s.protName ? idx(nameIndex, names, s.protName, s.protName) : null,
      ),
      weather: cellWeather,
    },
    siteTypes,
    protectedNames: names,
    weatherPoints: wp,
  };
  // Cells without elevation (no DEM tile) can't be scored: drop them, keeping the order.
  const keep = grid.cells.elevation.map((v) => Number.isFinite(v));
  if (keep.some((k) => !k)) {
    log(`dropping ${keep.filter((k) => !k).length} cells without elevation`);
    for (const k of Object.keys(grid.cells) as (keyof GridFile['cells'])[])
      (grid.cells[k] as unknown[]) = (grid.cells[k] as unknown[]).filter((_, i) => keep[i]);
    grid.count = grid.cells.e.length;
  }
  await writeJsonValidated(join(STATIC, 'grid.json'), GridFileSchema, grid);

  // 8. Reserve overlay (WGS84 GeoJSON, simplified).
  const toLonLat = (ring: [number, number][]) =>
    simplify(ring, RESERVE_TOLERANCE_M).map(([E, N]) => {
      const p = lv95ToWgs84(E, N);
      return [Math.round(p.lon * 1e4) / 1e4, Math.round(p.lat * 1e4) / 1e4];
    });
  const overlay = {
    type: 'FeatureCollection' as const,
    features: areas.map((a) => ({
      type: 'Feature',
      properties: { name: a.name, noPicking: a.noPicking, source: a.source },
      // All rings in one polygon; Leaflet fills them even-odd, which matches inArea() (holes stay empty).
      geometry: { type: 'Polygon', coordinates: a.rings.map(toLonLat) },
    })),
  };
  await writeJsonValidated(
    join(STATIC, 'reserves.geojson'),
    z.object({ type: z.literal('FeatureCollection'), features: z.array(z.unknown()).min(1) }),
    overlay,
  );

  const pct = (k: number) => `${Math.round((100 * k) / cells.length)} %`;
  log(
    `Wrote grid.json (${grid.count} cells) and reserves.geojson (${areas.length} areas). pH from site type ${pct(sites.filter((s) => s.src === 'site_type').length)}, geology ${pct(sites.filter((s) => s.src === 'geology').length)}; protected ${pct(sites.filter((s) => s.prot > 0).length)} (no picking ${pct(sites.filter((s) => s.prot === 2).length)}). ${((Date.now() - started) / 60000).toFixed(1)} min`,
  );
}

await main();
