import L from 'leaflet';
import {
  GridDayFileSchema,
  GridFileSchema,
  NO_SCORE,
  bandFor,
  decodeScores,
  lv95ToWgs84,
  type GridFile,
} from '@mf/scoring';

import { savedJson } from './saved.js';

const base = import.meta.env.BASE_URL;

export async function loadGrid(): Promise<GridFile | null> {
  try {
    const res = await fetch(`${base}data/static/grid.json`);
    return res.ok ? GridFileSchema.parse(await res.json()) : null;
  } catch (e) {
    console.warn('No grid', e);
    return null;
  }
}

export interface GridDay {
  date: string;
  source: 'daily' | 'backfill' | 'forecast';
  scores: Record<string, Uint8Array>;
}

const dayCache = new Map<string, Promise<GridDay | null>>();

/** Days that are still a forecast in the scores shown (their saved copy may be a forecast version). */
let forecastDays = new Set<string>();
/** A newer run replaced the saved scores this session: saved forecast copies are out of date. */
let runChanged = false;

/**
 * Tell the grid which days are forecasts. If the scores shown were replaced by a newer run (`newRun`), the days
 * loaded so far are dropped so they're fetched again.
 */
export function setGridDays(forecast: string[], newRun: boolean): void {
  forecastDays = new Set(forecast);
  if (newRun) {
    runChanged = true;
    dayCache.clear();
  }
}

function parseDay(date: string, count: number, raw: unknown): GridDay | null {
  const f = GridDayFileSchema.safeParse(raw);
  if (!f.success || f.data.count !== count) return null;
  return {
    date,
    source: f.data.source,
    scores: Object.fromEntries(
      Object.entries(f.data.species).map(([k, v]) => [k, decodeScores(v)]),
    ),
  };
}

/**
 * One day of grid scores (kept for the session). The saved offline copy is used at once when it fits: a day's
 * real scores always; a forecast copy only for a day that is still a forecast and only if no newer run came in.
 * Otherwise it's fetched.
 */
export function loadGridDay(date: string, count: number): Promise<GridDay | null> {
  let p = dayCache.get(date);
  if (!p) {
    const url = `${base}data/grid/${date}.json`;
    p = savedJson(url)
      .then((raw) => {
        const saved = raw ? parseDay(date, count, raw) : null;
        const fits =
          saved !== null &&
          (saved.source !== 'forecast' || (forecastDays.has(date) && !runChanged));
        if (fits) return saved;
        return fetch(url, { cache: 'no-cache' }).then(async (res) =>
          res.ok ? parseDay(date, count, await res.json()) : null,
        );
      })
      .catch(() => null);
    dayCache.set(date, p);
  }
  return p;
}

/** Score of cell i: one species, or the best of several (null if none has a score). */
export function cellScore(day: GridDay | null, ids: string[], i: number): number | null {
  if (!day) return null;
  let best: number | null = null;
  for (const id of ids) {
    const v = day.scores[id]?.[i];
    if (v === undefined || v === NO_SCORE) continue;
    if (best === null || v > best) best = v;
  }
  return best;
}

/** LV95 cell corners → WGS84 polygon (cells are squares in LV95, slightly rotated in WGS84). */
export function cellLatLngs(g: GridFile, i: number): L.LatLngExpression[] {
  const E = g.cells.e[i]! * 1000;
  const N = g.cells.n[i]! * 1000;
  return [
    [E, N],
    [E + 1000, N],
    [E + 1000, N + 1000],
    [E, N + 1000],
  ].map(([e, n]) => {
    const p = lv95ToWgs84(e!, n!);
    return [p.lat, p.lon] as [number, number];
  });
}

export function cellCenter(g: GridFile, i: number): { lat: number; lon: number } {
  return lv95ToWgs84(g.cells.e[i]! * 1000 + 500, g.cells.n[i]! * 1000 + 500);
}

export interface CellStyle {
  score: number | null;
  closed: boolean;
  selected: boolean;
}

/**
 * The heatmap: one canvas polygon per 1 km forest cell. Colour shows the band; the number is shown on hover/tap,
 * as labels when zoomed in (≥ 12), in the "best squares" list and in the cell detail, so colour is never the only cue.
 */
export class GridLayer {
  readonly group = L.layerGroup();
  private readonly labels = L.layerGroup();
  private readonly polys: L.Polygon[] = [];
  private styles: CellStyle[] = [];

  constructor(
    private readonly map: L.Map,
    private readonly g: GridFile,
    onSelect: (i: number) => void,
    describe: (i: number) => string,
  ) {
    const renderer = L.canvas({ padding: 0.3 });
    for (let i = 0; i < g.count; i++) {
      const p = L.polygon(cellLatLngs(g, i), {
        renderer,
        stroke: false,
        fillOpacity: 0.6,
        fillColor: '#888',
      });
      p.bindTooltip(() => describe(i), { sticky: true });
      p.on('click', () => onSelect(i));
      this.polys.push(p);
      this.group.addLayer(p);
    }
    this.group.addLayer(this.labels);
    map.on('zoomend moveend', () => this.drawLabels());
  }

  update(styles: CellStyle[]): void {
    this.styles = styles;
    styles.forEach((s, i) => {
      const b = s.score === null ? null : bandFor(s.score);
      this.polys[i]!.setStyle({
        fillColor: s.closed || !b ? '#8a8f8b' : b.color,
        fillOpacity: s.score === null ? 0.25 : s.closed ? 0.35 : 0.6,
        stroke: s.selected,
        color: '#111',
        weight: 3,
      });
    });
    this.drawLabels();
  }

  /** Numbers on the cells when zoomed in far enough to read them. */
  private drawLabels(): void {
    this.labels.clearLayers();
    if (!this.map.hasLayer(this.group) || this.map.getZoom() < 12) return;
    const view = this.map.getBounds().pad(0.1);
    for (let i = 0; i < this.g.count; i++) {
      const s = this.styles[i];
      if (!s || s.score === null) continue;
      const c = cellCenter(this.g, i);
      if (!view.contains([c.lat, c.lon])) continue;
      this.labels.addLayer(
        L.marker([c.lat, c.lon], {
          icon: L.divIcon({
            className: 'cell-label',
            html: String(s.score),
            iconSize: [30, 16],
            iconAnchor: [15, 8],
          }),
          interactive: false,
          keyboard: false,
        }),
      );
    }
  }
}
