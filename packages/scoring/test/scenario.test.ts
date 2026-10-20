import { describe, expect, it } from 'vitest';
import { scoreSpecies } from '../src/score.js';
import type { DailyWeather } from '../src/types.js';
import { IBERGEREGG, series, sp } from './helpers.js';

/**
 * Synthetic stand-in for the golden test (SPEC §8): dry summer, a rainy spell around 8–12 Oct 2026, then mild.
 * Milestone 2 replaces this with recorded Open-Meteo data for the real autumn 2026.
 */
function autumn2026(endDate: string, elevation: number): DailyWeather[] {
  const end = new Date(`${endDate}T12:00:00Z`);
  return series(endDate, 75, (lag) => {
    const d = new Date(end);
    d.setUTCDate(d.getUTCDate() - lag);
    const month = d.getUTCMonth() + 1;
    const day = d.getUTCDate();
    const rainy = month === 10 && day >= 8 && day <= 12;
    const lapse = (elevation - 1000) * 0.006; // °C cooler per metre
    return {
      precip: rainy ? 12 : month === 10 && day > 12 ? 0.5 : 0.8,
      et0: month === 10 ? 0.8 : 2.5,
      soilMoisture7_28: rainy || (month === 10 && day > 12) ? 0.34 : 0.18,
      tmean: 10 - lapse,
      tmin: 5 - lapse,
      tmax: 15 - lapse,
    };
  });
}

describe('scenario: dry summer, rain around 10 October', () => {
  const ibergeregg = (date: string, id: string) =>
    scoreSpecies(sp(id), autumn2026(date, 1250), IBERGEREGG).score;

  it.each(['chanterelle', 'winter_chanterelle'])(
    '%s at Ibergeregg rises from mid to late October',
    (id) => {
      const before = ibergeregg('2026-10-12', id);
      const after = ibergeregg('2026-10-22', id);
      expect(before).toBeLessThan(30);
      expect(after).toBeGreaterThanOrEqual(40);
      expect(after).toBeGreaterThan(before);
    },
  );

  it('keeps a dry low-elevation Mittelland cell lower', () => {
    const dryLow = series('2026-10-23', 75, () => ({
      precip: 0.3,
      et0: 1.2,
      soilMoisture7_28: 0.17,
      tmean: 12,
      tmin: 7,
    }));
    const mittelland = scoreSpecies(sp('chanterelle'), dryLow, {
      ...IBERGEREGG,
      elevation: 450,
      ph_class: 'neutral',
      conifer_pct: 40,
    });
    expect(mittelland.score).toBeLessThan(ibergeregg('2026-10-23', 'chanterelle'));
    expect(mittelland.score).toBeLessThan(30);
  });
});
