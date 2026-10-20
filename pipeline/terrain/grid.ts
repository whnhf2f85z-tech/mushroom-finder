/** A square 10 m grid in LV95 around a point, holding the forest-mix and elevation rasters on the same cells. */
export interface Grid {
  /** LV95 coordinates of the top-left corner of cell (0, 0). */
  E0: number;
  N0: number;
  /** Cell size, m. */
  res: number;
  size: number;
  /** Broadleaf share 0–100 per cell (NFI forest mix rate); null = no trees. Row 0 is north. */
  broadleaf: (number | null)[];
  /** Elevation per cell, m; null = no data. */
  elev: (number | null)[];
}

export const cellCenter = (g: Grid, i: number, j: number) => ({
  E: g.E0 + (i + 0.5) * g.res,
  N: g.N0 - (j + 0.5) * g.res,
});

export const cellAt = (g: Grid, E: number, N: number) => ({
  i: Math.floor((E - g.E0) / g.res),
  j: Math.floor((g.N0 - N) / g.res),
});

const inside = (g: Grid, i: number, j: number) => i >= 0 && j >= 0 && i < g.size && j < g.size;

/** Cells within `radius` metres of cell (i, j). */
function* disc(g: Grid, i: number, j: number, radius: number): Generator<number> {
  const r = Math.round(radius / g.res);
  for (let dj = -r; dj <= r; dj++)
    for (let di = -r; di <= r; di++) {
      if (di * di + dj * dj > r * r) continue;
      const ii = i + di;
      const jj = j + dj;
      if (inside(g, ii, jj)) yield jj * g.size + ii;
    }
}

/** Share of tree cells (%) and mean conifer share (%) of those, within `radius` m. */
export function forestStats(
  g: Grid,
  i: number,
  j: number,
  radius: number,
): { forest_pct: number; conifer_pct: number | null } {
  let n = 0;
  let trees = 0;
  let conifer = 0;
  for (const k of disc(g, i, j, radius)) {
    n++;
    const b = g.broadleaf[k];
    if (b === null || b === undefined) continue;
    trees++;
    conifer += 100 - b;
  }
  return { forest_pct: n ? (100 * trees) / n : 0, conifer_pct: trees ? conifer / trees : null };
}

/**
 * Slope (°) and aspect (° clockwise from north, the direction the slope faces) with Horn's method,
 * using neighbours `step` cells away to smooth out small bumps.
 */
export function slopeAspect(
  g: Grid,
  i: number,
  j: number,
  step = 3,
): { slope: number; aspect: number } | null {
  const z = (di: number, dj: number) => {
    const ii = i + di * step;
    const jj = j + dj * step;
    return inside(g, ii, jj) ? g.elev[jj * g.size + ii] : null;
  };
  const a = z(-1, -1),
    b = z(0, -1),
    c = z(1, -1);
  const d = z(-1, 0),
    f = z(1, 0);
  const gg = z(-1, 1),
    h = z(0, 1),
    k = z(1, 1);
  if ([a, b, c, d, f, gg, h, k].some((v) => v === null || v === undefined)) return null;
  const dist = g.res * step;
  // Row -1 is north. dzdx: rise towards east; dzdy: rise towards north.
  const dzdx = (c! + 2 * f! + k! - (a! + 2 * d! + gg!)) / (8 * dist);
  const dzdy = (a! + 2 * b! + c! - (gg! + 2 * h! + k!)) / (8 * dist);
  const slope = (Math.atan(Math.hypot(dzdx, dzdy)) * 180) / Math.PI;
  // Facing direction = steepest descent = (-dzdx, -dzdy), as a compass bearing.
  let aspect = (Math.atan2(-dzdx, -dzdy) * 180) / Math.PI;
  if (aspect < 0) aspect += 360;
  return { slope, aspect };
}

export interface PinCheck {
  inForest: boolean;
  elevation: number | null;
  inBand: boolean;
}

/** Forest = at least 60 % tree cells within 50 m and at least 50 % within 150 m (not a hedge or a forest edge). */
export const FOREST_MIN_PCT = 60;
const FOREST_RADIUS = 50;
export const FOREST_AREA_MIN_PCT = 50;
const FOREST_AREA_RADIUS = 150;

export function checkPin(
  g: Grid,
  i: number,
  j: number,
  band: { min: number; max: number },
  margin = 0,
): PinCheck {
  const elevation = g.elev[j * g.size + i] ?? null;
  return {
    inForest:
      forestStats(g, i, j, FOREST_RADIUS).forest_pct >= FOREST_MIN_PCT &&
      forestStats(g, i, j, FOREST_AREA_RADIUS).forest_pct >= FOREST_AREA_MIN_PCT,
    elevation,
    inBand: elevation !== null && elevation >= band.min + margin && elevation <= band.max - margin,
  };
}

/**
 * Nearest cell within `maxDist` m that is in forest and inside the elevation band (with a margin, so the new pin
 * isn't right on the edge of the band). null if there is none.
 */
export function nearestGoodCell(
  g: Grid,
  i0: number,
  j0: number,
  band: { min: number; max: number },
  maxDist = 1000,
  margin = 20,
  /** Cells that must not be chosen (e.g. no-picking reserves). */
  blocked: (i: number, j: number) => boolean = () => false,
): { i: number; j: number; dist: number } | null {
  const candidates: { i: number; j: number; dist: number }[] = [];
  const r = Math.round(maxDist / g.res);
  for (let dj = -r; dj <= r; dj++)
    for (let di = -r; di <= r; di++) {
      const dist = Math.hypot(di, dj) * g.res;
      if (dist > maxDist || !inside(g, i0 + di, j0 + dj)) continue;
      candidates.push({ i: i0 + di, j: j0 + dj, dist });
    }
  candidates.sort((a, b) => a.dist - b.dist);
  for (const c of candidates) {
    if (blocked(c.i, c.j)) continue;
    const p = checkPin(g, c.i, c.j, band, margin);
    if (p.inForest && p.inBand) return c;
  }
  return null;
}
