import { describe, expect, it } from 'vitest';
import { DEFAULT_FAVOURITES, bestOf } from '../src/favourites.js';
import { SPECIES } from './helpers.js';

describe('favourites', () => {
  it('defaults to five known species, without honey fungus', () => {
    const ids = new Set(SPECIES.map((s) => s.id));
    expect(DEFAULT_FAVOURITES).toHaveLength(5);
    for (const f of DEFAULT_FAVOURITES) expect(ids.has(f)).toBe(true);
    expect(DEFAULT_FAVOURITES).not.toContain('honey_fungus');
  });

  it('takes the best score among the chosen species only', () => {
    const scores = { honey_fungus: 95, chanterelle: 60, porcini: 72, morel: null };
    expect(bestOf(scores, DEFAULT_FAVOURITES)).toEqual({ score: 72, id: 'porcini' });
    expect(bestOf(scores, ['morel'])).toBeNull();
    expect(bestOf(scores, [])).toBeNull();
  });
});
