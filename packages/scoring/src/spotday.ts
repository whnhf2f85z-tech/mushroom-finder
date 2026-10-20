import type { LatestSpot, SpotDay } from './output-schemas.js';
import type { LocationResult } from './types.js';

/** Compact per-day scores and today's detail, used by the daily job and for user pins scored in the browser. */
const r3 = (x: number): number => Math.round(x * 1000) / 1000;

export const toSpotDay = (r: LocationResult): SpotDay => ({
  metascore: r.metascore,
  best: r.bestSpeciesId,
  species: Object.fromEntries(
    r.species.map((s) => [
      s.speciesId,
      {
        score: s.score,
        components: {
          S: r3(s.components.S),
          M: r3(s.components.M),
          T: r3(s.components.T),
          F: r3(s.components.F),
          D: r3(s.components.D),
          H: r3(s.components.H),
        },
        outOfSeason: s.outOfSeason,
        confidence: s.confidence,
      },
    ]),
  ),
});

/** Today's scores with the explanation details, for the spot detail panel. */
export const toTodayDetail = (r: LocationResult): LatestSpot['today'] => {
  const base = toSpotDay(r);
  return {
    ...base,
    species: Object.fromEntries(
      r.species.map((s) => [
        s.speciesId,
        {
          ...base.species[s.speciesId]!,
          confidenceIssues: s.confidenceIssues,
          details: Object.fromEntries(
            Object.entries(s.details).map(([k, v]) => [k, typeof v === 'number' ? r3(v) : v]),
          ),
        },
      ]),
    ),
  };
};
