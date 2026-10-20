import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  GridDayFileSchema,
  GridFileSchema,
  HistoryFileSchema,
  LatestFileSchema,
  decodeScores,
} from '@mf/scoring';

/** Checks the generated files in web/public/data (run in CI and after the daily job, before committing). */
const DIR = join(import.meta.dirname, '../../web/public/data');
const MAX_BYTES = 300 * 1024;
const exists = (p: string) => {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
};

describe.skipIf(!exists(join(DIR, 'latest.json')))('published data', () => {
  it('latest.json is valid and small enough', () => {
    const path = join(DIR, 'latest.json');
    expect(statSync(path).size).toBeLessThan(MAX_BYTES);
    const latest = LatestFileSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
    expect(Object.keys(latest.spots).length).toBeGreaterThan(0);
  });

  it('every history file is valid, named after its date, and at most 30 are kept', () => {
    const files = readdirSync(join(DIR, 'history')).filter((f) => f.endsWith('.json'));
    expect(files.length).toBeGreaterThan(0);
    expect(files.length).toBeLessThanOrEqual(30);
    for (const f of files) {
      const path = join(DIR, 'history', f);
      expect(statSync(path).size).toBeLessThan(MAX_BYTES);
      const h = HistoryFileSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
      expect(`${h.date}.json`).toBe(f);
    }
  });

  it('grid files match the grid and stay small', () => {
    const gridPath = join(DIR, 'static', 'grid.json');
    if (!exists(gridPath)) return;
    const grid = GridFileSchema.parse(JSON.parse(readFileSync(gridPath, 'utf8')));
    const latest = LatestFileSchema.parse(
      JSON.parse(readFileSync(join(DIR, 'latest.json'), 'utf8')),
    );
    expect(latest.grid?.count).toBe(grid.count);
    for (const d of [...latest.days, ...latest.forecastDays]) {
      const path = join(DIR, 'grid', `${d}.json`);
      expect(exists(path), d).toBe(true);
      expect(statSync(path).size).toBeLessThan(MAX_BYTES);
      const day = GridDayFileSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
      expect(day.count).toBe(grid.count);
      for (const v of Object.values(day.species)) expect(decodeScores(v)).toHaveLength(grid.count);
    }
  });
});
