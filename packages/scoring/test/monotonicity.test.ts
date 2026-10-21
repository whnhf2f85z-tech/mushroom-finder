import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../src/config.js';
import { habitatScore, hostFromMix } from '../src/habitat.js';
import type { Tree } from '../src/trees.js';
import { scoreSpecies } from '../src/score.js';
import { seasonScore } from '../src/season.js';
import type { Species } from '../src/schemas.js';
import type { DailyWeather, Habitat } from '../src/types.js';
import { SPECIES, series } from './helpers.js';

/**
 * Validation Part C, sanity checks: for every species, the score moves the right way when one input changes and
 * everything else stays put. Base case: the middle of the peak season, mid-band temperature and elevation, rain in
 * the lag window, a fully known habitat inside the preferred ranges.
 */

const midPeak = (s: Species) => {
  const doy = (md: string) => {
    const [m, d] = md.split('-').map(Number) as [number, number];
    return Math.round((Date.UTC(2026, m - 1, d) - Date.UTC(2026, 0, 1)) / 86_400_000);
  };
  const mid = Math.round((doy(s.season.peakStart) + doy(s.season.peakEnd)) / 2);
  return new Date(Date.UTC(2026, 0, 1 + mid)).toISOString().slice(0, 10);
};
const midOf = (r: { min: number; max: number }) => (r.min + r.max) / 2;
const bestPh = (s: Species) =>
  (['acidic', 'neutral', 'calcareous'] as const).reduce((a, b) => (s.ph[b] > s.ph[a] ? b : a));
const habitat = (s: Species): Habitat => ({
  elevation: s.elevationShift.referenceElevation,
  forest_pct: midOf(s.forest_pct),
  conifer_pct: 40,
  ph_class: bestPh(s),
  protected: { is: false },
});

interface Knobs {
  /** Rain per day inside the lag window, mm (default: 1.5 × the species' full rain, spread over the window). */
  rain?: number;
  /** Air (and soil) temperature, °C (default: middle of the species' band). */
  temp?: number;
  /** Soil moisture 7–28 cm, m³/m³ (on the days of the lag window; 0.25 elsewhere). */
  soil: number;
  /** Frost nights (tmin −2 °C) in the last week, counted from the target day back. */
  frostNights: number;
  /** Rain per day outside the lag window, mm (sets the 60-day total for the drought factor). */
  background: number;
}
const BASE: Knobs = { soil: 0.35, frostNights: 0, background: 1 };

function weather(s: Species, k: Knobs): DailyWeather[] {
  const t = k.temp ?? midOf(s.temperature);
  const rain = k.rain ?? (1.5 * s.fullRainMm) / (s.rainLag.max - s.rainLag.min + 1);
  return series(midPeak(s), 90, (lag) => {
    const inLag = lag >= s.rainLag.min && lag <= s.rainLag.max;
    const frost = lag < k.frostNights;
    return {
      precip: inLag ? rain : k.background,
      tmean: t,
      tmin: frost ? -2 : t - 4,
      tmax: t + 4,
      soilTemp0_7: t,
      soilMoisture7_28: inLag ? k.soil : 0.25,
      et0: 1,
    };
  });
}
const score = (s: Species, k: Partial<Knobs> = {}, h: Partial<Habitat> = {}) =>
  scoreSpecies(s, weather(s, { ...BASE, ...k }), { ...habitat(s), ...h });

const nonDecreasing = (xs: number[]) => xs.every((x, i) => i === 0 || x >= xs[i - 1]! - 1e-9);
const nonIncreasing = (xs: number[]) => xs.every((x, i) => i === 0 || x <= xs[i - 1]! + 1e-9);
/** Rises (or stays) to a single top, then falls (or stays): no second hump. */
const unimodal = (xs: number[]) => {
  const top = xs.indexOf(Math.max(...xs));
  return nonDecreasing(xs.slice(0, top + 1)) && nonIncreasing(xs.slice(top));
};

