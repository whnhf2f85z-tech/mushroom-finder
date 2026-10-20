import { describe, expect, it } from 'vitest';
import { seasonScore, shiftedSeason } from '../src/season.js';
import { dayOfYear } from '../src/util.js';
import { sp } from './helpers.js';

describe('dayOfYear', () => {
  it('ignores leap years', () => {
    expect(dayOfYear('2026-01-01')).toBe(1);
    expect(dayOfYear('2028-03-01')).toBe(60);
    expect(dayOfYear('2028-02-29')).toBe(59);
    expect(dayOfYear('12-31')).toBe(365);
  });
});

describe('season S', () => {
  const ch = sp('chanterelle');

  it('is 1 in the peak and 0 out of season', () => {
    expect(seasonScore(ch, '2026-08-15', 1000)).toBe(1);
    expect(seasonScore(ch, '2026-02-01', 1000)).toBe(0);
  });

  it('ramps up and down between the season points', () => {
    const s = seasonScore(ch, '2026-06-12', 1000);
    expect(s).toBeGreaterThan(0);
    expect(s).toBeLessThan(1);
  });

  it('starts earlier higher up for autumn species', () => {
    const [aLow] = shiftedSeason(ch, 600);
    const [aHigh] = shiftedSeason(ch, 1400);
    expect(aLow - aHigh).toBeCloseTo(32); // 8 × 100 m × 4 days
  });

  it('starts later higher up for morels', () => {
    const m = sp('morel');
    expect(seasonScore(m, '2026-03-10', 400)).toBeGreaterThan(seasonScore(m, '2026-03-10', 1000));
  });

  it('gives morels 0 in autumn', () => {
    expect(seasonScore(sp('morel'), '2026-10-22', 500)).toBe(0);
  });

  it('keeps chanterelles in season at Ibergeregg in late October', () => {
    const s = seasonScore(ch, '2026-10-23', 1250);
    expect(s).toBeGreaterThan(0.3);
    expect(s).toBeLessThan(1);
  });

  it('handles a season ending on 31 December', () => {
    const w = sp('winter_chanterelle');
    expect(seasonScore(w, '2026-11-01', 1000)).toBe(1);
    expect(seasonScore(w, '2026-12-20', 1000)).toBeGreaterThan(0);
    expect(seasonScore(w, '2026-01-15', 1000)).toBe(0);
  });
});
