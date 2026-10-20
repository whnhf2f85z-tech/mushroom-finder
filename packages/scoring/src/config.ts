import type { FrostToleranceT } from './schemas.js';

/**
 * Global scoring parameters. Species-specific values live in data/species.json.
 * All values are initial expert estimates, to be calibrated with the find log (docs/CALIBRATION.md).
 */
export const DEFAULT_CONFIG = {
  /**
   * dynamic = S^seasonExponent × combine(M, T) with weight moistureWeight on M.
   * 'geometric' = M^w × T^(1-w): dry soil pulls the score down even at a perfect temperature.
   * 'additive' (SPEC §5.2) = w·M + (1-w)·T: gives 40 points for temperature alone, even with no rain at all.
   */
  seasonExponent: 0.5,
  moistureWeight: 0.6,
  combine: 'geometric' as 'geometric' | 'additive',

  moisture: {
    /** Share of the rain score in M; the rest is soil moisture (7–28 cm). */
    rainShare: 0.6,
    /** Days over which the lag-kernel weight ramps from 0 to 1 on each side of the window. */
    kernelRampDays: 4,
    /** Rain above this per day counts no more (runoff), so one storm can't give a full score. */
    maxDailyRainMm: 20,
    /** Share of ET0 lost under the forest canopy (full ET0 would cancel almost all rain). */
    et0Factor: 0.3,
    /** Days for the soil-moisture min/max range. */
    soilRangeDays: 60,
    /** Below this range (m³/m³), fall back to absolute normalisation between dry and wet. */
    soilMinRange: 0.03,
    soilAbsDry: 0.15,
    soilAbsWet: 0.4,
  },

  temperature: {
    meanDays: 7,
    /** Cooling trigger: mean of the last 3 days at least this much below a 3-day mean 5–10 days ago. */
    coolingDropC: 3,
    /** ...and the earlier period must have been at least this warm. */
    coolingWarmC: 12,
  },

  frost: {
    lookbackDays: 7,
    frostC: -1,
    hardFrostC: -3,
    /** Multiplier lost per frost night / per hard-frost night, by tolerance. */
    penalties: {
      low: { frost: 0.25, hard: 0.75 },
      medium: { frost: 0.15, hard: 0.5 },
      'medium-high': { frost: 0.1, hard: 0.35 },
      high: { frost: 0.05, hard: 0.2 },
    } satisfies Record<FrostToleranceT, { frost: number; hard: number }>,
  },

  drought: {
    days: 60,
    /** Fixed regional normal: annual precipitation ≈ base + perMetre * elevation (mm/year). */
    annualNormalBaseMm: 900,
    annualNormalPerMetreMm: 0.6,
    /** Ratio of 60-day rain to normal at or above which D = 1, and at or below which D = min. */
    fullRatio: 0.8,
    floorRatio: 0.3,
    min: 0.6,
  },

  habitat: {
    weights: { host: 0.35, ph: 0.25, elevation: 0.25, forest: 0.15 },
    /** Score used when the conifer share is unknown. */
    unknownHost: 0.7,
    /** Percentage points beyond the preferred range at which the host/forest score bottoms out. */
    pctTail: 30,
    pctFloor: 0.2,
    /** Metres beyond the elevation range at which the elevation score bottoms out. */
    elevationTail: 300,
    /** No single habitat factor goes below this, so H never becomes exactly 0. */
    componentFloor: 0.02,
    /** Max bonus for steep-enough north-facing slopes, scaled by how dry it is (1 - D). */
    northBonus: 0.1,
    northMinSlope: 5,
  },

  confidence: {
    /** Weather point further than this (km) lowers confidence. */
    maxWeatherDistanceKm: 3,
    /** Issues: 0 → high, up to mediumMax → medium, more → low. */
    mediumMax: 2,
  },
};

export type ScoringConfig = typeof DEFAULT_CONFIG;
