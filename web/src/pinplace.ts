import {
  cellHabitat,
  wgs84ToLv95,
  type CantonT,
  type GridFile,
  type HabitatEntry,
  type Habitat,
} from '@mf/scoring';

const API = 'https://api3.geo.admin.ch/rest/services';

/** Canton of a point (swissBOUNDARIES3D via geo.admin identify); null outside ZH and SZ. */
export async function cantonAt(lat: number, lon: number): Promise<CantonT | null> {
  const q = new URLSearchParams({
    geometryType: 'esriGeometryPoint',
    geometry: `${lon},${lat}`,
    sr: '4326',
    tolerance: '0',
    returnGeometry: 'false',
    layers: 'all:ch.swisstopo.swissboundaries3d-kanton-flaeche.fill',
  });
  const res = await fetch(`${API}/api/MapServer/identify?${q}`);
  if (!res.ok) throw new Error('Canton lookup failed');
  const ak = ((await res.json()) as { results?: { attributes?: { ak?: string } }[] }).results?.[0]
    ?.attributes?.ak;
  return ak === 'ZH' || ak === 'SZ' ? ak : null;
}

/** Terrain-model elevation of a point (swissALTI3D via the geo.admin height service, LV95 only). */
export async function elevationAt(lat: number, lon: number): Promise<number | null> {
  const { E, N } = wgs84ToLv95(lat, lon);
  try {
    const res = await fetch(
      `${API}/height?easting=${E.toFixed(1)}&northing=${N.toFixed(1)}&sr=2056`,
    );
    if (!res.ok) return null;
    const h = Number(((await res.json()) as { height?: string }).height);
    return Number.isFinite(h) ? Math.round(h) : null;
  } catch {
    return null;
  }
}

/** Pins take the habitat of the nearest forest square if it's within this distance. */
export const PIN_CELL_MAX_KM = 1.5;

export function nearestCell(
  g: GridFile,
  lat: number,
  lon: number,
): { i: number; km: number } | null {
  const { E, N } = wgs84ToLv95(lat, lon);
  let best = -1;
  let bestD = Infinity;
  for (let i = 0; i < g.count; i++) {
    const d = Math.hypot(g.cells.e[i]! * 1000 + 500 - E, g.cells.n[i]! * 1000 + 500 - N);
    if (d < bestD) [best, bestD] = [i, d];
  }
  return best < 0 ? null : { i: best, km: bestD / 1000 };
}

type Feature = {
  properties?: { name?: string; noPicking?: boolean };
  geometry?: { type: string; coordinates: number[][][] };
};

/** The strictest reserve containing the point (even-odd over all rings, like the build). */
export function reserveAt(
  features: Feature[],
  lat: number,
  lon: number,
): { name: string; noPicking: boolean } | null {
  let hit: { name: string; noPicking: boolean } | null = null;
  for (const f of features) {
    if (f.geometry?.type !== 'Polygon') continue;
    let inside = false;
    for (const ring of f.geometry.coordinates)
      for (let p = 0, q = ring.length - 1; p < ring.length; q = p++) {
        const [xi, yi] = ring[p]! as [number, number];
        const [xj, yj] = ring[q]! as [number, number];
        if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi)
          inside = !inside;
      }
    if (!inside) continue;
    const noPicking = !!f.properties?.noPicking;
    if (!hit || (noPicking && !hit.noPicking))
      hit = { name: f.properties?.name ?? 'Protected area', noPicking };
  }
  return hit;
}

/**
 * Habitat of a pin: its own elevation; tree cover, tree mix, pH, slope and aspect from the nearest forest square
 * (within 1.5 km), else unknown (lower confidence). Protection from the reserve outlines at the pin itself.
 */
export function pinHabitat(
  g: GridFile | null,
  pin: { lat: number; lon: number; elevation: number | null },
  reserve: { name: string; noPicking: boolean } | null,
): { habitat: Habitat; entry: HabitatEntry; cellKm: number | null } {
  const near = g ? nearestCell(g, pin.lat, pin.lon) : null;
  const useCell = near && near.km <= PIN_CELL_MAX_KM ? near.i : null;
  const c = g && useCell !== null ? cellHabitat(g, useCell) : null;
  const elevation = pin.elevation ?? c?.elevation ?? 1000;
  const site =
    g && useCell !== null && g.cells.site[useCell] !== null
      ? g.siteTypes[g.cells.site[useCell]!]
      : null;
  const habitat: Habitat = {
    ...(c ?? { ph_class: 'unknown' as const }),
    elevation,
    protected: {
      is: !!reserve,
      noPicking: reserve?.noPicking ?? false,
      ...(reserve ? { name: reserve.name } : {}),
    },
  };
  const entry: HabitatEntry = {
    lat: pin.lat,
    lon: pin.lon,
    elevation,
    slope: c?.slope ?? null,
    aspect: c?.aspect ?? null,
    forest_pct: c?.forest_pct ?? 0,
    conifer_pct: c?.conifer_pct ?? null,
    site_type_code: site?.code ?? null,
    site_type_name: site?.name ?? null,
    lithology: null,
    ph_class: c?.ph_class ?? 'unknown',
    ph_source: g && useCell !== null ? g.cells.phSource[useCell]! : 'none',
    protected: {
      is: !!reserve,
      name: reserve?.name ?? null,
      noPicking: reserve?.noPicking ?? false,
    },
  };
  return { habitat, entry, cellKm: useCell !== null ? near!.km : null };
}
