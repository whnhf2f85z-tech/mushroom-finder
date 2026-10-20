import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  HabitatFileSchema,
  SpeciesFileSchema,
  scoreSpecies,
  type DailyWeather,
  type Habitat,
} from '@mf/scoring';

/**
 * Golden test (SPEC §8) on real Open-Meteo weather for autumn 2026, recorded with `npm run record:golden`.
 * Dry spell from late September, heavy rain on 8 Oct and more on 10 Oct at Ibergeregg.
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

// Ibergeregg – Alpthal side as built from the official data (habitat build): limestone fir-beech forest
// (18M Karbonat-Tannen-Buchenwald), ~40 % conifers, 1,377 m. The fixture is recorded at the same pin and height.
const ib = HabitatFileSchema.parse(
  JSON.parse(readFileSync(join(ROOT, 'web/public/data/static/habitat.json'), 'utf8')),
).spots['ibergeregg-alpthal']!;

const HABITAT: Record<string, Habitat> = {
  ibergeregg: {
    elevation: ib.elevation,
    ph_class: ib.ph_class,
    forest_pct: ib.forest_pct,
    ...(ib.conifer_pct !== null ? { conifer_pct: ib.conifer_pct } : {}),
    ...(ib.aspect !== null ? { aspect: ib.aspect } : {}),
    ...(ib.slope !== null ? { slope: ib.slope } : {}),
  },
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
const peak = (loc: string, id: string) =>
  Math.max(...range(14, 24).map((d) => score(loc, id, oct(d))));

describe('golden: real autumn 2026', () => {
  it('has the expected weather story and habitat', () => {
    const w = fixture.locations.ibergeregg!.weather;
    const p = (d: number) => w.find((x) => x.date === oct(d))!.precip;
    const dry = range(1, 7).reduce((s, d) => s + p(d), 0);
    expect(dry).toBeLessThan(10);
    expect(p(8) + p(9) + p(10)).toBeGreaterThan(30);
    expect(ib.ph_class).toBe('calcareous');
  });

  // On limestone the acid-loving chanterelles rise from low to medium only; the soil keeps them out of "good".
  it.each(['chanterelle', 'winter_chanterelle'])(
    '%s at Ibergeregg rises from low to medium after the rain',
    (id) => {
      expect(score('ibergeregg', id, oct(10))).toBeLessThan(25);
      expect(peak('ibergeregg', id)).toBeGreaterThanOrEqual(40);
      expect(peak('ibergeregg', id)).toBeLessThan(60);
    },
  );

  it('shows the full weather signal for a species that does not mind the soil', () => {
    expect(score('ibergeregg', 'hedgehog', oct(10))).toBeLessThan(40);
    expect(peak('ibergeregg', 'hedgehog')).toBeGreaterThanOrEqual(60);
  });

  it.each(['chanterelle', 'winter_chanterelle', 'hedgehog'])(
    '%s responds with a delay, not on the day of the rain',
    (id) => {
      expect(score('ibergeregg', id, oct(10)) - score('ibergeregg', id, oct(7))).toBeLessThan(10);
      expect(score('ibergeregg', id, oct(17)) - score('ibergeregg', id, oct(10))).toBeGreaterThan(
        15,
      );
    },
  );

  it('keeps winter chanterelle into late October while frost-sensitive chanterelle fades', () => {
    expect(score('ibergeregg', 'winter_chanterelle', oct(26))).toBeGreaterThan(
      2 * score('ibergeregg', 'chanterelle', oct(26)),
    );
    expect(score('ibergeregg', 'chanterelle', oct(26))).toBeLessThan(
      peak('ibergeregg', 'chanterelle') - 30,
    );
  });

  // During the flush. Not for chanterelle: Weinland's soil is "unknown" (scored as average) while Ibergeregg's is
  // mapped limestone, so that comparison is not like for like.
  it.each(['winter_chanterelle', 'hedgehog'])(
    'keeps the dry low Weinland lower for %s during the flush',
    (id) => {
      for (const d of range(14, 22))
        expect(score('weinland', id, oct(d)), oct(d)).toBeLessThan(score('ibergeregg', id, oct(d)));
    },
  );
});
