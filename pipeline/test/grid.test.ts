import { describe, expect, it } from 'vitest';
import {
  cellAt,
  cellCenter,
  checkPin,
  forestStats,
  nearestGoodCell,
  slopeAspect,
  type Grid,
} from '../terrain/grid.js';

/** 101×101 cells of 10 m. Elevation rises 1 m per 10 m towards the south (a north-facing slope), 1000 m at the top. */
function grid(forest: (i: number, j: number) => number | null): Grid {
  const size = 101;
  const broadleaf: (number | null)[] = [];
  const elev: number[] = [];
  for (let j = 0; j < size; j++)
    for (let i = 0; i < size; i++) {
      broadleaf.push(forest(i, j));
      elev.push(1000 + j);
    }
  return { E0: 2700000, N0: 1200000, res: 10, size, broadleaf, elev };
}

describe('terrain grid', () => {
  it('converts between cells and coordinates', () => {
    const g = grid(() => null);
    const c = cellCenter(g, 10, 20);
    expect(c).toEqual({ E: 2700105, N: 1199795 });
    expect(cellAt(g, c.E, c.N)).toEqual({ i: 10, j: 20 });
  });

  it('measures forest share and conifer share', () => {
    const g = grid((i) => (i < 50 ? 20 : null)); // west half: forest with 20 % broadleaf
    const west = forestStats(g, 20, 50, 100);
    expect(west.forest_pct).toBe(100);
    expect(west.conifer_pct).toBe(80);
    const edge = forestStats(g, 50, 50, 100);
    expect(edge.forest_pct).toBeGreaterThan(40);
    expect(edge.forest_pct).toBeLessThan(60);
    expect(forestStats(g, 90, 50, 50).conifer_pct).toBeNull();
  });

  it('finds the slope and that it faces north', () => {
    const g = grid(() => 0);
    const sa = slopeAspect(g, 50, 50)!;
    expect(sa.slope).toBeCloseTo(5.71, 1); // atan(0.1)
    expect(Math.min(sa.aspect, 360 - sa.aspect)).toBeLessThan(1);
  });

  it('keeps a good pin and moves a bad one to the nearest forest cell inside the band', () => {
    const g = grid((i) => (i < 50 ? 30 : null));
    const band = { min: 1030, max: 1080 };
    expect(checkPin(g, 20, 50, band)).toMatchObject({
      inForest: true,
      inBand: true,
      elevation: 1050,
    });
    // Pin in open land at the right elevation: moves west into the forest.
    const moved = nearestGoodCell(g, 70, 50, band)!;
    expect(moved.i).toBeLessThan(50);
    expect(moved.j).toBe(50);
    // Pin in forest but too low (top of the grid): moves south, into the band plus margin.
    const up = nearestGoodCell(g, 20, 5, band)!;
    expect(1000 + up.j).toBeGreaterThanOrEqual(band.min + 20);
    // Nothing suitable within reach.
    expect(nearestGoodCell(g, 70, 50, { min: 3000, max: 3100 })).toBeNull();
  });
});

describe('no-picking areas', () => {
  it('skips blocked cells when moving a pin', () => {
    const g = grid((i) => (i < 50 ? 30 : null));
    const band = { min: 1030, max: 1080 };
    const free = nearestGoodCell(g, 70, 50, band)!;
    const avoided = nearestGoodCell(g, 70, 50, band, 1000, 20, (i) => i >= 40)!;
    expect(free.i).toBeGreaterThanOrEqual(40);
    expect(avoided.i).toBeLessThan(40);
  });
});
