import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SpeciesFileSchema, scoreSpecies, type DailyWeather, type Habitat } from '@mf/scoring';

/**
 * Golden test (SPEC §8) on real Open-Meteo weather for autumn 2026, recorded with `npm run record:golden`.
 * Dry spell from late September, ~36 mm on 8 Oct and ~10 mm on 10 Oct at Ibergeregg.
 * Recorded on 2026-10-20: the days from 21 Oct are a forecast. Re-record after ~28 Oct for the observed weather.
 */
const ROOT = join(import.meta.dirname, '../..');
const fixture = JSON.parse(
  readFileSync(join(import.meta.dirname, 'fixtures/golden-autumn-2026.json'), 'utf8'),
) as {
  locations: Record<string, { weather: DailyWeather[] }>;
};
const species = SpeciesFileSchema.parse(
  JSON.parse(readFileSync(join(ROOT, 'data/species.json'), 'utf8')),
).species;

const HABITAT: Record<string, Habitat> = {
  // Acidic flysch, spruce-fir, middle of the spot's band.
  ibergeregg: { elevation: 1250, ph_class: 'acidic', conifer_pct: 85 },
  // Low, dry mixed forest; pH not known yet.
  weinland: { elevation: 420, ph_class: 'unknown', conifer_pct: 40 },
};

const score = (loc: string, id: string, date: string): number =>
  scoreSpecies(
    species.find((s) => s.id === id)!,
    fixture.locations[loc]!.weather.filter((d) => d.date <= date),
    HABITAT[loc]!,
  ).score;

const oct = (d: number): string => `2026-10-${String(d).padStart(2, '0')}`;
const range = (a: number, b: number): number[] =>
  Array.from({ length: b - a + 1 }, (_, i) => a + i);

describe('golden: real autumn 2026', () => {
  it('has the expected weather story in the fixture', () => {
    const w = fixture.locations.ibergeregg!.weather;
    const p = (d: number) => w.find((x) => x.date === oct(d))!.precip;
    const dry = range(1, 7).reduce((s, d) => s + p(d), 0);
    expect(dry).toBeLessThan(5);
    expect(p(8) + p(9) + p(10)).toBeGreaterThan(30);
  });

  it.each(['chanterelle', 'winter_chanterelle'])(
    '%s at Ibergeregg rises from low to good after the rain',
    (id) => {
      const before = score('ibergeregg', id, oct(10));
      const peak = Math.max(...range(14, 24).map((d) => score('ibergeregg', id, oct(d))));
      expect(before).toBeLessThan(40); // "low" band
      expect(peak).toBeGreaterThanOrEqual(60); // "good" band
    },
  );

  it.each(['chanterelle', 'winter_chanterelle'])(
    '%s responds with a delay, not on the day of the rain',
    (id) => {
      // Two days after the storm, the score has barely moved; it climbs from ~6 days after.
      expect(score('ibergeregg', id, oct(10)) - score('ibergeregg', id, oct(7))).toBeLessThan(10);
      expect(score('ibergeregg', id, oct(16)) - score('ibergeregg', id, oct(10))).toBeGreaterThan(
        20,
      );
    },
  );

  it('keeps winter chanterelle into late October while frost-sensitive chanterelle fades', () => {
    expect(score('ibergeregg', 'winter_chanterelle', oct(26))).toBeGreaterThanOrEqual(50);
    expect(score('ibergeregg', 'chanterelle', oct(26))).toBeLessThan(
      score('ibergeregg', 'chanterelle', oct(17)) - 30,
    );
  });

  // During the flush. From ~23 Oct the forecast cools Ibergeregg to ~3 °C and the milder lowlands can overtake it.
  it.each(['chanterelle', 'winter_chanterelle'])(
    'keeps the dry low Weinland lower for %s during the flush',
    (id) => {
      for (const d of range(14, 22))
        expect(score('weinland', id, oct(d)), oct(d)).toBeLessThan(score('ibergeregg', id, oct(d)));
    },
  );
});
