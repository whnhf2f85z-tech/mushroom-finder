import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ParkingFileSchema, SpotsFileSchema } from '@mf/scoring';
import { parkingHtml } from '../src/detail.js';

const ROOT = join(import.meta.dirname, '../..');

describe('parking near spots', () => {
  it('the published file covers every spot, nearest first, within 3 km', () => {
    const file = ParkingFileSchema.parse(
      JSON.parse(readFileSync(join(ROOT, 'web/public/data/static/parking.json'), 'utf8')),
    );
    const spots = SpotsFileSchema.parse(
      JSON.parse(readFileSync(join(ROOT, 'data/spots.json'), 'utf8')),
    ).spots;
    for (const s of spots) {
      const list = file.spots[s.id];
      expect(list, s.id).toBeDefined();
      expect(list!.length).toBeLessThanOrEqual(3);
      expect(list!.map((p) => p.distanceM)).toEqual(
        [...list!.map((p) => p.distanceM)].sort((a, b) => a - b),
      );
      for (const p of list!) expect(p.distanceM).toBeLessThanOrEqual(3000);
    }
  });

  it('describes each place with its facts and a directions link', () => {
    const html = parkingHtml([
      {
        lat: 47.02,
        lon: 8.71,
        distanceM: 835,
        name: 'Roggen',
        fee: 'yes',
        capacity: 40,
        access: null,
        kind: 'surface',
        osm: 'way/1',
      },
      {
        lat: 47.03,
        lon: 8.72,
        distanceM: 1536,
        name: null,
        fee: null,
        capacity: null,
        access: 'customers',
        kind: 'street_side',
        osm: 'way/2',
      },
    ]);
    expect(html).toMatch(/<strong>Roggen<\/strong> · paid · about 40 places · 840 m from the spot/);
    expect(html).toMatch(/<strong>Roadside parking<\/strong> · for customers · 1.5 km/);
    expect(html).toMatch(/maps\/dir\/\?api=1&destination=47.02,8.71/);
    expect(html).toMatch(/OpenStreetMap/);
    expect(parkingHtml([])).toMatch(/No public parking mapped within 3 km/);
  });
});
