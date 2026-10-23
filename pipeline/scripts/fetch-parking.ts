/**
 * Parking near each spot, from OpenStreetMap (amenity=parking) via the Overpass API → web/public/data/static/parking.json.
 * Keeps the 3 nearest usable places within 3 km; leaves out private, residents-only and permit-only places.
 * Data © OpenStreetMap contributors, ODbL (docs/DATA_SOURCES.md). Run now and then: npm run parking
 * The public servers are often busy: PARKING_RAW=<file> uses a saved Overpass answer (JSON) instead.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ParkingFileSchema, SpotsFileSchema, type ParkingPlace } from '@mf/scoring';

const ROOT = join(import.meta.dirname, '../..');
const OUT = join(ROOT, 'web/public/data/static/parking.json');
const RADIUS_M = 3000;
const PER_SPOT = 3;
/** Public Overpass servers, tried in turn (they are often busy). */
const SERVERS = [
  'https://overpass-api.de/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];
const NOT_USABLE = new Set([
  'private',
  'no',
  'permit',
  'residents',
  'delivery',
  'agricultural',
  'forestry',
]);

const spots = SpotsFileSchema.parse(
  JSON.parse(readFileSync(join(ROOT, 'data/spots.json'), 'utf8')),
).spots;

interface Element {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

async function overpass(query: string): Promise<Element[]> {
  for (const url of SERVERS) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        body: `data=${encodeURIComponent(query)}`,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'MushroomFinder (github.com/whnhf2f85z-tech/mushroom-finder)',
        },
        signal: AbortSignal.timeout(90_000),
      });
      const text = await res.text();
      if (res.ok && text.startsWith('{'))
        return (JSON.parse(text) as { elements: Element[] }).elements;
      console.warn(`${url}: HTTP ${res.status}, trying the next server`);
    } catch (e) {
      console.warn(`${url}: ${(e as Error).message}, trying the next server`);
    }
  }
  throw new Error('No Overpass server answered; try again later.');
}

const distM = (lat1: number, lon1: number, lat2: number, lon2: number) => {
  const r = 6_371_000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(a));
};

const query = `[out:json][timeout:80];(${spots
  .map((s) => `nwr[amenity=parking](around:${RADIUS_M},${s.lat},${s.lon});`)
  .join('')});out center tags;`;
const elements = process.env.PARKING_RAW
  ? (JSON.parse(readFileSync(process.env.PARKING_RAW, 'utf8')) as { elements: Element[] }).elements
  : await overpass(query);

const out: Record<string, ParkingPlace[]> = {};
for (const s of spots) {
  const near = elements
    .map((e) => {
      const c =
        e.center ??
        (e.lat !== undefined && e.lon !== undefined ? { lat: e.lat, lon: e.lon } : null);
      if (!c) return null;
      const t = e.tags ?? {};
      if (NOT_USABLE.has(t.access ?? '')) return null;
      const cap = Number.parseInt(t.capacity ?? '', 10);
      return {
        lat: Math.round(c.lat * 1e5) / 1e5,
        lon: Math.round(c.lon * 1e5) / 1e5,
        distanceM: Math.round(distM(s.lat, s.lon, c.lat, c.lon)),
        name: t.name ?? null,
        fee: t.fee === 'yes' || t.fee === 'no' ? t.fee : null,
        capacity: Number.isFinite(cap) && cap > 0 ? cap : null,
        access: t.access && t.access !== 'yes' ? t.access : null,
        kind: t.parking ?? null,
        osm: `${e.type}/${e.id}`,
      } satisfies ParkingPlace;
    })
    .filter((p): p is ParkingPlace => p !== null && p.distanceM <= RADIUS_M)
    .sort((a, b) => a.distanceM - b.distanceM);
  // Several OSM objects for the same car park (e.g. one per row): keep the first within 60 m or of the same name.
  const picked: ParkingPlace[] = [];
  for (const p of near) {
    if (
      picked.some(
        (q) => distM(p.lat, p.lon, q.lat, q.lon) < 60 || (p.name !== null && p.name === q.name),
      )
    )
      continue;
    picked.push(p);
    if (picked.length === PER_SPOT) break;
  }
  out[s.id] = picked;
  console.log(
    `${s.id}: ${picked.map((p) => `${p.name ?? p.kind ?? 'parking'} ${p.distanceM} m${p.fee === 'yes' ? ' (fee)' : ''}`).join(' · ') || 'none within 3 km'}`,
  );
}

const file = ParkingFileSchema.parse({
  schemaVersion: 1,
  fetched: new Date().toISOString().slice(0, 10),
  source: 'OpenStreetMap contributors (ODbL), via the Overpass API',
  spots: out,
});
writeFileSync(OUT, JSON.stringify(file));
console.log(`Wrote ${OUT}`);
