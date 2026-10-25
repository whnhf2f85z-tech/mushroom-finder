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
    expect(species).toHaveLength(10);
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

describe('species safety data', () => {
  const sp = (id: string) => species.find((s) => s.id === id)!;
  const names = (id: string) =>
    sp(id)
      .lookalikes.map((l) => `${l.name} ${l.latin}`)
      .join(' | ');

  it('names the key dangerous look-alikes', () => {
    expect(names('parasol')).toMatch(/Amanita phalloides/);
    expect(names('parasol')).toMatch(/Lepiota/);
    expect(names('morel')).toMatch(/Gyromitra/);
    expect(names('chanterelle')).toMatch(/Hygrophoropsis/);
    expect(names('honey_fungus')).toMatch(/Galerina/);
    expect(names('stump_puffball')).toMatch(/Amanita phalloides/);
    expect(names('stump_puffball')).toMatch(/Scleroderma/);
    expect(sp('parasol').lookalikes.some((l) => l.danger === 'deadly')).toBe(true);
  });

  it('warns that honey fungus and morels must be cooked thoroughly', () => {
    expect(sp('honey_fungus').safety).toMatch(/cooked thoroughly/);
    expect(sp('morel').safety).toMatch(/cooked thoroughly/);
  });

  it('never explains how to tell look-alikes apart', () => {
    for (const s of species)
      for (const l of s.lookalikes)
        expect(`${l.name} ${l.latin}`, s.id).not.toMatch(
          /pores|cap\b.*like|gills|smell|colour|color/i,
        );
  });
});

describe('species photos', () => {
  it('has one openly licensed, credited photo of each edible species (never of a look-alike)', async () => {
    const { existsSync } = await import('node:fs');
    const { join } = await import('node:path');
    for (const s of species) {
      expect(s.photo, s.id).toBeDefined();
      const p = s.photo!;
      expect(existsSync(join(import.meta.dirname, '../../../web/public', p.file)), p.file).toBe(
        true,
      );
      expect(p.license, s.id).toMatch(/^(CC BY(-SA)? [0-9.]+|CC0|Public domain)$/);
      expect(p.author.length, s.id).toBeGreaterThan(1);
      // The photo shows the species itself (for genera: one of its species), not a look-alike.
      expect(p.shows.split(' ')[0], s.id).toBe(s.latin.split(' ')[0]);
      for (const l of s.lookalikes) expect(l.latin.includes(p.shows), s.id).toBe(false);
    }
  });
});
