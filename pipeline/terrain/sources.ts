import { fromUrl, type GeoTIFF } from 'geotiff';
import { lv95ToWgs84 } from './lv95.js';
import type { Grid } from './grid.js';

/** Verified sources: see docs/DATA_SOURCES.md (Milestone 3). */
export const FOREST_MIX_URL =
  'https://data.geo.admin.ch/ch.bafu.landesforstinventar-waldmischungsgrad/landesforstinventar-waldmischungsgrad/landesforstinventar-waldmischungsgrad_2056.tif';
const ALTI_STAC =
  'https://data.geo.admin.ch/api/stac/v1/collections/ch.swisstopo.swissalti3d/items';
const IDENTIFY = 'https://api3.geo.admin.ch/rest/services/api/MapServer/identify';
const SZ_WFS = 'https://map.geo.sz.ch/mapserv_proxy';
const ZH_WALDVK = 'https://wms.zh.ch/WaldVKWMS';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** GET with retries and backoff; geo services occasionally time out. */
export async function getWithRetry(url: string, attempts = 4): Promise<Response> {
  let last = '';
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
      if (res.ok) return res;
      last = `HTTP ${res.status}`;
      if (res.status >= 400 && res.status < 500 && res.status !== 429) break;
    } catch (e) {
      last = (e as Error).message;
    }
    await sleep(1_500 * 2 ** i);
  }
  throw new Error(`${url.slice(0, 120)} failed: ${last}`);
}

let forestMix: Promise<GeoTIFF> | null = null;

/**
 * Load forest mix and elevation on one 10 m grid of `size` cells centred on (E, N), aligned to the forest raster.
 * The forest raster stores the broadleaf share (0–100) per 10 m cell, nodata (−128) where there are no trees.
 */
export async function loadGrid(E: number, N: number, halfWidth = 1200): Promise<Grid> {
  const res = 10;
  const E0 = Math.floor((E - halfWidth) / res) * res;
  const N0 = Math.ceil((N + halfWidth) / res) * res;
  const size = Math.round((2 * halfWidth) / res);

  forestMix ??= fromUrl(FOREST_MIX_URL);
  const img = await (await forestMix).getImage();
  const [ox, oy] = img.getOrigin() as [number, number];
  const x = Math.round((E0 - ox) / res);
  const y = Math.round((oy - N0) / res);
  const raw = (
    await img.readRasters({ window: [x, y, x + size, y + size] })
  )[0] as ArrayLike<number>;
  const broadleaf = Array.from(raw, (v) => (v < 0 || v > 100 ? null : v));

  const elev = await loadElevation(E0, N0, size, res);
  return { E0, N0, res, size, broadleaf, elev };
}

/** swissALTI3D (2 m, 1 km tiles), resampled to the grid. Uses the newest tile of each 1 km square. */
async function loadElevation(
  E0: number,
  N0: number,
  size: number,
  res: number,
): Promise<(number | null)[]> {
  const E1 = E0 + size * res;
  const N1 = N0 - size * res;
  const sw = lv95ToWgs84(E0, N1);
  const ne = lv95ToWgs84(E1, N0);
  const stac = (await (
    await getWithRetry(`${ALTI_STAC}?bbox=${sw.lon},${sw.lat},${ne.lon},${ne.lat}&limit=100`)
  ).json()) as {
    features: { id: string; assets: Record<string, { href: string }> }[];
  };
  const newest = new Map<string, { year: number; href: string }>();
  for (const f of stac.features) {
    const m = /swissalti3d_(\d{4})_(\d{4}-\d{4})/.exec(f.id);
    const asset = Object.entries(f.assets).find(([k]) => k.endsWith('_2_2056_5728.tif'));
    if (!m || !asset) continue;
    const prev = newest.get(m[2]!);
    if (!prev || Number(m[1]) > prev.year)
      newest.set(m[2]!, { year: Number(m[1]), href: asset[1].href });
  }

  const elev: (number | null)[] = new Array(size * size).fill(null);
  for (const [tile, { href }] of newest) {
    const [te, tn] = tile.split('-').map((v) => Number(v) * 1000) as [number, number];
    // Part of this tile inside the grid, in whole grid cells.
    const e0 = Math.max(E0, te);
    const e1 = Math.min(E1, te + 1000);
    const n0 = Math.min(N0, tn + 1000);
    const n1 = Math.max(N1, tn);
    if (e1 <= e0 || n0 <= n1) continue;
    const w = Math.round((e1 - e0) / res);
    const h = Math.round((n0 - n1) / res);
    const tiff = await fromUrl(href);
    const data = (
      await tiff.readRasters({
        bbox: [e0, n1, e1, n0],
        width: w,
        height: h,
        resampleMethod: 'bilinear',
      })
    )[0] as ArrayLike<number>;
    const i0 = Math.round((e0 - E0) / res);
    const j0 = Math.round((N0 - n0) / res);
    for (let j = 0; j < h; j++)
      for (let i = 0; i < w; i++) {
        const v = data[j * w + i]!;
        if (v > -1000) elev[(j0 + j) * size + (i0 + i)] = v;
      }
  }
  return elev;
}

