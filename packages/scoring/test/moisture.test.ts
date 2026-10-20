import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG as cfg } from '../src/config.js';
import { effectiveRain, lagWeight, moistureScore, soilMoistureScore } from '../src/moisture.js';
import { series, sp } from './helpers.js';

const ch = sp('chanterelle');
const END = '2026-10-23';

describe('lag kernel', () => {
  it('is 1 inside the window and ramps outside', () => {
    expect(lagWeight(10, { min: 7, max: 14 }, 4)).toBe(1);
    expect(lagWeight(5, { min: 7, max: 14 }, 4)).toBe(0.5);
    expect(lagWeight(0, { min: 7, max: 14 }, 4)).toBe(0);
    expect(lagWeight(20, { min: 7, max: 14 }, 4)).toBe(0);
  });
});

describe('moisture M', () => {
  it('is low with no rain and dry soil', () => {
    const w = series(END, 60, () => ({ precip: 0, soilMoisture7_28: 0.15 }));
    const m = moistureScore(w, ch, cfg);
    expect(m.effectiveRainMm).toBe(0);
    expect(m.M).toBeLessThan(0.05);
  });

  it('does not give a high score for a single storm', () => {
    const w = series(END, 60, (lag) => ({ precip: lag === 10 ? 80 : 0, et0: 0 }));
    const m = moistureScore(w, ch, cfg);
    expect(m.effectiveRainMm).toBe(cfg.moisture.maxDailyRainMm);
    expect(m.rainScore).toBeLessThanOrEqual(0.5);
  });

  it('gives a full rain score for ~45 mm spread over the window', () => {
    const w = series(END, 60, (lag) => ({ precip: lag >= 8 && lag <= 12 ? 9 : 0, et0: 0 }));
    expect(moistureScore(w, ch, cfg).rainScore).toBe(1);
  });

  it('ignores rain that fell only yesterday', () => {
    const w = series(END, 60, (lag) => ({ precip: lag <= 1 ? 30 : 0, et0: 0 }));
    expect(effectiveRain(w, ch, cfg)).toBe(0);
  });

  it('subtracts part of ET0', () => {
    const wet = series(END, 60, (lag) => ({ precip: lag >= 8 && lag <= 12 ? 6 : 0, et0: 0 }));
    const sunny = series(END, 60, (lag) => ({ precip: lag >= 8 && lag <= 12 ? 6 : 0, et0: 4 }));
    expect(effectiveRain(sunny, ch, cfg)).toBeLessThan(effectiveRain(wet, ch, cfg));
  });

  it('normalises soil moisture to the 60-day range, with the rain delay', () => {
    const wetInWindow = series(END, 60, (lag) => ({ soilMoisture7_28: lag <= 20 ? 0.35 : 0.2 }));
    expect(soilMoistureScore(wetInWindow, ch, cfg)).toBe(1);
    const wetToday = series(END, 60, (lag) => ({ soilMoisture7_28: lag <= 1 ? 0.35 : 0.2 }));
    expect(soilMoistureScore(wetToday, ch, cfg)).toBe(0);
  });

  it('falls back to absolute soil moisture when the range is flat', () => {
    const w = series(END, 60, () => ({ soilMoisture7_28: 0.275 }));
    expect(soilMoistureScore(w, ch, cfg)).toBeCloseTo(0.5);
  });

  it('uses only rain when soil moisture is missing', () => {
    const w = series(END, 60, () => ({ soilMoisture7_28: undefined }));
    const m = moistureScore(w, ch, cfg);
    expect(m.soilScore).toBeNull();
    expect(m.M).toBe(m.rainScore);
  });
});
