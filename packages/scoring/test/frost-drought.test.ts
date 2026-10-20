import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG as cfg } from '../src/config.js';
import { droughtFactor } from '../src/drought.js';
import { frostFactor } from '../src/frost.js';
import { series, sp } from './helpers.js';

const END = '2026-10-23';

describe('frost F', () => {
  it('is 1 without frost', () => {
    expect(frostFactor(series(END, 30), sp('chanterelle'), cfg).F).toBe(1);
  });

  it('brings sensitive species close to 0 after two hard frosts', () => {
    const w = series(END, 30, (lag) => ({ tmin: lag === 1 || lag === 3 ? -5 : 4 }));
    const r = frostFactor(w, sp('chanterelle'), cfg);
    expect(r.hardFrostNights).toBe(2);
    expect(r.F).toBeLessThan(0.1);
  });

  it('penalises cold-tolerant species less', () => {
    const w = series(END, 30, (lag) => ({ tmin: lag <= 2 ? -2 : 4 }));
    const sensitive = frostFactor(w, sp('chanterelle'), cfg);
    const tolerant = frostFactor(w, sp('winter_chanterelle'), cfg);
    expect(sensitive.frostNights).toBe(3);
    expect(tolerant.F).toBeGreaterThan(sensitive.F);
    expect(tolerant.F).toBeGreaterThan(0.8);
  });

  it('only looks at the last 7 days', () => {
    const w = series(END, 30, (lag) => ({ tmin: lag >= 8 ? -6 : 4 }));
    expect(frostFactor(w, sp('chanterelle'), cfg).F).toBe(1);
  });
});

describe('drought D', () => {
  it('is 1 with normal rain', () => {
    expect(
      droughtFactor(
        series(END, 60, () => ({ precip: 5 })),
        1000,
        cfg,
      ).D,
    ).toBe(1);
  });

  it('bottoms out at 0.6 after a very dry period', () => {
    expect(
      droughtFactor(
        series(END, 60, () => ({ precip: 0 })),
        1000,
        cfg,
      ).D,
    ).toBe(0.6);
  });

  it('is in between for a moderately dry period', () => {
    const D = droughtFactor(
      series(END, 60, () => ({ precip: 2 })),
      1000,
      cfg,
    ).D;
    expect(D).toBeGreaterThan(0.6);
    expect(D).toBeLessThan(1);
  });
});
