import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG as cfg } from '../src/config.js';
import { habitatScore } from '../src/habitat.js';
import { IBERGEREGG, sp } from './helpers.js';

describe('habitat H', () => {
  it('is high for a good chanterelle site', () => {
    expect(habitatScore(IBERGEREGG, sp('chanterelle'), 1, cfg).H).toBeGreaterThan(0.95);
  });

  it('is lower on calcareous soil for an acid-loving species', () => {
    const acid = habitatScore(IBERGEREGG, sp('chanterelle'), 1, cfg).H;
    const calc = habitatScore(
      { ...IBERGEREGG, ph_class: 'calcareous' },
      sp('chanterelle'),
      1,
      cfg,
    ).H;
    expect(calc).toBeLessThan(acid * 0.8);
  });

  it('prefers beech for horn of plenty', () => {
    const beech = habitatScore(
      { ...IBERGEREGG, elevation: 800, conifer_pct: 10, ph_class: 'calcareous' },
      sp('horn_of_plenty'),
      1,
      cfg,
    );
    const spruce = habitatScore(
      { ...IBERGEREGG, elevation: 800, conifer_pct: 95, ph_class: 'calcareous' },
      sp('horn_of_plenty'),
      1,
      cfg,
    );
    expect(beech.H).toBeGreaterThan(spruce.H);
  });

  it('drops strongly far outside the elevation range', () => {
    const r = habitatScore({ ...IBERGEREGG, elevation: 2200 }, sp('chanterelle'), 1, cfg);
    expect(r.elevationScore).toBe(cfg.habitat.componentFloor);
    expect(r.H).toBeLessThan(0.5);
  });

  it('works with a minimal habitat (only elevation, unknown pH)', () => {
    const r = habitatScore({ elevation: 1000, ph_class: 'unknown' }, sp('chanterelle'), 1, cfg);
    expect(r.hostScore).toBeNull();
    expect(r.forestScore).toBeNull();
    expect(r.H).toBeGreaterThan(0.5);
    expect(r.H).toBeLessThan(0.9);
  });

  it('barely depends on soil for honey fungus', () => {
    const a = habitatScore({ ...IBERGEREGG, ph_class: 'acidic' }, sp('honey_fungus'), 1, cfg).H;
    const c = habitatScore({ ...IBERGEREGG, ph_class: 'calcareous' }, sp('honey_fungus'), 1, cfg).H;
    expect(a).toBeCloseTo(c);
  });

  it('applies a tree-cover preference (forest_pct range)', () => {
    const edgeLover = { ...sp('parasol'), forest_pct: { min: 20, max: 60 } };
    const base = { ...IBERGEREGG, elevation: 800, ph_class: 'neutral' as const };
    const edge = habitatScore({ ...base, forest_pct: 40 }, edgeLover, 1, cfg).H;
    const dense = habitatScore({ ...base, forest_pct: 100 }, edgeLover, 1, cfg).H;
    expect(edge).toBeGreaterThan(dense);
  });

  it('gives north-facing slopes a small bonus only when it is dry', () => {
    const base = { ...IBERGEREGG, ph_class: 'neutral' as const };
    const north = habitatScore({ ...base, aspect: 0 }, sp('chanterelle'), 0.6, cfg).H;
    const south = habitatScore({ ...base, aspect: 180 }, sp('chanterelle'), 0.6, cfg).H;
    const northWet = habitatScore({ ...base, aspect: 0 }, sp('chanterelle'), 1, cfg).H;
    expect(north - south).toBeCloseTo(cfg.habitat.northBonus);
    expect(northWet).toBeCloseTo(south);
  });
});
