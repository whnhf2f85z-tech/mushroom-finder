/**
 * Part D, habitat check: 30 random forest squares (15 ZH, 15 SZ, fixed seed) against the official layers.
 *   - Tree cover: share of the 100 Arealstatistik points (BFS, 100 m grid, survey 2013/18) in forest or woods,
 *     vs the app's tree cover (NFI forest mix raster, tree pixels).
 *   - Conifer share: the NFI forest mix raster re-read independently (raw values, legend: broadleaf share), vs the
 *     app's value; plus a plausibility check against the natural trees of the square's site type.
 *   - pH class: the cantonal site type map (SZ Waldstandorte / ZH Waldvegetationskarte) at 9 points and the
 *     geological map (GeoCover) at the same points, vs the app's class (site types at 5 points).
 *   - A map of each square from the official WMS (NFI forest mix over the swisstopo map) for a visual check.
 *   npx tsx validation/squares.ts   → validation/results/squares.json, validation/cache/squares/*.png
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fromUrl } from 'geotiff';
import { GridFileSchema, type PhClassT } from '@mf/scoring';
import { naturalTrees, CONIFERS } from '@mf/scoring';
import { majority, phFromLithology, phFromSiteType } from '../pipeline/terrain/ph.js';
import { FOREST_MIX_URL, geology, szSiteType, zhSiteType } from '../pipeline/terrain/sources.js';

const DIR = import.meta.dirname;
const ROOT = join(DIR, '..');
const CACHE = join(DIR, 'cache', 'squares');
mkdirSync(CACHE, { recursive: true });
const grid = GridFileSchema.parse(
  JSON.parse(readFileSync(join(ROOT, 'web/public/data/static/grid.json'), 'utf8')),
);

// Fixed sample: 15 squares per canton.
let seed = 2026;
const rnd = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
const pick = (canton: string) => {
  const idx = grid.cells.canton.map((c, i) => (c === canton ? i : -1)).filter((i) => i >= 0);
  for (let i = idx.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [idx[i], idx[j]] = [idx[j]!, idx[i]!];
  }
  return idx.slice(0, 15);
};
const sample = [...pick('ZH'), ...pick('SZ')];

const cached = async <T>(name: string, f: () => Promise<T>): Promise<T> => {
  const p = join(CACHE, name);
  if (existsSync(p)) return JSON.parse(readFileSync(p, 'utf8')) as T;
  const v = await f();
  writeFileSync(p, JSON.stringify(v));
  return v;
};

// Arealstatistik 2013/18 (as_72 classes): forest classes and other tree stands.
const FOREST = /wald|aufforstung|holzschlag/i;
const WOODS = /gehölz|hecke|baumgruppe|gebüsch/i;
async function landCover(E0: number, N0: number) {
  const q = new URLSearchParams({
    geometryType: 'esriGeometryEnvelope',
    geometry: `${E0},${N0},${E0 + 1000},${N0 + 1000}`,
    imageDisplay: '500,500,96',
    mapExtent: `${E0},${N0},${E0 + 1000},${N0 + 1000}`,
    tolerance: '0',
    layers: 'all:ch.bfs.arealstatistik',
    sr: '2056',
    returnGeometry: 'true',
    geometryFormat: 'geojson',
    limit: '200',
    timeInstant: '2018',
  });
  const r = (await (
    await fetch(`https://api3.geo.admin.ch/rest/services/api/MapServer/identify?${q}`)
  ).json()) as {
    results: {
      geometry: { coordinates: [number, number] };
      properties?: { desc_as_72_de: string };
      attributes?: { desc_as_72_de: string };
    }[];
  };
  // Points on the square's west/south edges belong to it (100 points per km²).
  return r.results
    .filter((x) => {
      const [e, n] = x.geometry.coordinates;
      return e >= E0 && e < E0 + 1000 && n >= N0 && n < N0 + 1000;
    })
    .map((x) => (x.properties ?? x.attributes)!.desc_as_72_de);
}

const img = await (await fromUrl(FOREST_MIX_URL)).getImage();
const [ox, oy] = img.getOrigin() as [number, number];
async function forestMix(E0: number, N0: number) {
  const x = Math.round((E0 - ox) / 10);
  const y = Math.round((oy - (N0 + 1000)) / 10);
  const raw = (await img.readRasters({ window: [x, y, x + 100, y + 100] }))[0] as ArrayLike<number>;
  let trees = 0;
  let broadleaf = 0;
  for (let k = 0; k < raw.length; k++) {
    const v = raw[k]!;
    if (v < 0 || v > 100) continue; // nodata = no trees
    trees++;
    broadleaf += v;
  }
  return { treePct: trees / 100, coniferPct: trees ? 100 - broadleaf / trees : null };
}

async function wmsImage(E0: number, N0: number, path: string) {
  if (existsSync(path)) return;
  const q = new URLSearchParams({
    SERVICE: 'WMS',
    VERSION: '1.3.0',
    REQUEST: 'GetMap',
    LAYERS: 'ch.swisstopo.pixelkarte-grau,ch.bafu.landesforstinventar-waldmischungsgrad',
    STYLES: ',',
    CRS: 'EPSG:2056',
    BBOX: `${E0},${N0},${E0 + 1000},${N0 + 1000}`,
    WIDTH: '300',
    HEIGHT: '300',
    FORMAT: 'image/png',
  });
  const res = await fetch(`https://wms.geo.admin.ch/?${q}`);
  if (!res.ok) throw new Error(`WMS ${res.status}`);
  writeFileSync(path, Buffer.from(await res.arrayBuffer()));
}

const out = [];
for (const i of sample) {
  const E0 = grid.cells.e[i]! * 1000;
  const N0 = grid.cells.n[i]! * 1000;
  const canton = grid.cells.canton[i]!;
  const id = `${grid.cells.e[i]}_${grid.cells.n[i]}`;
  const lc = await cached(`lc_${id}.json`, () => landCover(E0, N0));
  const mix = await cached(`mix_${id}.json`, () => forestMix(E0, N0));
  // 9 points: centres of the 3 × 3 sub-squares.
  const pts = [0, 1, 2].flatMap((a) =>
    [0, 1, 2].map((b) => ({ E: E0 + 167 + a * 333, N: N0 + 167 + b * 333 })),
  );
  const sites = await cached(`site_${id}.json`, async () => {
    const r = [];
    for (const p of pts)
      r.push(
        await (canton === 'SZ' ? szSiteType(p.E, p.N) : zhSiteType(p.E, p.N)).catch(() => null),
      );
    return r;
  });
  const geo = await cached(`geo_${id}.json`, async () => {
    const r = [];
    for (const p of pts)
      r.push(await geology(p.E, p.N).catch(() => ({ litho: null, description: null })));
    return r;
  });
  await wmsImage(E0, N0, join(CACHE, `wms_${id}.png`));
  const sitePh: PhClassT = majority(
    sites.map((s) => (s ? (phFromSiteType(s.code, s.name) ?? 'unknown') : 'unknown')),
  );
  const geoPh: PhClassT = majority(geo.map((g) => phFromLithology(g.litho, g.description)));
  const siteIdx = grid.cells.site[i];
  const st = siteIdx !== null && siteIdx !== undefined ? grid.siteTypes[siteIdx]! : null;
  const nat = naturalTrees(st?.code, st?.name);
  const natConifer = nat ? Math.round(100 * CONIFERS.reduce((a, t) => a + (nat[t] ?? 0), 0)) : null;
  const row = {
    id,
    canton,
    elevation: grid.cells.elevation[i],
    app: {
      forest: grid.cells.forest[i],
      conifer: grid.cells.conifer[i],
      ph: grid.cells.ph[i],
      phSource: grid.cells.phSource[i],
      site: st ? `${st.code} ${st.name}` : null,
    },
    arealstatistik: {
      points: lc.length,
      forestPct: lc.filter((d) => FOREST.test(d)).length,
      woodsPct: lc.filter((d) => FOREST.test(d) || WOODS.test(d)).length,
      classes: Object.entries(
        lc.reduce<Record<string, number>>((a, d) => ((a[d] = (a[d] ?? 0) + 1), a), {}),
      ).sort((a, b) => b[1] - a[1]),
    },
    forestMixReRead: {
      treePct: Math.round(mix.treePct),
      coniferPct: mix.coniferPct === null ? null : Math.round(mix.coniferPct),
    },
    naturalConiferPct: natConifer,
    ph: { siteType9: sitePh, geology9: geoPh, sitesFound: sites.filter(Boolean).length },
  };
  out.push(row);
  console.log(
    `${id} ${canton} ${String(row.elevation).padStart(4)} m | cover app ${row.app.forest} %, re-read ${row.forestMixReRead.treePct} %, Arealstatistik forest ${row.arealstatistik.forestPct} / woods ${row.arealstatistik.woodsPct} | conifer app ${row.app.conifer}, re-read ${row.forestMixReRead.coniferPct}, natural ${natConifer ?? '–'} | pH app ${row.app.ph} (${row.app.phSource}), site 9 pts ${sitePh}, geology ${geoPh}`,
  );
}
writeFileSync(join(DIR, 'results', 'squares.json'), JSON.stringify({ squares: out }, null, 1));
