import { describe, expect, it } from 'vitest';
import type { DailyWeather, GridFile } from '@mf/scoring';
import { adjustForElevation, cellHabitat, scoreGrid } from '../src/grid.js';
import { SPECIES, series } from '../../packages/scoring/test/helpers.js';

export function tinyGrid(): GridFile {
  return {
    schemaVersion: 1,
    generatedAt: 'x',
    cellSize: 1000,
    count: 3,
    cells: {
      e: [2697, 2698, 2685],
      n: [1208, 1208, 1248],
      canton: ['SZ', 'SZ', 'ZH'],
      forest: [80, 40, 60],
      conifer: [85, null, 30],
      elevation: [1300, 1000, 600],
      slope: [20, 10, 5],
      aspect: [0, null, 180],
      ph: ['acidic', 'unknown', 'neutral'],
      phSource: ['site_type', 'none', 'geology'],
      site: [0, null, null],
      protected: [0, 2, 0],
      protectedName: [null, 0, null],
      weather: [0, 0, 1],
    },
    siteTypes: [{ code: '46', name: 'Heidelbeer-Tannen-Fichtenwald' }],
    protectedNames: ['Test reserve'],
    weatherPoints: { lat: [47.02, 47.37], lon: [8.71, 8.55], elevation: [1150, 600] },
  };
}

describe('grid scoring', () => {
  it('adjusts temperature with elevation but not rain', () => {
    const w: DailyWeather[] = [
      { date: '2026-10-01', precip: 5, tmin: 2, tmax: 10, tmean: 6, soilTemp0_7: 7 },
    ];
    const up = adjustForElevation(w, 200)[0]!;
    expect(up.tmean).toBeCloseTo(4.7);
    expect(up.soilTemp0_7).toBeCloseTo(5.7);
    expect(up.precip).toBe(5);
  });

  it('builds the habitat of a cell', () => {
    const h = cellHabitat(tinyGrid(), 1);
    expect(h).toMatchObject({
      elevation: 1000,
      ph_class: 'unknown',
      protected: { is: true, noPicking: true },
    });
    expect(h.conifer_pct).toBeUndefined();
  });

  it('scores every cell, species and date; cells without weather stay empty', () => {
    const g = tinyGrid();
    const w = new Map([
      ['wp0', series('2026-10-20', 70, (lag) => ({ precip: lag >= 8 && lag <= 12 ? 9 : 2 }))],
    ]);
    const out = scoreGrid(g, SPECIES, w, ['2026-10-19', '2026-10-20']);
    const day = out.get('2026-10-20')!;
    expect(Object.keys(day)).toHaveLength(SPECIES.length);
    expect(day.chanterelle![0]).toBeGreaterThan(day.chanterelle![1]!); // acidic conifer forest beats unknown/edge
    expect(day.chanterelle![2]).toBeNull(); // point wp1 had no weather
    expect(day.morel!.slice(0, 2)).toEqual([0, 0]);
  });
});