interface IdentifyResult {
  layerBodId: string;
  attributes: Record<string, unknown>;
}

async function identify(E: number, N: number, layers: string[]): Promise<IdentifyResult[]> {
  const q = new URLSearchParams({
    geometryType: 'esriGeometryPoint',
    geometry: `${E},${N}`,
    sr: '2056',
    tolerance: '0',
    returnGeometry: 'false',
    lang: 'de',
    layers: `all:${layers.join(',')}`,
  });
  const json = (await (await getWithRetry(`${IDENTIFY}?${q}`)).json()) as {
    results?: IdentifyResult[];
  };
  return json.results ?? [];
}

/** GeoCover 1:25k lithology; falls back to Geology 500 where GeoCover has no polygon. */
export async function geology(
  E: number,
  N: number,
): Promise<{ litho: string | null; description: string | null }> {
  const r = await identify(E, N, ['ch.swisstopo.geologie-geocover']);
  const gc = r[0]?.attributes;
  if (gc)
    return {
      litho: (gc.litho_de as string) ?? null,
      description: (gc.description_de as string) ?? null,
    };
  const g5 = (await identify(E, N, ['ch.swisstopo.geologie-geologische_karte']))[0]?.attributes;
  return { litho: null, description: (g5?.leg_geol_d as string) ?? null };
}

/** Federal moor inventories (raised bogs, fens) at a point. */
export async function federalMoor(E: number, N: number): Promise<string | null> {
  const r = await identify(E, N, [
    'ch.bafu.bundesinventare-hochmoore',
    'ch.bafu.bundesinventare-flachmoore',
  ]);
  const a = r[0]?.attributes;
  return a ? String(a.name ?? a.objname ?? 'Federal moor inventory') : null;
}

/** Text values of <ms:field> elements in the first feature of a MapServer GML response. */
function gmlFields(xml: string): Record<string, string> | null {
  const first = xml.split('<gml:featureMember>')[1];
  if (!first) return null;
  return Object.fromEntries(
    [...first.matchAll(/<ms:([A-Za-z0-9_]+)>([^<]*)<\/ms:\1>/g)].map((m) => [m[1]!, m[2]!.trim()]),
  );
}

async function szFeature(
  layer: string,
  E: number,
  N: number,
): Promise<Record<string, string> | null> {
  const q = new URLSearchParams({
    SERVICE: 'WFS',
    VERSION: '1.1.0',
    REQUEST: 'GetFeature',
    TYPENAME: `ms:${layer}`,
    SRSNAME: 'EPSG:2056',
    BBOX: `${E - 1},${N - 1},${E + 1},${N + 1},EPSG:2056`,
    MAXFEATURES: '1',
  });
  return gmlFields(await (await getWithRetry(`${SZ_WFS}?${q}`)).text());
}

/** Schwyz forest site type (Waldstandorte), e.g. "17 Steilhang-Buchenwald mit Buntreitgras". */
export async function szSiteType(
  E: number,
  N: number,
): Promise<{ code: string; name: string } | null> {
  const f = await szFeature('ch.sz.a218a.waldoekologie.waldstandorte_kombiniert', E, N);
  const tx = f?.waldstandort_tx;
  if (!tx) return null;
  const m = /^(\S+)\s+(.*)$/.exec(tx);
  return m ? { code: m[1]!, name: m[2]! } : { code: tx, name: tx };
}

