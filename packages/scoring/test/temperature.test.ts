import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG as cfg } from '../src/config.js';
import { coolingTrigger, temperatureScore } from '../src/temperature.js';
import { series, sp } from './helpers.js';

const END = '2026-10-23';

describe('temperature T', () => {
  it('is 1 inside the band', () => {
    const w = series(END, 30, () => ({ tmean: 14 }));
    expect(temperatureScore(w, sp('chanterelle'), cfg).T).toBe(1);
  });

  it('falls off smoothly outside the band and reaches 0 beyond the tail', () => {
    const ch = sp('chanterelle'); // 10–20 °C, tail 6
    const t7 = temperatureScore(
      series(END, 30, () => ({ tmean: 7 })),
      ch,
      cfg,
    ).T;
    const t2 = temperatureScore(
      series(END, 30, () => ({ tmean: 2 })),
      ch,
      cfg,
    ).T;
    expect(t7).toBeCloseTo(0.5);
    expect(t2).toBe(0);
  });

  it('detects a cooling trigger after warm weather', () => {
    const w = series(END, 30, (lag) => ({ tmean: lag <= 2 ? 10 : 16 }));
    expect(coolingTrigger(w, cfg)).toBe(true);
    expect(
      coolingTrigger(
        series(END, 30, () => ({ tmean: 12 })),
        cfg,
      ),
    ).toBe(false);
  });

  it('adds the cooling bonus for porcini only', () => {
    // 7-day mean ≈ 8.6 °C, just below the porcini band, so the bonus is not capped.
    const w = series(END, 30, (lag) => ({ tmean: lag <= 2 ? 4 : 12 }));
    const porcini = temperatureScore(w, sp('porcini'), cfg);
    const noBonus = temperatureScore(w, { ...sp('porcini'), coolingBonus: 0 }, cfg);
    expect(porcini.coolingTrigger).toBe(true);
    expect(porcini.T - noBonus.T).toBeCloseTo(0.15);
  });

  it('uses soil temperature for morels and falls back to air when missing', () => {
    const m = sp('morel');
    const soil = temperatureScore(
      series('2026-04-10', 30, () => ({ tmean: 4, soilTemp0_7: 10 })),
      m,
      cfg,
    );
    expect(soil.tempSource).toBe('soil');
    expect(soil.T).toBe(1);
    const air = temperatureScore(
      series('2026-04-10', 30, () => ({ tmean: 4, soilTemp0_7: undefined })),
      m,
      cfg,
    );
    expect(air.tempSource).toBe('air');
    expect(air.soilFallback).toBe(true);
  });
});
