import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ReservesFileSchema, SpotsFileSchema } from '@mf/scoring';
import { groupSpots, toKml, toText } from '../src/export.js';

const ROOT = join(import.meta.dirname, '../..');
const spots = SpotsFileSchema.parse(
  JSON.parse(readFileSync(join(ROOT, 'data/spots.json'), 'utf8')),
).spots;
const reserves = ReservesFileSchema.parse(
  JSON.parse(readFileSync(join(ROOT, 'data/reserves.json'), 'utf8')),
).reserves;

describe('spot export', () => {
  it('puts every spot into exactly one of the original folders', () => {
    const groups = groupSpots(spots);
    expect(groups.map((g) => g.spots.length)).toEqual([6, 4, 4]);
    expect(groups.flatMap((g) => g.spots)).toHaveLength(spots.length);
  });

  it('writes valid-looking KML with the original folders and styles', () => {
    const kml = toKml(spots, reserves);
    expect(kml.match(/<Folder>/g)).toHaveLength(4);
    expect(kml.match(/<Placemark>/g)).toHaveLength(spots.length + reserves.length);
    for (const id of ['eierschwamm', 'steinpilz', 'buche', 'achtung'])
      expect(kml).toContain(`<Style id="${id}">`);
    expect(kml).toContain('<coordinates>8.70945,47.01929,0</coordinates>');
    expect(kml).toContain('Eierschwämme &amp; Trompetenpfifferlinge');
    expect(kml).not.toMatch(/&(?!amp;|lt;|gt;|quot;)/);
  });

  it('writes one line per spot with name, band and coordinates', () => {
    const txt = toText(spots, reserves, '2026-10-20');
    expect(txt).toContain('- Ibergeregg – Alpthal side | 1100–1400 m | 47.01929, 8.70945');
    expect(txt.split('\n').filter((l) => l.startsWith('- '))).toHaveLength(
      spots.length + reserves.length,
    );
  });
});
