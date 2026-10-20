import { describe, expect, it } from 'vitest';
import { bandFor } from '../src/bands.js';
import { DEFAULT_CONFIG } from '../src/config.js';
import { scoreLocation, scoreSpecies } from '../src/score.js';
import { IBERGEREGG, SPECIES, series, sp } from './helpers.js';

const END = '2026-10-23';
/** Good autumn conditions: normal rain, ~45 mm 8–12 days ago, wet soil for two weeks, mild, no frost. */
const good = series(END, 60, (lag) => ({
  precip: lag >= 8 && lag <= 12 ? 9 : lag > 30 ? 5 : 1,
  soilMoisture7_28: lag <= 16 ? 0.36 : 0.25,
  tmean: 11,
  tmin: 6,
}));

describe('scoreSpecies', () => {
  it('gives a high score with good weather and habitat', () => {
    const r = scoreSpecies(sp('winter_chanterelle'), good, IBERGEREGG);
    expect(r.score).toBeGreaterThanOrEqual(80);
    expect(r.confidence).toBe('high');
  });

  it('keeps every component in range and the score 0–100', () => {
    for (const s of SPECIES) {
      const r = scoreSpecies(s, good, IBERGEREGG);
      for (const v of Object.values(r.components)) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
      expect(Number.isInteger(r.score)).toBe(true);
      expect(r.score).toBeGreaterThanOrEqual(0);
      expect(r.score).toBeLessThanOrEqual(100);
    }
  });

  it('marks morels as out of season in autumn', () => {
    const r = scoreSpecies(sp('morel'), good, { ...IBERGEREGG, elevation: 600 });
    expect(r.score).toBe(0);
    expect(r.outOfSeason).toBe(true);
  });

  it('is low after a dry spell', () => {
    const dry = series(END, 60, () => ({ precip: 0, soilMoisture7_28: 0.15, tmean: 11 }));
    expect(scoreSpecies(sp('chanterelle'), dry, IBERGEREGG).score).toBeLessThan(20);
  });

  it('stays low in a bone-dry forest even at a perfect temperature', () => {
    const dry = series(END, 60, () => ({ precip: 0, soilMoisture7_28: undefined, tmean: 12 }));
    expect(scoreSpecies(sp('winter_chanterelle'), dry, IBERGEREGG).score).toBe(0);
    const additive = { ...DEFAULT_CONFIG, combine: 'additive' as const };
    expect(
      scoreSpecies(sp('winter_chanterelle'), dry, IBERGEREGG, {}, additive).score,
    ).toBeGreaterThanOrEqual(20);
  });

  it('is near 0 after two hard frosts for a sensitive species', () => {
    const frosty = good.map((d, i) => (i >= good.length - 3 ? { ...d, tmin: -5 } : d));
    expect(scoreSpecies(sp('porcini'), frosty, IBERGEREGG).score).toBeLessThan(10);
  });

  it('lowers confidence with missing habitat and weather data', () => {
    const sparse = series(END, 20, () => ({ soilMoisture7_28: undefined }));
    const r = scoreSpecies(
      sp('chanterelle'),
      sparse,
      { elevation: 1200, ph_class: 'unknown' },
      { weatherDistanceKm: 5 },
    );
    expect(r.confidence).toBe('low');
    expect(r.confidenceIssues).toEqual(
      expect.arrayContaining([
        'ph_unknown',
        'conifer_unknown',
        'no_soil_moisture',
        'short_weather_history',
        'weather_far',
      ]),
    );
  });

  it('throws on empty weather', () => {
    expect(() => scoreSpecies(sp('chanterelle'), [], IBERGEREGG)).toThrow();
  });
});

describe('scoreLocation', () => {
  it('uses the best species as the metascore', () => {
    const r = scoreLocation(SPECIES, good, IBERGEREGG);
    const max = Math.max(...r.species.map((s) => s.score));
    expect(r.metascore).toBe(max);
    expect(r.species.find((s) => s.speciesId === r.bestSpeciesId)?.score).toBe(max);
    expect(r.date).toBe(END);
  });

  it('can be limited to selected species', () => {
    const r = scoreLocation(SPECIES, good, IBERGEREGG, {}, undefined, ['morel']);
    expect(r.species).toHaveLength(1);
    expect(r.metascore).toBe(0);
  });

  it('flags protected locations without zeroing them', () => {
    const r = scoreLocation(SPECIES, good, {
      ...IBERGEREGG,
      protected: { is: true, name: 'Test' },
    });
    expect(r.protected).toBe(true);
    expect(r.metascore).toBeGreaterThan(0);
  });
});

describe('colour bands', () => {
  it('maps scores to the five bands', () => {
    expect(bandFor(0).label).toBe('Very low');
    expect(bandFor(19).label).toBe('Very low');
    expect(bandFor(20).label).toBe('Low');
    expect(bandFor(59).label).toBe('Medium');
    expect(bandFor(60).label).toBe('Good');
    expect(bandFor(100).label).toBe('Very good');
    expect(bandFor(140).label).toBe('Very good');
  });
});
