/** Pure helpers for the 1 km forest grid (SPEC §3.3). */

export const CELL_M = 1000;
/** Weather is fetched once per 3×3 km block (≈ the weather model's resolution) and shared by its cells. */
export const WEATHER_BLOCK_KM = 3;

export interface CellForest {
  forest_pct: number;
  conifer_pct: number | null;
  /** Up to 9 tree pixels spread over the cell (nearest tree pixel to each 333 m sub-square's centre), as [col, row]. */
  samples: [number, number][];
}

/**
 * Forest stats for one 1 km cell from 100×100 NFI pixels (broadleaf share 0–100, null = no trees), row 0 = north.
 */
export function cellForest(px: (number | null)[], size = 100): CellForest {
  let trees = 0;
  let conifer = 0;
  for (const v of px) {
    if (v === null) continue;
    trees++;
    conifer += 100 - v;
  }
  const samples: [number, number][] = [];
  const third = size / 3;
  for (let sj = 0; sj < 3; sj++)
    for (let si = 0; si < 3; si++) {
      const ci = (si + 0.5) * third;
      const cj = (sj + 0.5) * third;
      let best: [number, number] | null = null;
      let bestD = Infinity;
      for (let j = Math.floor(sj * third); j < Math.floor((sj + 1) * third); j++)
        for (let i = Math.floor(si * third); i < Math.floor((si + 1) * third); i++) {
          if (px[j * size + i] === null) continue;
          const d = (i + 0.5 - ci) ** 2 + (j + 0.5 - cj) ** 2;
          if (d < bestD) [best, bestD] = [[i, j], d];
        }
      if (best) samples.push(best);
    }
  return {
    forest_pct: (100 * trees) / (size * size),
    conifer_pct: trees ? conifer / trees : null,
    samples,
  };
}

/**
 * Mean elevation, slope and aspect of the forested part of a cell, from an n×n elevation grid (row 0 = north)
 * and a tree mask on the same grid. Slope: mean of local slopes. Aspect: direction of the mean downhill vector.
 */
export function cellTerrain(
  elev: number[],
  tree: boolean[],
  n: number,
  res: number,
): { elevation: number; slope: number; aspect: number | null } | null {
  let sum = 0;
  let k = 0;
  let slopeSum = 0;
  let vx = 0;
  let vy = 0;
  let g = 0;
  const z = (i: number, j: number) => elev[j * n + i]!;
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      if (!tree[j * n + i]) continue;
      sum += z(i, j);
      k++;
      if (i === 0 || j === 0 || i === n - 1 || j === n - 1) continue;
      let ok = true;
      for (let dj = -1; dj <= 1; dj++)
        for (let di = -1; di <= 1; di++) if (!Number.isFinite(z(i + di, j + dj))) ok = false;
      if (!ok) continue;
      // Horn's method; row j-1 is north.
      const dzdx =
        (z(i + 1, j - 1) +
          2 * z(i + 1, j) +
          z(i + 1, j + 1) -
          (z(i - 1, j - 1) + 2 * z(i - 1, j) + z(i - 1, j + 1))) /
        (8 * res);
      const dzdy =
        (z(i - 1, j - 1) +
          2 * z(i, j - 1) +
          z(i + 1, j - 1) -
          (z(i - 1, j + 1) + 2 * z(i, j + 1) + z(i + 1, j + 1))) /
        (8 * res);
      slopeSum += (Math.atan(Math.hypot(dzdx, dzdy)) * 180) / Math.PI;
      vx -= dzdx;
      vy -= dzdy;
      g++;
    }
  if (k === 0) return null;
  let aspect: number | null = null;
  if (g > 0 && Math.hypot(vx, vy) / g > 0.02) {
    aspect = (Math.atan2(vx, vy) * 180) / Math.PI;
    if (aspect < 0) aspect += 360;
  }
  return { elevation: sum / k, slope: g ? slopeSum / g : 0, aspect };
}

/** Douglas–Peucker simplification of an open line (LV95 metres). Keeps first and last point. */
function simplifyLine(line: [number, number][], tolerance: number): [number, number][] {
  if (line.length <= 2) return line;
  const keep = new Array(line.length).fill(false);
  keep[0] = keep[line.length - 1] = true;
  const stack: [number, number][] = [[0, line.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const [ax, ay] = line[a]!;
    const [bx, by] = line[b]!;
    const len = Math.hypot(bx - ax, by - ay);
    let maxD = 0;
    let idx = -1;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = line[i]!;
      const d =
        len === 0
          ? Math.hypot(px - ax, py - ay)
          : Math.abs((bx - ax) * (ay - py) - (ax - px) * (by - ay)) / len;
      if (d > maxD) [maxD, idx] = [d, i];
    }
    if (idx > 0 && maxD > tolerance) {
      keep[idx] = true;
      stack.push([a, idx], [idx, b]);
    }
  }
  return line.filter((_, i) => keep[i]);
}

/**
 * Douglas–Peucker simplification of a closed ring: split at the point farthest from the start, simplify both halves.
 * Rings that would collapse below 4 points are returned unchanged.
 */
export function simplify(ring: [number, number][], tolerance: number): [number, number][] {
  if (ring.length <= 4) return ring;
  const [sx, sy] = ring[0]!;
  let far = 1;
  for (let i = 1; i < ring.length - 1; i++)
    if (
      Math.hypot(ring[i]![0] - sx, ring[i]![1] - sy) >
      Math.hypot(ring[far]![0] - sx, ring[far]![1] - sy)
    )
      far = i;
  const out = [
    ...simplifyLine(ring.slice(0, far + 1), tolerance),
    ...simplifyLine(ring.slice(far), tolerance).slice(1),
  ];
  return out.length >= 4 ? out : ring;
}

/** Most common value (ignores null); null if none. */
export function mode<T>(values: (T | null)[]): T | null {
  const counts = new Map<T, number>();
  for (const v of values) if (v !== null) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: T | null = null;
  let n = 0;
  for (const [v, c] of counts) if (c > n) [best, n] = [v, c];
  return best;
}
