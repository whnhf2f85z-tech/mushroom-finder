/**
 * Habitat build (SPEC §4.2, Milestone 3): forest, tree mix, site type / geology → pH, elevation, slope, aspect,
 * protection, per spot → web/public/data/static/habitat.json.
 *
 *   npm run terrain                 # habitat only
 *   npm run terrain -- --move-pins  # also move pins that are not in forest or outside their elevation band
 *                                   # (nearest suitable point within 1 km) and update data/spots.json
 */
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import {
  HabitatFileSchema,
  RulesFileSchema,
  SpotsFileSchema,
  type HabitatEntry,
  type PhClassT,
  type Spot,
} from '@mf/scoring';
import { writeJsonValidated } from '../src/store.js';
import {
  cellAt,
  cellCenter,
  checkPin,
  forestStats,
  nearestGoodCell,
  slopeAspect,
  type Grid,
} from './grid.js';
import { lv95ToWgs84, wgs84ToLv95 } from '@mf/scoring';
import { majority, phFromLithology, phFromSiteType } from './ph.js';
import {
  federalMoor,
  geology,
  inArea,
  loadGrid,
  szProtectedAreas,
  szReserves,
  szSiteType,
  zhSiteType,
  type Area,
} from './sources.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = join(ROOT, 'web/public/data/static/habitat.json');
const SPOTS = join(ROOT, 'data/spots.json');

export interface PinMove {
  id: string;
  name: string;
  from: { lat: number; lon: number; elevation: number | null; forestPct: number };
  to: { lat: number; lon: number; elevation: number } | null;
  distance: number | null;
  reasons: string[];
}

const round = (x: number, d: number) => Math.round(x * 10 ** d) / 10 ** d;

