import { describe, expect, it } from 'vitest';
import reservesJson from '../../../data/reserves.json';
import rulesJson from '../../../data/rules.json';
import spotsJson from '../../../data/spots.json';
import speciesJson from '../../../data/species.json';
import { isClosedDay } from '../src/rules.js';
import {
  ReservesFileSchema,
  RulesFileSchema,
  SpeciesFileSchema,
  SpotsFileSchema,
} from '../src/schemas.js';

const species = SpeciesFileSchema.parse(speciesJson).species;
const spots = SpotsFileSchema.parse(spotsJson).spots;
const rules = RulesFileSchema.parse(rulesJson);

describe('data files', () => {
  it('validate against their schemas', () => {
    expect(ReservesFileSchema.safeParse(reservesJson).success).toBe(true);
    expect(species).toHaveLength(9);
    expect(spots).toHaveLength(14);
  });

  it('have unique ids', () => {
    expect(new Set(species.map((s) => s.id)).size).toBe(species.length);
    expect(new Set(spots.map((s) => s.id)).size).toBe(spots.length);
  });

  it('only reference known species in spot hints', () => {
    const ids = new Set(species.map((s) => s.id));
    for (const spot of spots)
      for (const h of spot.species_hint) expect(ids.has(h), `${spot.id}: ${h}`).toBe(true);
  });

  it('have consistent season and band values', () => {
    for (const s of species) {
      expect(s.temperature.min, s.id).toBeLessThan(s.temperature.max);
      expect(s.rainLag.min, s.id).toBeLessThanOrEqual(s.rainLag.max);
    }
  });

  it('has rules for both cantons, with ZH closed on the 1st–10th', () => {
    expect(isClosedDay(rules, 'ZH', '2026-11-01')).toBe(true);
    expect(isClosedDay(rules, 'ZH', '2026-11-10')).toBe(true);
    expect(isClosedDay(rules, 'ZH', '2026-11-11')).toBe(false);
    expect(isClosedDay(rules, 'SZ', '2026-11-05')).toBe(false);
  });
});
