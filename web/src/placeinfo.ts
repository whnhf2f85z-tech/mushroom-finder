/**
 * "Getting there and safety" in the spot, square and pin details, from the federal geoportal (api3.geo.admin.ch,
 * open data, source attribution required; docs/DATA_SOURCES.md):
 *   - nearest public transport stop (BAV, ch.bav.haltestellen-oev)
 *   - marked hiking trails (swisstopo swissTLM3D, ch.swisstopo.swisstlm3d-wanderwege)
 *   - military firing notices on the selected day (VBS, ch.vbs.schiessanzeigen)
 * Live requests: needs a connection; results are kept for the session.
 */
import { esc, shortDate } from './format.js';

const IDENTIFY = 'https://api3.geo.admin.ch/rest/services/api/MapServer/identify';
const TRAIL_NEAR_M = 300;
const FIRING_NEAR_M = 1000;
const STOP_RADII_M = [2000, 5000, 10000];

/** A point (half = 0) or a square around E/N (half = half the side, m), LV95. */
export interface Place {
  E: number;
  N: number;
  half: number;
}

interface Feature {
  geometry?: { type: string; coordinates: unknown };
  attributes?: Record<string, unknown>;
  properties?: Record<string, unknown>;
}

const cache = new Map<string, Promise<Feature[]>>();
function identify(layer: string, box: [number, number, number, number], geometry: boolean) {
  const b = box.map(Math.round).join(',');
  const q = new URLSearchParams({
    geometryType: 'esriGeometryEnvelope',
    geometry: b,
    imageDisplay: '500,500,96',
    mapExtent: b,
    tolerance: '0',
    layers: `all:${layer}`,
    sr: '2056',
    returnGeometry: String(geometry),
    geometryFormat: 'geojson',
    limit: '200',
    lang: 'en',
  });
  const url = `${IDENTIFY}?${q}`;
  let p = cache.get(url);
  if (!p) {
    p = fetch(url, { signal: AbortSignal.timeout(10_000) })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<{ results: Feature[] }>;
      })
      .then((j) => j.results);
    p.catch(() => cache.delete(url));
    cache.set(url, p);
  }
  return p;
}

const boxAround = (p: Place, extra: number): [number, number, number, number] => [
  p.E - p.half - extra,
  p.N - p.half - extra,
  p.E + p.half + extra,
  p.N + p.half + extra,
];
const attrs = (f: Feature) => f.attributes ?? f.properties ?? {};

/** Distance (m) from a point to the place: 0 inside a square. */
function distToPlace(p: Place, x: number, y: number): number {
  const dx = Math.max(0, Math.abs(x - p.E) - p.half);
  const dy = Math.max(0, Math.abs(y - p.N) - p.half);
  return Math.hypot(dx, dy);
}

/** Distance (m) from the place to a polyline (segment sampling at ~10 m is enough here). */
function distToLines(p: Place, lines: [number, number][][]): number {
  let best = Infinity;
  for (const line of lines)
    for (let k = 1; k < line.length; k++) {
      const [x1, y1] = line[k - 1]!;
      const [x2, y2] = line[k]!;
      const n = Math.max(1, Math.ceil(Math.hypot(x2 - x1, y2 - y1) / 10));
      for (let s = 0; s <= n; s++) {
        const d = distToPlace(p, x1 + ((x2 - x1) * s) / n, y1 + ((y2 - y1) * s) / n);
        if (d < best) best = d;
      }
    }
  return best;
}

const linesOf = (g: Feature['geometry']): [number, number][][] =>
  !g
    ? []
    : g.type === 'LineString'
      ? [g.coordinates as [number, number][]]
      : g.type === 'MultiLineString'
        ? (g.coordinates as [number, number][][])
        : [];