async function habitatAt(
  spot: Spot,
  g: Grid,
  i: number,
  j: number,
  noPickingNames: string[],
): Promise<HabitatEntry> {
  const { E, N } = cellCenter(g, i, j);
  const { lat, lon } = lv95ToWgs84(E, N);
  const elevation = g.elev[j * g.size + i];
  if (elevation === null || elevation === undefined) throw new Error(`${spot.id}: no elevation`);
  const sa = slopeAspect(g, i, j);
  const fs = forestStats(g, i, j, 250);

  const site = spot.canton === 'SZ' ? await szSiteType(E, N) : await zhSiteType(E, N);
  const sitePh = site ? phFromSiteType(site.code, site.name) : null;
  // Geology at the pin and 100 m around it; majority vote smooths out a single odd polygon.
  const samples = [
    [0, 0],
    [100, 0],
    [-100, 0],
    [0, 100],
    [0, -100],
  ];
  const geo = [];
  for (const [dx, dy] of samples) geo.push(await geology(E + dx!, N + dy!));
  const geoPh = majority(geo.map((x) => phFromLithology(x.litho, x.description)));
  const ph_class: PhClassT = sitePh ?? geoPh;

  let prot: HabitatEntry['protected'] = { is: false, name: null, noPicking: false };
  if (spot.canton === 'SZ') {
    const r = await szReserves(E, N);
    if (r.plantReserve) prot = { is: true, name: r.plantReserve, noPicking: true };
    else if (r.natureReserve) {
      const banned = noPickingNames.some((n) =>
        r.natureReserve!.toLowerCase().includes(n.toLowerCase()),
      );
      prot = { is: true, name: `Nature reserve ${r.natureReserve}`, noPicking: banned };
    }
  }
  if (!prot.is) {
    const moor = await federalMoor(E, N);
    if (moor) prot = { is: true, name: moor, noPicking: false };
  }

  return {
    lat: round(lat, 5),
    lon: round(lon, 5),
    elevation: Math.round(elevation),
    slope: sa ? round(sa.slope, 1) : null,
    aspect: sa ? Math.round(sa.aspect) : null,
    forest_pct: Math.round(fs.forest_pct),
    conifer_pct: fs.conifer_pct === null ? null : Math.round(fs.conifer_pct),
    site_type_code: site?.code ?? null,
    site_type_name: site?.name ?? null,
    lithology: geo[0]!.litho ?? geo[0]!.description ?? null,
    ph_class,
    ph_source: sitePh ? 'site_type' : geoPh !== 'unknown' ? 'geology' : 'none',
    protected: prot,
  };
}

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { 'move-pins': { type: 'boolean', default: false } } });
  const spotsFile = SpotsFileSchema.parse(JSON.parse(await readFile(SPOTS, 'utf8')));
  const rules = RulesFileSchema.parse(
    JSON.parse(await readFile(join(ROOT, 'data/rules.json'), 'utf8')),
  );
  const noPicking: Record<string, string[]> = Object.fromEntries(
    Object.entries(rules.cantons).map(([c, r]) => [c, r.noPickingAreas]),
  );

  const habitat: Record<string, HabitatEntry> = {};
  const moves: PinMove[] = [];
  for (const spot of spotsFile.spots) {
    const { E, N } = wgs84ToLv95(spot.lat, spot.lon);
    const g = await loadGrid(E, N);
    let { i, j } = cellAt(g, E, N);
    const check = checkPin(g, i, j, spot.elevation_band);
    const box: [number, number, number, number] = [
      g.E0,
      g.N0 - g.size * g.res,
      g.E0 + g.size * g.res,
      g.N0,
    ];
    // Pins stay out of every reserve (no-picking or not), so a spot is never inside one.
    const reserves: Area[] =
      spot.canton === 'SZ' ? await szProtectedAreas(box, noPicking.SZ ?? []) : [];
    const isBlocked = (ii: number, jj: number) => {
      const c = cellCenter(g, ii, jj);
      return reserves.some((a) => inArea(a, c.E, c.N));
    };
    const reasons: string[] = [];
    const forestPct = Math.round(forestStats(g, i, j, 50).forest_pct);
    const areaPct = Math.round(forestStats(g, i, j, 150).forest_pct);
    if (!check.inForest)
      reasons.push(
        `not in forest (${forestPct} % tree cover within 50 m, ${areaPct} % within 150 m)`,
      );
    if (!check.inBand)
      reasons.push(
        `at ${Math.round(check.elevation ?? NaN)} m, outside ${spot.elevation_band.min}–${spot.elevation_band.max} m`,
      );
    const inReserve = reserves.find((a) => inArea(a, E, N));
    if (inReserve) reasons.push(`in a reserve (${inReserve.name})`);

    if (reasons.length && values['move-pins']) {
      const c = nearestGoodCell(g, i, j, spot.elevation_band, 1000, 20, isBlocked);
      const from = {
        lat: spot.lat,
        lon: spot.lon,
        elevation: check.elevation === null ? null : Math.round(check.elevation),
        forestPct,
      };
      if (c) {
        ({ i, j } = c);
        const to = lv95ToWgs84(cellCenter(g, i, j).E, cellCenter(g, i, j).N);
        spot.lat = round(to.lat, 5);
        spot.lon = round(to.lon, 5);
        moves.push({
          id: spot.id,
          name: spot.name,
          from,
          to: { lat: spot.lat, lon: spot.lon, elevation: Math.round(g.elev[j * g.size + i]!) },
          distance: Math.round(c.dist),
          reasons,
        });
      } else {
        moves.push({ id: spot.id, name: spot.name, from, to: null, distance: null, reasons });
      }
    } else if (reasons.length) {
      console.log(`  ${spot.id}: ${reasons.join('; ')} (run with --move-pins to fix)`);
    }

    habitat[spot.id] = await habitatAt(spot, g, i, j, noPicking[spot.canton] ?? []);
    const h = habitat[spot.id]!;
    console.log(
      `${spot.id}: ${h.elevation} m, slope ${h.slope}°, aspect ${h.aspect}°, forest ${h.forest_pct} %, conifer ${h.conifer_pct} %, ` +
        `site ${h.site_type_code ?? '–'} ${h.site_type_name ?? ''}, pH ${h.ph_class} (${h.ph_source}); ${h.lithology ?? ''}` +
        (h.protected.is
          ? `; PROTECTED: ${h.protected.name}${h.protected.noPicking ? ' (no picking)' : ''}`
          : ''),
    );
  }

  await writeJsonValidated(OUT, HabitatFileSchema, {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    spots: habitat,
  });
  console.log(`Wrote ${OUT}`);

  if (values['move-pins']) {
    await writeFile(SPOTS, JSON.stringify(spotsFile, null, 2) + '\n');
    console.log(`\nPin moves (${moves.length}):`);
    for (const m of moves)
      console.log(
        `| ${m.name} | ${m.reasons.join('; ')} | ${m.from.lat}, ${m.from.lon} | ${m.to ? `${m.to.lat}, ${m.to.lon} (${m.to.elevation} m)` : 'not moved: no forest inside the band within 1 km'} | ${m.distance ?? '–'} m |`,
      );
  }
}

await main();
