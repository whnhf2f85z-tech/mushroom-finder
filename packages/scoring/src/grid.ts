import { wgs84ToLv95 } from './lv95.js';
import type { WeatherLocation } from './openmeteo.js';
import type { GridFile } from './output-schemas.js';
import type { Species } from './schemas.js';
import { scoreSpecies } from './score.js';
import type { DailyWeather, Habitat } from './types.js';

/** Standard lapse rate: a cell 100 m above its weather point is 0.65 °C cooler. */
export const LAPSE_C_PER_M = 0.0065;

export const pointId = (k: number) => `wp${k}`;

/** Weather locations for the grid: one per weather point, at the mean elevation of its cells. */
export const gridLocations = (g: GridFile): WeatherLocation[] =>
  g.weatherPoints.lat.map((lat, k) => ({
    id: pointId(k),
    lat,
    lon: g.weatherPoints.lon[k]!,
    elevation: g.weatherPoints.elevation[k]!,
  }));

/** Shift temperatures for a cell `dz` metres above (positive) or below its weather point. Rain is unchanged. */
export function adjustForElevation(w: DailyWeather[], dz: number): DailyWeather[] {
  if (dz === 0) return w;
  const dt = -LAPSE_C_PER_M * dz;
  return w.map((d) => ({
    ...d,
    tmin: d.tmin + dt,
    tmax: d.tmax + dt,
    tmean: d.tmean + dt,
    ...(d.soilTemp0_7 !== undefined ? { soilTemp0_7: d.soilTemp0_7 + dt } : {}),
  }));
}

export function cellHabitat(g: GridFile, i: number): Habitat {
  const c = g.cells;
  const h: Habitat = {
    elevation: c.elevation[i]!,
    forest_pct: c.forest[i]!,
    ph_class: c.ph[i]!,
    slope: c.slope[i]!,
    protected: { is: c.protected[i]! > 0, noPicking: c.protected[i] === 2 },
  };
  if (c.conifer[i] !== null) h.conifer_pct = c.conifer[i]!;
  if (c.aspect[i] !== null) h.aspect = c.aspect[i]!;
  const site = c.site[i];
  if (site !== null && site !== undefined) h.site_type_code = g.siteTypes[site]!.code;
  return h;
}

/** Elevation of a cell above its weather point, m (negative = below). */
export const elevationAboveWeatherPoint = (g: GridFile, i: number): number =>
  g.cells.elevation[i]! - g.weatherPoints.elevation[g.cells.weather[i]!]!;

/** Distance (km) from a cell's centre to its weather point. */
export function weatherDistanceKm(g: GridFile, i: number): number {
  const k = g.cells.weather[i]!;
  const p = wgs84ToLv95(g.weatherPoints.lat[k]!, g.weatherPoints.lon[k]!);
  return Math.hypot(p.E - (g.cells.e[i]! * 1000 + 500), p.N - (g.cells.n[i]! * 1000 + 500)) / 1000;
}

/**
 * Score every cell and species for each date. `weather` is keyed by weather point id; a cell whose point has no
 * weather (or no weather on that date) gets null.
 */
export function scoreGrid(
  g: GridFile,
  species: Species[],
  weather: Map<string, DailyWeather[]>,
  dates: string[],
): Map<string, Record<string, (number | null)[]>> {
  const out = new Map<string, Record<string, (number | null)[]>>();
  for (const d of dates)
    out.set(
      d,
      Object.fromEntries(species.map((s) => [s.id, new Array<number | null>(g.count).fill(null)])),
    );
  for (let i = 0; i < g.count; i++) {
    const k = g.cells.weather[i]!;
    const base = weather.get(pointId(k));
    if (!base) continue;
    const w = adjustForElevation(base, g.cells.elevation[i]! - g.weatherPoints.elevation[k]!);
    const index = new Map(w.map((d, j) => [d.date, j]));
    const habitat = cellHabitat(g, i);
    const ctx = { weatherDistanceKm: weatherDistanceKm(g, i) };
    for (const date of dates) {
      const j = index.get(date);
      if (j === undefined) continue;
      const upTo = w.slice(0, j + 1);
      const day = out.get(date)!;
      for (const s of species) day[s.id]![i] = scoreSpecies(s, upTo, habitat, ctx).score;
    }
  }
  return out;
}
