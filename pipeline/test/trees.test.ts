import { describe, expect, it } from 'vitest';
import { SITE_GROUPS, currentTreeMix, naturalTrees } from '../terrain/trees.js';

describe('site type → main trees', () => {
  it('every group sums to 1 and groups do not overlap', () => {
    for (const g of SITE_GROUPS)
      expect(Object.values(g.trees).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
    const units = SITE_GROUPS.flatMap((g) =>
      Array.from({ length: g.units[1] - g.units[0] + 1 }, (_, i) => g.units[0] + i),
    );
    expect(new Set(units).size).toBe(units.length);
  });

  it('reads the unit number from SZ and ZH codes', () => {
    expect(naturalTrees('7a', 'Typischer Waldmeister-Buchenwald')?.beech).toBe(0.7);
    expect(naturalTrees('18M', 'Karbonat-Tannen-Buchenwald')?.fir).toBe(0.4);
    expect(naturalTrees('46*', 'Heidelbeer-Tannen-Fichtenwald mit Torfmoos')?.spruce).toBe(0.5);
    expect(naturalTrees('(7d)', 'schlecht ausgebildet')?.beech).toBe(0.7);
    expect(naturalTrees('69', 'Steinrosen-Bergföhrenwald')?.pine).toBe(0.8);
    expect(naturalTrees('AV', 'Grünerlengebüsch')).toEqual({ alder: 1 });
    expect(naturalTrees('ub', 'unbestockt')).toBeNull();
  });

  it('splits the measured conifer share; planted spruce on beech sites', () => {
    const beech = currentTreeMix(naturalTrees('7a'), 40);
    expect(beech.spruce).toBeCloseTo(0.4);
    expect(beech.fir ?? 0).toBe(0);
    expect(beech.beech).toBeCloseTo((0.7 / 0.95) * 0.6);
    const firBeech = currentTreeMix(naturalTrees('18'), 60);
    expect(firBeech.fir).toBeCloseTo(0.6 * 0.8);
    expect(firBeech.spruce).toBeCloseTo(0.6 * 0.2);
    expect(Object.values(firBeech).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
  });
});
