import { describe, expect, it } from 'vitest';
import { cellForest, cellTerrain, mode, simplify } from '../terrain/cells.js';

describe('grid cells', () => {
  it('measures forest share, conifer share and spreads sample points', () => {
    // West half forest, 30 % broadleaf.
    const px = Array.from({ length: 100 * 100 }, (_, k) => (k % 100 < 50 ? 30 : null));
    const f = cellForest(px);
    expect(f.forest_pct).toBe(50);
    expect(f.conifer_pct).toBe(70);
    expect(f.samples.length).toBe(6); // two thirds of the sub-squares have trees within reach
    expect(f.samples.every(([i]) => i < 50)).toBe(true);
    expect(cellForest(new Array(100 * 100).fill(null)).conifer_pct).toBeNull();
  });

  it('finds elevation, slope and a south-facing aspect of the forest part', () => {
    const n = 50;
    // Falls 1 m per 20 m towards the south (row index grows to the south).
    const elev = Array.from({ length: n * n }, (_, k) => 1500 - Math.floor(k / n));
    const t = cellTerrain(elev, new Array(n * n).fill(true), n, 20)!;
    expect(t.elevation).toBeCloseTo(1475.5, 1);
    expect(t.slope).toBeCloseTo(2.86, 1); // atan(1/20)
    expect(t.aspect).toBeCloseTo(180, 0);
    const flat = cellTerrain(new Array(n * n).fill(500), new Array(n * n).fill(true), n, 20)!;
    expect(flat.aspect).toBeNull();
    expect(cellTerrain(elev, new Array(n * n).fill(false), n, 20)).toBeNull();
  });

  it('simplifies rings and keeps their shape', () => {
    const ring: [number, number][] = [
      [0, 0],
      [50, 0.5],
      [100, 0],
      [100, 100],
      [0, 100],
      [0, 0],
    ];
    const s = simplify(ring, 2);
    expect(s).not.toContainEqual([50, 0.5]);
    expect(s[0]).toEqual([0, 0]);
    expect(s.at(-1)).toEqual([0, 0]);
  });

  it('takes the most common value', () => {
    expect(mode(['a', 'b', 'a', null])).toBe('a');
    expect(mode([null])).toBeNull();
  });
});