describe.each(SPECIES.map((s) => [s.id, s] as const))('sanity: %s', (_id, s) => {
  it('base case is a good day (score ≥ 50) and every score is an integer 0–100', () => {
    const r = score(s);
    expect(r.score).toBeGreaterThanOrEqual(50);
    for (const rain of [0, 2, 10, 40])
      for (const temp of [-5, 5, 15, 25]) {
        const x = score(s, { rain, temp }).score;
        expect(Number.isInteger(x) && x >= 0 && x <= 100).toBe(true);
      }
  });

  it('more rain in the lag window never lowers M or the score', () => {
    const rs = [0, 0.5, 1, 2, 3, 5, 8, 12, 20, 30, 50].map((rain) => score(s, { rain }));
    expect(nonDecreasing(rs.map((r) => r.components.M))).toBe(true);
    expect(nonDecreasing(rs.map((r) => r.score))).toBe(true);
    expect(rs[0]!.score).toBeLessThan(rs.at(-1)!.score);
  });

  it('wetter soil never lowers M', () => {
    const rs = [0.26, 0.28, 0.3, 0.33, 0.36, 0.4].map((soil) => score(s, { soil }));
    expect(nonDecreasing(rs.map((r) => r.components.M))).toBe(true);
  });

  it('more frost nights never raise F or the score', () => {
    const rs = [0, 1, 2, 3, 5, 7].map((frostNights) => score(s, { frostNights }));
    expect(nonIncreasing(rs.map((r) => r.components.F))).toBe(true);
    expect(nonIncreasing(rs.map((r) => r.score))).toBe(true);
  });

  it('a wetter 60 days never lowers the drought factor', () => {
    const ds = [0, 0.5, 1, 2, 3, 5].map((background) => score(s, { background }).components.D);
    expect(nonDecreasing(ds)).toBe(true);
    expect(ds[0]).toBeLessThan(1);
  });

  it('temperature has one optimum (no second hump)', () => {
    const ts = Array.from({ length: 36 }, (_, i) => -5 + i);
    expect(unimodal(ts.map((temp) => score(s, { temp }).components.T))).toBe(true);
  });

  it('season score has one plateau over the year', () => {
    const days = Array.from({ length: 365 }, (_, i) =>
      new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10),
    );
    expect(unimodal(days.map((d) => seasonScore(s, d, s.elevationShift.referenceElevation)))).toBe(
      true,
    );
  });

  it('habitat: further outside the elevation range never helps', () => {
    const h = habitat(s);
    const up = [0, 100, 200, 300, 500].map(
      (d) => habitatScore({ ...h, elevation: s.elevation.max + d }, s, 1, DEFAULT_CONFIG).H,
    );
    const down = [0, 100, 200, 300, 500].map(
      (d) => habitatScore({ ...h, elevation: s.elevation.min - d }, s, 1, DEFAULT_CONFIG).H,
    );
    expect(nonIncreasing(up)).toBe(true);
    expect(nonIncreasing(down)).toBe(true);
  });

  it('habitat: moving tree cover away from the preferred range never helps', () => {
    const h = habitat(s);
    const r = s.forest_pct;
    const below = [r.min, r.min - 10, r.min - 20, r.min - 40]
      .filter((x) => x >= 0)
      .map((x) => habitatScore({ ...h, forest_pct: x }, s, 1, DEFAULT_CONFIG).H);
    const above = [r.max, r.max + 10, r.max + 20, r.max + 40]
      .filter((x) => x <= 100)
      .map((x) => habitatScore({ ...h, forest_pct: x }, s, 1, DEFAULT_CONFIG).H);
    expect(nonIncreasing(below)).toBe(true);
    expect(nonIncreasing(above)).toBe(true);
  });

  it('habitat: replacing good host trees by poor ones never helps', () => {
    const pref = s.hostPreference;
    if (!pref) {
      // Not tied to trees: the host part is always 1.
      expect(hostFromMix({ spruce: 1 }, {}, 0.2)).toBe(1);
      return;
    }
    const ranked = (Object.entries(pref) as [Tree, number][]).sort((a, b) => b[1] - a[1]);
    const best = ranked[0]![0];
    const worst = ranked.at(-1)![0];
    const scores = [0, 0.25, 0.5, 0.75, 1].map((f) =>
      hostFromMix({ [best]: 1 - f, [worst]: f }, pref, DEFAULT_CONFIG.habitat.hostFloor),
    );
    expect(nonIncreasing(scores)).toBe(true);
    expect(scores[0]).toBeGreaterThan(scores.at(-1)!);
  });

  it('habitat: a better pH class never lowers H', () => {
    const h = habitat(s);
    const classes = (['acidic', 'neutral', 'calcareous'] as const)
      .slice()
      .sort((a, b) => s.ph[a] - s.ph[b]);
    const hs = classes.map((ph_class) => habitatScore({ ...h, ph_class }, s, 1, DEFAULT_CONFIG).H);
    expect(nonDecreasing(hs)).toBe(true);
  });

  it('out of season the score is 0, whatever the weather', () => {
    const off = Array.from({ length: 365 }, (_, i) =>
      new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10),
    ).find((d) => seasonScore(s, d, s.elevationShift.referenceElevation) === 0)!;
    const w = series(off, 90, (lag) => ({
      precip: lag >= s.rainLag.min && lag <= s.rainLag.max ? 10 : 2,
    }));
    expect(scoreSpecies(s, w, habitat(s)).score).toBe(0);
  });
});
