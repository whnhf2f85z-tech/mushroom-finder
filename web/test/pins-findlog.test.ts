import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SpeciesFileSchema, type FindEntry, type Pin } from '@mf/scoring';
import { CSV_COLUMNS, exportLogCsv, exportLogJson, importLog, sortLog } from '../src/findlog.js';
import { exportPins, importPins, newId } from '../src/pins.js';

const species = SpeciesFileSchema.parse(
  JSON.parse(readFileSync(join(import.meta.dirname, '../../data/species.json'), 'utf8')),
).species;

const pin = (over: Partial<Pin> = {}): Pin => ({
  id: 'pin-a',
  name: 'Mossy slope',
  lat: 47.02,
  lon: 8.71,
  note: '',
  elevation: 1250,
  canton: 'SZ',
  created: '2026-10-20T08:00:00.000Z',
  ...over,
});

const entry = (over: Partial<FindEntry> = {}): FindEntry => ({
  id: 'v1',
  date: '2026-10-18',
  place: {
    kind: 'spot',
    id: 'oberiberg-ybrig',
    name: 'Oberiberg – Ybrig forests',
    lat: 47.035,
    lon: 8.79127,
  },
  species: 'chanterelle',
  found: true,
  quantityG: 350,
  note: 'Under spruce, "lots" of moss, near path',
  score: { value: 64, components: { S: 0.9, M: 0.8, T: 1, F: 1, D: 0.9, H: 1 }, source: 'daily' },
  created: '2026-10-18T15:00:00.000Z',
  ...over,
});

describe('pins', () => {
  it('makes unique ids that pass the schema', () => {
    expect(newId('pin')).toMatch(/^pin-[a-z0-9-]+$/);
    expect(newId('pin')).not.toBe(newId('pin'));
  });

  it('round-trips through export and import, skipping duplicates', () => {
    const text = exportPins([pin(), pin({ id: 'pin-b', lat: 47.3, lon: 8.6, canton: 'ZH' })]);
    const r = importPins([pin()], text);
    expect(r.added).toBe(1);
    expect(r.skipped).toBe(1);
    expect(r.pins.map((p) => p.id)).toEqual(['pin-a', 'pin-b']);
    // A different id at (almost) the same place counts as a duplicate too.
    expect(importPins([pin()], exportPins([pin({ id: 'pin-c', lat: 47.02003 })])).added).toBe(0);
  });

  it('refuses files that are not a pins export', () => {
    expect(() => importPins([], 'nope')).toThrow(/not valid JSON/);
    expect(() => importPins([], '{"kind":"something-else"}')).toThrow(
      /not a Mushroom Finder pins file/,
    );
  });
});

describe('find log', () => {
  it('sorts newest visit first', () => {
    const list = sortLog([
      entry({ id: 'a', date: '2026-10-10' }),
      entry({ id: 'b', date: '2026-10-19' }),
    ]);
    expect(list.map((e) => e.id)).toEqual(['b', 'a']);
  });

  it('exports CSV with a header, escaped text and score components', () => {
    const csv = exportLogCsv(
      [
        entry(),
        entry({
          id: 'v2',
          found: false,
          quantityG: null,
          score: { value: null, components: null, source: 'none' },
        }),
      ],
      species,
    );
    const lines = csv.trim().split('\r\n');
    expect(lines[0]).toBe(CSV_COLUMNS.join(','));
    expect(lines[1]).toContain(
      'Chanterelle,yes,350,"Under spruce, ""lots"" of moss, near path",64,daily,0.9,0.8,1,1,0.9,1',
    );
    expect(lines[2]).toContain(',no,,');
    expect(lines).toHaveLength(3);
  });

  it('round-trips JSON and skips entries it already has', () => {
    const r = importLog([entry()], exportLogJson([entry(), entry({ id: 'v2' })]));
    expect(r.added).toBe(1);
    expect(r.skipped).toBe(1);
    expect(() => importLog([], exportPins([]))).toThrow(/not a Mushroom Finder find log/);
  });
});
