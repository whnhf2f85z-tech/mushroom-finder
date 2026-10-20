import { z } from 'zod';
import { SCHEMA_VERSION } from './schemas.js';

/** Schemas for the generated files in web/public/data, shared by the pipeline (writes) and the web app (reads). */

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const score = z.number().int().min(0).max(100);
const unit = z.number().min(0).max(1);

export const ComponentsSchema = z.object({ S: unit, M: unit, T: unit, F: unit, D: unit, H: unit });

export const SpeciesDaySchema = z.object({
  score,
  components: ComponentsSchema,
  outOfSeason: z.boolean(),
  confidence: z.enum(['high', 'medium', 'low']),
});

export const SpotDaySchema = z.object({
  metascore: score,
  best: z.string().nullable(),
  species: z.record(z.string(), SpeciesDaySchema),
});

/** history/YYYY-MM-DD.json: scores for one day, computed with the weather known on that day's run. */
export const HistoryFileSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  date: isoDate,
  generatedAt: z.string(),
  model: z.string(),
  /** "daily" = normal run on that day; "backfill" = computed later from stored weather. */
  source: z.enum(['daily', 'backfill']),
  spots: z.record(z.string(), SpotDaySchema).refine((o) => Object.keys(o).length > 0, 'no spots'),
});

const nullableScores = z.array(score.nullable());
const nullableNumbers = z.array(z.number().nullable());

export const LatestSpotSchema = z.object({
  /** True if this spot's weather could not be updated and older scores are shown. */
  stale: z.boolean(),
  /** Date of the run that produced `today` for this spot. */
  updated: isoDate,
  today: SpotDaySchema.extend({
    species: z.record(
      z.string(),
      SpeciesDaySchema.extend({
        confidenceIssues: z.array(z.string()),
        details: z.record(z.string(), z.unknown()),
      }),
    ),
  }),
  /** Aligned with `days` then `forecastDays`. */
  metaSeries: nullableScores,
  series: z.record(z.string(), nullableScores),
  /** Aligned with `days` then `forecastDays`. */
  weather: z.object({ precip: nullableNumbers, tmin: nullableNumbers, tmax: nullableNumbers }),
});

/** latest.json: everything the map and the spot detail need. */
export const LatestFileSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  generatedAt: z.string(),
  today: isoDate,
  model: z.string(),
  /** True if any spot is stale. */
  stale: z.boolean(),
  apiCalls: z.number().min(0),
  /** The last 14 days, oldest first, ending today. */
  days: z.array(isoDate).length(14),
  forecastDays: z.array(isoDate),
  spots: z
    .record(z.string(), LatestSpotSchema)
    .refine((o) => Object.keys(o).length > 0, 'no spots'),
});

export type SpeciesDay = z.infer<typeof SpeciesDaySchema>;
export type SpotDay = z.infer<typeof SpotDaySchema>;
export type HistoryFile = z.infer<typeof HistoryFileSchema>;
export type LatestSpot = z.infer<typeof LatestSpotSchema>;
export type LatestFile = z.infer<typeof LatestFileSchema>;

export const HabitatEntrySchema = z.object({
  /** Where the habitat was measured (the spot pin). */
  lat: z.number(),
  lon: z.number(),
  elevation: z.number(),
  slope: z.number().nullable(),
  aspect: z.number().nullable(),
  /** Share of tree cover within 250 m, %. */
  forest_pct: z.number().min(0).max(100),
  conifer_pct: z.number().min(0).max(100).nullable(),
  site_type_code: z.string().nullable(),
  site_type_name: z.string().nullable(),
  lithology: z.string().nullable(),
  ph_class: z.enum(['acidic', 'neutral', 'calcareous', 'unknown']),
  ph_source: z.enum(['site_type', 'geology', 'none']),
  protected: z.object({
    is: z.boolean(),
    name: z.string().nullable(),
    /** Picking is banned here under the canton rules. */
    noPicking: z.boolean(),
  }),
});

/** static/habitat.json: the habitat build (rarely re-run). */
export const HabitatFileSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  generatedAt: z.string(),
  spots: z.record(z.string(), HabitatEntrySchema),
});

export type HabitatEntry = z.infer<typeof HabitatEntrySchema>;
export type HabitatFile = z.infer<typeof HabitatFileSchema>;
