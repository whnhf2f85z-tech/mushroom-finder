import type { ScoringConfig } from './config.js';
import type { Species } from './schemas.js';
import type { Habitat } from './types.js';
import { linearRange } from './util.js';

export interface HabitatResult {
  H: number;
  hostScore: number | null;
  phScore: number;
  elevationScore: number;
  forestScore: number | null;
}

/**
 * H: 0–1 static habitat match, a weighted geometric mean of host trees, pH, elevation and forest cover,
 * so one bad factor (e.g. far too high) pulls the score down strongly. Unknown forest cover is skipped.
 * `D` is the drought multiplier: north-facing slopes get a small bonus when it is dry.
 */
export function habitatScore(
  habitat: Habitat,
  species: Species,
  D: number,
  cfg: ScoringConfig,
): HabitatResult {
  const h = cfg.habitat;
  const w = { ...h.weights, ...species.habitatWeights };
  const hostScore =
    habitat.conifer_pct === undefined
      ? null
      : linearRange(habitat.conifer_pct, species.conifer_pct, h.pctTail, h.pctFloor);
  const phScore = species.ph[habitat.ph_class];
  const elevationScore = linearRange(
    habitat.elevation,
    species.elevation,
    h.elevationTail,
    h.componentFloor,
  );
  const forestScore =
    habitat.forest_pct === undefined
      ? null
      : linearRange(habitat.forest_pct, species.forest_pct, h.pctTail, h.pctFloor);

  const parts: [number, number][] = [
    [hostScore ?? h.unknownHost, w.host],
    [phScore, w.ph],
    [elevationScore, w.elevation],
  ];
  if (forestScore !== null) parts.push([forestScore, w.forest]);
  const totalW = parts.reduce((s, [, wi]) => s + wi, 0);
  let H = Math.exp(
    parts.reduce((s, [v, wi]) => s + wi * Math.log(Math.max(h.componentFloor, v)), 0) / totalW,
  );

  if (habitat.aspect !== undefined && (habitat.slope ?? 0) >= h.northMinSlope) {
    const northness = Math.max(0, Math.cos((habitat.aspect * Math.PI) / 180));
    const dryness = (1 - D) / (1 - cfg.drought.min);
    H = Math.min(1, H + h.northBonus * northness * dryness);
  }
  return { H, hostScore, phScore, elevationScore, forestScore };
}
