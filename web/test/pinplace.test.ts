import { describe, expect, it } from 'vitest';
import { lv95ToWgs84 } from '@mf/scoring';
import { nearestCell, pinHabitat, reserveAt } from '../src/pinplace.js';
import { tinyGrid } from '../../pipeline/test/grid-scoring.test.js';

const square = {
  properties: { name: 'Test reserve', noPicking: true },
  geometry: {
    type: 'Polygon',
    coordinates: [
      [
        [8.7, 47.0],
        [8.72, 47.0],
        [8.72, 47.02],
        [8.7, 47.02],
        [8.7, 47.0],
      ],
    ],
  },
};

describe('pin place', () => {
  it('finds the reserve a pin is in, preferring no-picking areas', () => {
    const soft = { ...square, properties: { name: 'Moor', noPicking: false } };
    expect(reserveAt([soft, square], 47.01, 8.71)).toEqual({
      name: 'Test reserve',
      noPicking: true,
    });
    expect(reserveAt([soft], 47.01, 8.71)).toEqual({ name: 'Moor', noPicking: false });
    expect(reserveAt([square], 47.05, 8.71)).toBeNull();
  });

  it('takes habitat from the nearest forest square within 1.5 km and its own elevation', () => {
    const g = tinyGrid();
    const c0 = lv95ToWgs84(2697500, 1208500); // centre of cell 0
    const near = nearestCell(g, c0.lat, c0.lon)!;
    expect(near.i).toBe(0);
    const h = pinHabitat(g, { lat: c0.lat, lon: c0.lon, elevation: 1340 }, null);
    expect(h.habitat).toMatchObject({ elevation: 1340, ph_class: 'acidic', conifer_pct: 85 });
    expect(h.entry.site_type_name).toBe('Heidelbeer-Tannen-Fichtenwald');
    expect(h.cellKm).toBeLessThan(0.2);
  });

  it('falls back to unknown habitat far from any forest square', () => {
    const h = pinHabitat(tinyGrid(), { lat: 47.6, lon: 8.9, elevation: 450 }, null);
    expect(h.habitat.ph_class).toBe('unknown');
    expect(h.habitat.conifer_pct).toBeUndefined();
    expect(h.cellKm).toBeNull();
  });
});