const km = (m: number) =>
  m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`;

export async function nearestStop(p: Place): Promise<string> {
  for (const r of STOP_RADII_M) {
    const fs = await identify('ch.bav.haltestellen-oev', boxAround(p, r), true);
    let best: { name: string; mode: string; d: number } | null = null;
    for (const f of fs) {
      const pts = (
        f.geometry?.type === 'MultiPoint' ? f.geometry.coordinates : [f.geometry?.coordinates]
      ) as [number, number][];
      for (const pt of pts) {
        if (!pt) continue;
        const d = Math.hypot(pt[0] - p.E, pt[1] - p.N);
        const a = attrs(f);
        if (!best || d < best.d)
          best = {
            name: String(a.name ?? a.label ?? 'stop'),
            mode: String(a.verkehrsmittel_de ?? ''),
            d,
          };
      }
    }
    if (best && best.d <= r)
      return `Nearest public transport stop: <strong>${esc(best.name)}</strong>${best.mode ? ` (${esc(MODE[best.mode] ?? best.mode.toLowerCase())})` : ''}, ${km(best.d)} in a straight line from ${p.half ? 'the centre of the square' : 'here'}.`;
  }
  return `No public transport stop within ${km(STOP_RADII_M.at(-1)!)}.`;
}
const MODE: Record<string, string> = {
  Bus: 'bus',
  Zug: 'train',
  Tram: 'tram',
  Schiff: 'boat',
  Standseilbahn: 'funicular',
  Kabinenbahn: 'cable car',
  Sesselbahn: 'chairlift',
  Luftseilbahn: 'cable car',
};

export async function hikingTrail(p: Place): Promise<string> {
  const fs = await identify('ch.swisstopo.swisstlm3d-wanderwege', boxAround(p, TRAIL_NEAR_M), true);
  const d = distToLines(
    p,
    fs.flatMap((f) => linesOf(f.geometry)),
  );
  if (!Number.isFinite(d)) return `No marked hiking trail within ${TRAIL_NEAR_M} m.`;
  if (d === 0 && p.half) return 'A marked hiking trail passes through this square.';
  if (d <= 20) return 'A marked hiking trail passes here.';
  return `Nearest marked hiking trail: about ${km(d)} away.`;
}

/** dd.mm.yyyy → yyyy-mm-dd */
const iso = (d: string) => `${d.slice(6, 10)}-${d.slice(3, 5)}-${d.slice(0, 2)}`;
const hhmm = (t: string) => (t && t.length === 4 ? `${t.slice(0, 2)}:${t.slice(2)}` : '');

/** Firing notices on `date` for hazard zones that cover the place or are within 1 km. null = nothing to warn about. */
export async function firingNotice(p: Place, date: string): Promise<string | null> {
  const near = await identify('ch.vbs.schiessanzeigen', boxAround(p, FIRING_NEAR_M), false);
  const inside = new Set(
    (await identify('ch.vbs.schiessanzeigen', boxAround(p, 1), false)).map((f) =>
      String(attrs(f).id ?? ''),
    ),
  );
  const hits: string[] = [];
  const seen = new Set<string>();
  for (const f of near) {
    const a = attrs(f);
    const dates = (a.belegungsdatum as string[] | null) ?? [];
    const k = dates.findIndex((d) => iso(d) === date);
    if (k < 0 || (a.kein_schiessen as boolean[] | null)?.[k] === true) continue;
    const key = `${a.bezeichnung}|${date}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const from = hhmm(((a.zeit_von as string[] | null) ?? [])[k] ?? '');
    const to = hhmm(((a.zeit_bis as string[] | null) ?? [])[k] ?? '');
    const where = inside.has(String(a.id ?? ''))
      ? p.half
        ? 'covers part of this square'
        : 'covers this place'
      : 'is within 1 km';
    const url = String(a.url_en ?? a.url_de ?? 'https://www.armee.ch/schiessanzeigen');
    hits.push(
      `<strong>Military firing notice ${shortDate(date)}${from ? `, ${from}–${to}` : ''}:</strong> the hazard zone "${esc(String(a.bezeichnung ?? ''))}" ${where}. Stay out of the hazard zone and follow the signs. <a href="${esc(url)}" target="_blank" rel="noopener">Bulletin (armee.ch)</a>`,
    );
  }
  if (hits.length) return hits.join('<br>');
  return null;
}

export const placeInfoSection = () => `
  <h3>Getting there and safety</h3>
  <p class="warn-note small" id="firing" hidden></p>
  <ul class="small plain" id="place-info"><li>Loading from map.geo.admin.ch…</li></ul>`;

/** The place and the latest request per detail panel, so a day change can redo the date-dependent part. */
const shown = new WeakMap<HTMLElement, { p: Place; today: string; token: number }>();

/**
 * Fill the section rendered by placeInfoSection(); `date` is the day shown on the map. Called again (or via
 * updatePlaceInfoDay) when the day changes; results of an older call are dropped.
 */
export async function fillPlaceInfo(
  el: HTMLElement,
  p: Place,
  date: string,
  today: string,
): Promise<void> {
  const token = (shown.get(el)?.token ?? 0) + 1;
  shown.set(el, { p, today, token });
  const list = el.querySelector<HTMLElement>('#place-info');
  const firing = el.querySelector<HTMLElement>('#firing');
  if (!list || !firing) return;
  firing.hidden = true;
  firing.innerHTML = '';
  if (!navigator.onLine) {
    list.innerHTML =
      '<li>Public transport, hiking trails and firing notices need a connection.</li>';
    return;
  }
  const [stop, trail, fire] = await Promise.allSettled([
    nearestStop(p),
    hikingTrail(p),
    firingNotice(p, date),
  ]);
  if (shown.get(el)?.token !== token) return; // the day changed meanwhile
  const text = (r: PromiseSettledResult<string | null>, what: string) =>
    r.status === 'fulfilled' ? r.value : `${what}: could not be loaded right now.`;
  list.innerHTML = [
    `<li>${text(stop, 'Public transport')}</li>`,
    `<li>${text(trail, 'Hiking trails')}</li>`,
    fire.status === 'rejected'
      ? '<li>Military firing notices: could not be loaded right now; check <a href="https://www.armee.ch/schiessanzeigen" target="_blank" rel="noopener">armee.ch</a>.</li>'
      : fire.value
        ? ''
        : date < today
          ? '<li>Military firing notices are only published for the coming days.</li>'
          : `<li>No military firing notice within 1 km on ${shortDate(date)}.</li>`,
    '<li class="source">Source: BAV, swisstopo, VBS (map.geo.admin.ch).</li>',
  ].join('');
  if (fire.status === 'fulfilled' && fire.value) {
    firing.innerHTML = `⚠ ${fire.value}`;
    firing.hidden = false;
  }
}

/** Redo the section for another day, for the place it was last filled with (no-op if never filled). */
export function updatePlaceInfoDay(el: HTMLElement, date: string): Promise<void> {
  const s = shown.get(el);
  return s ? fillPlaceInfo(el, s.p, date, s.today) : Promise.resolve();
}
