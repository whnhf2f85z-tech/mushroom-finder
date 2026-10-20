import type { PhClassT } from './schemas.js';

/** One day of weather at a location. Optional fields may be missing from the API. */
export interface DailyWeather {
  /** YYYY-MM-DD (local date, Europe/Zurich). */
  date: string;
  /** Precipitation sum, mm. */
  precip: number;
  tmin: number;
  tmax: number;
  tmean: number;
  /** Mean relative humidity, %. */
  rh?: number;
  /** Reference evapotranspiration, mm. */
  et0?: number;
  /** Daily mean soil moisture 7–28 cm, m³/m³. */
  soilMoisture7_28?: number;
  /** Daily mean soil moisture 0–7 cm, m³/m³. */
  soilMoisture0_7?: number;
  /** Daily mean soil temperature 0–7 cm, °C. */
  soilTemp0_7?: number;
}

/** Static habitat of a spot or grid cell. Missing fields lower the confidence, never crash. */
export interface Habitat {
  elevation: number;
  forest_pct?: number;
  conifer_pct?: number;
  site_type_code?: string;
  ph_class: PhClassT;
  /** Degrees clockwise from north (0 = north-facing). */
  aspect?: number;
  /** Degrees. */
  slope?: number;
  protected?: { is: boolean; name?: string; noPicking?: boolean };
}

export interface ScoreContext {
  /** Distance from the location to its weather point, km (grid cells use a coarser weather grid). */
  weatherDistanceKm?: number;
}

export interface Components {
  /** Season 0–1. */
  S: number;
  /** Moisture 0–1. */
  M: number;
  /** Temperature 0–1. */
  T: number;
  /** Frost multiplier 0–1. */
  F: number;
  /** Drought memory multiplier 0.6–1. */
  D: number;
  /** Habitat 0–1. */
  H: number;
}

/** Facts behind the components, so the UI can explain each score in plain English. */
export interface Details {
  dayOfYear: number;
  effectiveRainMm: number;
  rainWindow: [number, number];
  rainScore: number;
  soilScore: number | null;
  meanTemp7d: number | null;
  tempSource: 'air' | 'soil';
  coolingTrigger: boolean;
  frostNights: number;
  hardFrostNights: number;
  precip60dMm: number;
  precip60dNormalMm: number;
  hostScore: number | null;
  phScore: number;
  elevationScore: number;
  forestScore: number | null;
}

export type Confidence = 'high' | 'medium' | 'low';

export interface SpeciesResult {
  speciesId: string;
  /** 0–100. */
  score: number;
  components: Components;
  details: Details;
  outOfSeason: boolean;
  confidence: Confidence;
  /** Short machine-readable reasons for lower confidence. */
  confidenceIssues: string[];
}

export interface LocationResult {
  date: string;
  metascore: number;
  bestSpeciesId: string | null;
  species: SpeciesResult[];
  protected: boolean;
}
