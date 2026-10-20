import { describe, expect, it } from 'vitest';
import { NO_SCORE, decodeScores, encodeScores } from '../src/output-schemas.js';

describe('grid score encoding', () => {
  it('round-trips scores and marks missing ones', () => {
    const s = encodeScores([0, 37, 100, null]);
    expect(Array.from(decodeScores(s))).toEqual([0, 37, 100, NO_SCORE]);
  });
  it('is about 4/3 byte per cell', () => {
    expect(encodeScores(new Array(1500).fill(50)).length).toBe(2000);
  });
});
