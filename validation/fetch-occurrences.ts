/**
 * Part A, step 1: open occurrence records for the 9 species in ZH + SZ from GBIF (incl. SwissFungi, iNaturalist).
 *   npx tsx validation/fetch-occurrences.ts   → validation/data/occurrences.json (+ summary on stdout)
 * Raw API pages are cached in validation/cache/ (git-ignored).
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { GridFileSchema, wgs84ToLv95 } from '@mf/scoring';

const DIR = import.meta.dirname;
const ROOT = join(DIR, '..');
export const TAXA: Record<string, number> = {
  chanterelle: 5249504,
  porcini: 5954958,
  winter_chanterelle: 2554536,
  horn_of_plenty: 2554662,
  bay_bolete: 7832732,
  hedgehog: 2554716,
  honey_fungus: 2526021, // genus Armillaria
  parasol: 8914748,
  morel: 2594601, // genus Morchella
};
const BOX = 'POLYGON((8.35 46.93,9.0 46.93,9.0 47.70,8.35 47.70,8.35 46.93))';
/** Airborne DNA, not fruiting bodies. */
const EXCLUDED_DATASETS = new Set(['935c81fd-2a50-4c1c-b747-50369ffd20a3']);
const MAX_UNCERTAINTY_M = 1000;

interface Raw {
  key: number;
  datasetKey: string;
  datasetName?: string;
  license?: string;
  basisOfRecord?: string;
  occurrenceStatus?: string;
  decimalLatitude?: number;
  decimalLongitude?: number;
  coordinateUncertaintyInMeters?: number;
  coordinatePrecision?: number;
  year?: number;
  month?: number;
  day?: number;
  eventDate?: string;
  issues?: string[];
}

async function fetchAll(
  taxonKey: number,
  extra: Record<string, string> = { geometry: BOX },
  tag = '',
): Promise<Raw[]> {
  const cache = join(DIR, 'cache', `gbif-${taxonKey}${tag}.json`);
  if (existsSync(cache)) return JSON.parse(readFileSync(cache, 'utf8'));
  const out: Raw[] = [];
  for (let offset = 0; ; offset += 300) {
    const q = new URLSearchParams({
      taxonKey: String(taxonKey),
      hasCoordinate: 'true',
      limit: '300',
      offset: String(offset),
      ...extra,
    });
    const res = await fetch(`https://api.gbif.org/v1/occurrence/search?${q}`);
    if (!res.ok) throw new Error(`GBIF ${res.status}`);
    const page = (await res.json()) as { results: Raw[]; endOfRecords: boolean };
    out.push(...page.results);
    if (page.endOfRecords) break;
  }
  writeFileSync(cache, JSON.stringify(out));
  return out;
}

async function cantons() {
  const get = async (id: number) =>
    (
      (await (
        await fetch(
          `https://api3.geo.admin.ch/rest/services/api/MapServer/ch.swisstopo.swissboundaries3d-kanton-flaeche.fill/${id}?geometryFormat=geojson&sr=2056`,
        )
      ).json()) as { feature: { geometry: { type: string; coordinates: unknown } } }
    ).feature.geometry;
  const rings = (g: { type: string; coordinates: unknown }) =>
    (
      (g.type === 'MultiPolygon' ? g.coordinates : [g.coordinates]) as [number, number][][][]
    ).flat();
  return { ZH: rings(await get(1)), SZ: rings(await get(5)) };
}

const inRings = (rings: [number, number][][], E: number, N: number) => {
  let inside = false;
  for (const ring of rings)
    for (let p = 0, q = ring.length - 1; p < ring.length; q = p++) {
      const [xi, yi] = ring[p]!;
      const [xj, yj] = ring[q]!;
      if (yi > N !== yj > N && E < ((xj - xi) * (N - yi)) / (yj - yi) + xi) inside = !inside;
    }
  return inside;
};

export interface Occurrence {
  gbifKey: number;
  species: string;
  dataset: string;
  license: string;
  basis: string;
  date: string;
  lat: number;
  lon: number;
  E: number;
  N: number;
  uncertaintyM: number | null;
  canton: 'ZH' | 'SZ';
  /** Index of the 1 km forest grid cell containing the record, or null (not in a forest square). */
  cell: number | null;
  /** swissALTI3D elevation at the record (m). */
  elevation: number | null;
}