/** Schwyz nature reserves and plant protection reserves at a point. */
export async function szReserves(
  E: number,
  N: number,
): Promise<{ natureReserve: string | null; plantReserve: string | null }> {
  const nsg = await szFeature('ch.sz.anjf.anjf_kant_naturschutzgebiete', E, N);
  const pfl = await szFeature('ch.sz.anjf.anjf_kant_pflanzenschutzreservate', E, N);
  return { natureReserve: nsg?.nsg_name ?? null, plantReserve: pfl?.pfl_name ?? null };
}

/** Zürich forest vegetation map (Waldvegetationskarte, E+K 1972 units), e.g. "8e Waldhirsen-Buchenwald". */
export async function zhSiteType(
  E: number,
  N: number,
): Promise<{ code: string; name: string } | null> {
  const q = new URLSearchParams({
    SERVICE: 'WMS',
    VERSION: '1.3.0',
    REQUEST: 'GetFeatureInfo',
    LAYERS: 'waldgesellschaften',
    QUERY_LAYERS: 'waldgesellschaften',
    CRS: 'EPSG:2056',
    BBOX: `${E - 50},${N - 50},${E + 50},${N + 50}`,
    WIDTH: '101',
    HEIGHT: '101',
    I: '50',
    J: '50',
    INFO_FORMAT: 'text/plain',
    FEATURE_COUNT: '1',
  });
  const text = await (await getWithRetry(`${ZH_WALDVK}?${q}`)).text();
  const code = /ek72 = '([^']*)'/.exec(text)?.[1];
  const name = /vename = '([^']*)'/.exec(text)?.[1];
  return code ? { code, name: name ?? code } : null;
}

export interface Area {
  name: string;
  /** Rings of [E, N] points (outer and holes; even-odd rule). */
  rings: [number, number][][];
}

/** All features of a SZ WFS layer within a box, with their rings and one name field. */
async function szAreas(
  layer: string,
  nameField: string,
  box: [number, number, number, number],
): Promise<Area[]> {
  const q = new URLSearchParams({
    SERVICE: 'WFS',
    VERSION: '1.1.0',
    REQUEST: 'GetFeature',
    TYPENAME: `ms:${layer}`,
    SRSNAME: 'EPSG:2056',
    BBOX: `${box.join(',')},EPSG:2056`,
    MAXFEATURES: '500',
  });
  const xml = await (await getWithRetry(`${SZ_WFS}?${q}`)).text();
  return xml
    .split('<gml:featureMember>')
    .slice(1)
    .map((f) => ({
      name: new RegExp(`<ms:${nameField}>([^<]*)</ms:${nameField}>`).exec(f)?.[1]?.trim() ?? '',
      rings: [...f.matchAll(/<gml:posList[^>]*>([^<]*)<\/gml:posList>/g)].map((m) => {
        const v = m[1]!.trim().split(/\s+/).map(Number);
        const ring: [number, number][] = [];
        for (let k = 0; k + 1 < v.length; k += 2) ring.push([v[k]!, v[k + 1]!]);
        return ring;
      }),
    }));
}

/**
 * Areas where the Schwyz rules ban picking, within a box: every plant protection reserve, and the nature reserves
 * whose name matches the list in data/rules.json.
 */
export async function szNoPickingAreas(
  box: [number, number, number, number],
  listedNames: string[],
): Promise<Area[]> {
  const plant = await szAreas('ch.sz.anjf.anjf_kant_pflanzenschutzreservate', 'pfl_name', box);
  const nsg = await szAreas('ch.sz.anjf.anjf_kant_naturschutzgebiete', 'nsg_name', box);
  const listed = nsg.filter((a) =>
    listedNames.some((n) => a.name.toLowerCase().includes(n.toLowerCase())),
  );
  return [...plant, ...listed];
}

/** Even-odd point-in-polygon over all rings. */
export function inArea(a: Area, E: number, N: number): boolean {
  let inside = false;
  for (const ring of a.rings)
    for (let p = 0, q = ring.length - 1; p < ring.length; q = p++) {
      const [xi, yi] = ring[p]!;
      const [xj, yj] = ring[q]!;
      if (yi > N !== yj > N && E < ((xj - xi) * (N - yi)) / (yj - yi) + xi) inside = !inside;
    }
  return inside;
}