/** Terrain-model elevation (swissALTI3D via geo.admin), cached on disk. */
const elevCachePath = join(DIR, 'cache', 'elevation.json');
const elevCache: Record<string, number | null> = existsSync(elevCachePath)
  ? JSON.parse(readFileSync(elevCachePath, 'utf8'))
  : {};
async function elevations(points: { E: number; N: number }[]): Promise<(number | null)[]> {
  const key = (p: { E: number; N: number }) => `${Math.round(p.E)},${Math.round(p.N)}`;
  const todo = [...new Set(points.map(key).filter((k) => !(k in elevCache)))];
  for (let i = 0; i < todo.length; i += 8)
    await Promise.all(
      todo.slice(i, i + 8).map(async (k) => {
        const [E, N] = k.split(',');
        try {
          const r = await fetch(
            `https://api3.geo.admin.ch/rest/services/height?easting=${E}&northing=${N}&sr=2056`,
          );
          const h = Number(((await r.json()) as { height?: string }).height);
          elevCache[k] = Number.isFinite(h) ? Math.round(h) : null;
        } catch {
          elevCache[k] = null;
        }
      }),
    );
  writeFileSync(elevCachePath, JSON.stringify(elevCache));
  return points.map((p) => elevCache[key(p)] ?? null);
}

const grid = GridFileSchema.parse(
  JSON.parse(readFileSync(join(ROOT, 'web/public/data/static/grid.json'), 'utf8')),
);
const cellIndex = new Map(grid.cells.e.map((e, i) => [`${e}-${grid.cells.n[i]}`, i]));
const shapes = await cantons();
const all: Occurrence[] = [];
const summary: Record<string, Record<string, number>> = {};
const datasets: Record<string, { name: string; license: string; n: number }> = {};

for (const [species, key] of Object.entries(TAXA)) {
  const raw = await fetchAll(key);
  const s = (summary[species] = {
    raw: raw.length,
    notFruitingBody: 0,
    absentOrIssue: 0,
    outsideZhSz: 0,
    noDayDate: 0,
    uncertaintyOver1km: 0,
    uncertaintyUnknown: 0,
    duplicate: 0,
    kept: 0,
  });
  const seen = new Set<string>();
  for (const r of raw) {
    if (EXCLUDED_DATASETS.has(r.datasetKey) || r.basisOfRecord === 'MATERIAL_SAMPLE') {
      s.notFruitingBody++;
      continue;
    }
    const bad = [
      'ZERO_COORDINATE',
      'COORDINATE_INVALID',
      'COUNTRY_COORDINATE_MISMATCH',
      'RECORDED_DATE_INVALID',
    ];
    if (r.occurrenceStatus === 'ABSENT' || r.issues?.some((i) => bad.includes(i))) {
      s.absentOrIssue++;
      continue;
    }
    const { E, N } = wgs84ToLv95(r.decimalLatitude!, r.decimalLongitude!);
    const canton = inRings(shapes.ZH, E, N) ? 'ZH' : inRings(shapes.SZ, E, N) ? 'SZ' : null;
    if (!canton) {
      s.outsideZhSz++;
      continue;
    }
    // A single day is needed (not a range or only a year/month).
    const dateRange =
      r.eventDate?.includes('/') &&
      r.eventDate.split('/')[0]!.slice(0, 10) !== r.eventDate.split('/')[1]!.slice(0, 10);
    if (!r.year || !r.month || !r.day || dateRange) {
      s.noDayDate++;
      continue;
    }
    const u = r.coordinateUncertaintyInMeters ?? null;
    if (u !== null && u > MAX_UNCERTAINTY_M) {
      s.uncertaintyOver1km++;
      continue;
    }
    if (u === null) s.uncertaintyUnknown++;
    const date = `${r.year}-${String(r.month).padStart(2, '0')}-${String(r.day).padStart(2, '0')}`;
    // Same species, same day, within ~100 m: the same find published twice (e.g. iNaturalist and SwissFungi).
    const dupKey = `${date}|${Math.round(E / 100)}|${Math.round(N / 100)}`;
    if (seen.has(dupKey)) {
      s.duplicate++;
      continue;
    }
    seen.add(dupKey);
    const cell = cellIndex.get(`${Math.floor(E / 1000)}-${Math.floor(N / 1000)}`) ?? null;
    all.push({
      gbifKey: r.key,
      species,
      dataset: r.datasetKey,
      license: r.license ?? '',
      basis: r.basisOfRecord ?? '',
      date,
      lat: r.decimalLatitude!,
      lon: r.decimalLongitude!,
      E: Math.round(E),
      N: Math.round(N),
      uncertaintyM: u,
      canton,
      cell,
      elevation: null,
    });
    const d = (datasets[r.datasetKey] ??= {
      name: r.datasetName ?? r.datasetKey,
      license: r.license ?? '',
      n: 0,
    });
    d.n++;
    s.kept++;
  }
}

const elevStrict = await elevations(all);
all.forEach((o, i) => (o.elevation = elevStrict[i] ?? null));

// Supplement 1: precise records (known accuracy ≤ 1 km) from all of Switzerland, for the season and weather tests.
const ch: Occurrence[] = [];
for (const [species, key] of Object.entries(TAXA)) {
  const raw = await fetchAll(
    key,
    { country: 'CH', coordinateUncertaintyInMeters: '0,1000', occurrenceStatus: 'PRESENT' },
    '-ch',
  );
  const seen = new Set<string>();
  for (const r of raw) {
    if (
      EXCLUDED_DATASETS.has(r.datasetKey) ||
      r.basisOfRecord === 'MATERIAL_SAMPLE' ||
      !r.year ||
      !r.month ||
      !r.day
    )
      continue;
    if (
      r.eventDate?.includes('/') &&
      r.eventDate.split('/')[0]!.slice(0, 10) !== r.eventDate.split('/')[1]!.slice(0, 10)
    )
      continue;
    const { E, N } = wgs84ToLv95(r.decimalLatitude!, r.decimalLongitude!);
    const date = `${r.year}-${String(r.month).padStart(2, '0')}-${String(r.day).padStart(2, '0')}`;
    const dupKey = `${date}|${Math.round(E / 100)}|${Math.round(N / 100)}`;
    if (seen.has(dupKey)) continue;
    seen.add(dupKey);
    const canton = inRings(shapes.ZH, E, N) ? 'ZH' : inRings(shapes.SZ, E, N) ? 'SZ' : null;
    ch.push({
      gbifKey: r.key,
      species,
      dataset: r.datasetKey,
      license: r.license ?? '',
      basis: r.basisOfRecord ?? '',
      date,
      lat: r.decimalLatitude!,
      lon: r.decimalLongitude!,
      E: Math.round(E),
      N: Math.round(N),
      uncertaintyM: r.coordinateUncertaintyInMeters ?? null,
      canton: canton as 'ZH' | 'SZ',
      cell: null,
      elevation: null,
    });
  }
}
const elevCh = await elevations(ch);
ch.forEach((o, i) => (o.elevation = elevCh[i] ?? null));

// Supplement 2: SwissFungi in ZH + SZ: exact dates, positions generalised to 5 km squares, no elevation.
const sf: { species: string; date: string; E: number; N: number }[] = [];
for (const [species, key] of Object.entries(TAXA))
  for (const r of await fetchAll(key)) {
    if (!r.datasetKey.startsWith('c0633ec5') || !r.year || !r.month || !r.day) continue;
    const { E, N } = wgs84ToLv95(r.decimalLatitude!, r.decimalLongitude!);
    if (!inRings(shapes.ZH, E, N) && !inRings(shapes.SZ, E, N)) continue;
    sf.push({
      species,
      date: `${r.year}-${String(r.month).padStart(2, '0')}-${String(r.day).padStart(2, '0')}`,
      E: Math.round(E),
      N: Math.round(N),
    });
  }

writeFileSync(
  join(DIR, 'data', 'occurrences.json'),
  JSON.stringify({
    fetched: new Date().toISOString(),
    source: 'GBIF.org occurrence search API',
    datasets,
    strict: all,
    ch,
    sf5km: sf,
  }) + '\n',
);
console.table(summary);
console.table(Object.values(datasets));
const years = all.map((o) => Number(o.date.slice(0, 4)));
console.log(
  'strict: years',
  Math.min(...years),
  '–',
  Math.max(...years),
  '| since 2021:',
  years.filter((y) => y >= 2021).length,
  '| in a forest square:',
  all.filter((o) => o.cell !== null).length,
  '/',
  all.length,
);
const per = (list: { species: string; date: string }[]) =>
  Object.fromEntries(
    Object.keys(TAXA).map((s) => [
      s,
      `${list.filter((o) => o.species === s).length} (${list.filter((o) => o.species === s && o.date >= '2021').length} since 2021)`,
    ]),
  );
console.table({ strict: per(all), ch: per(ch), sf5km: per(sf) });
