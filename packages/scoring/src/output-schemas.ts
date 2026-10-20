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
    .refine(
      (o) => Object.keys(o).length > 0,
      'no spots',
    ) /** Grid summary; the scores are in grid/YYYY-MM-DD.json (one file per day of `days` and `forecastDays`). */,
  grid: z
    .object({
      count: z.number().int(),
      staleCells: z.number().int(),
      weatherPoints: z.number().int(),
    })
    .optional(),
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

const sameLength = (o: Record<string, unknown[]>, n: number) =>
  Object.values(o).every((a) => a.length === n);

/**
 * static/grid.json: the 1 km forest grid over ZH + SZ (built once with `npm run grid`).
 * Column-wise arrays in cell order; daily grid scores use the same order.
 */
export const GridFileSchema = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSION),
    generatedAt: z.string(),
    cellSize: z.literal(1000),
    count: z.number().int().positive(),
    cells: z.object({
      /** Lower-left corner in LV95 kilometres (e.g. 2697, 1208). */
      e: z.array(z.number().int()),
      n: z.array(z.number().int()),
      canton: z.array(z.enum(['ZH', 'SZ'])),
      forest: z.array(z.number().int().min(0).max(100)),
      conifer: z.array(z.number().int().min(0).max(100).nullable()),
      elevation: z.array(z.number().int()),
      slope: z.array(z.number()),
      aspect: z.array(z.number().int().nullable()),
      ph: z.array(z.enum(['acidic', 'neutral', 'calcareous', 'unknown'])),
      phSource: z.array(z.enum(['site_type', 'geology', 'none'])),
      /** Index into siteTypes. */
      site: z.array(z.number().int().nullable()),
      /** 0 = none, 1 = protected (check rules), 2 = no picking. */
      protected: z.array(z.number().int().min(0).max(2)),
      /** Index into protectedNames. */
      protectedName: z.array(z.number().int().nullable()),
      /** Index into weatherPoints. */
      weather: z.array(z.number().int().min(0)),
    }),
    siteTypes: z.array(z.object({ code: z.string(), name: z.string() })),
    protectedNames: z.array(z.string()),
    weatherPoints: z.object({
      lat: z.array(z.number()),
      lon: z.array(z.number()),
      elevation: z.array(z.number()),
    }),
  })
  .refine((g) => sameLength(g.cells, g.count), 'all cell columns must have `count` entries')
  .refine(
    (g) => sameLength(g.weatherPoints, g.weatherPoints.lat.length),
    'weather point columns differ in length',
  );

export type GridFile = z.infer<typeof GridFileSchema>;

/** Base64 of one byte per cell (score 0–100; 255 = no data), in grid order. */
const b64 = z.string().regex(/^[A-Za-z0-9+/]*={0,2}$/);

/** grid/YYYY-MM-DD.json: scores of every grid cell for one day. */
export const GridDayFileSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  date: isoDate,
  generatedAt: z.string(),
  /** "forecast" days are replaced by the real day's run. */
  source: z.enum(['daily', 'backfill', 'forecast']),
  count: z.number().int().positive(),
  species: z.record(z.string(), b64),
  /** Cells whose weather failed; their values are copied from the day before (or 255). */
  staleCells: z.number().int().min(0),
});

export type GridDayFile = z.infer<typeof GridDayFileSchema>;

export const NO_SCORE = 255;

/** Encode scores (null → 255) as base64 bytes; works in Node and browsers. */
export function encodeScores(scores: (number | null)[]): string {
  const bytes = Uint8Array.from(scores, (v) => (v === null ? NO_SCORE : v));
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

export function decodeScores(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** A pin the viewer added, stored on their device and exportable (SPEC §3.2). */
export const PinSchema = z.object({
  id: z.string().regex(/^pin-[a-z0-9-]+$/),
  name: z.string().trim().min(1).max(80),
  lat: z.number().min(45.8).max(47.9),
  lon: z.number().min(5.9).max(10.5),
  note: z.string().max(500).default(''),
  /** Filled in when the pin is added: terrain-model elevation (m) and canton. */
  elevation: z.number().nullable().default(null),
  canton: z.enum(['ZH', 'SZ']),
  created: z.string(),
});

export const PinsFileSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  kind: z.literal('mushroom-finder-pins'),
  exported: z.string().optional(),
  pins: z.array(PinSchema),
});

export const FindEntrySchema = z.object({
  id: z.string().min(1),
  date: isoDate,
  place: z.object({
    kind: z.enum(['spot', 'square', 'pin']),
    id: z.string(),
    name: z.string(),
    lat: z.number(),
    lon: z.number(),
  }),
  species: z.string(),
  found: z.boolean(),
  /** Grams, optional. */
  quantityG: z.number().min(0).max(100_000).nullable().default(null),
  note: z.string().max(1000).default(''),
  /** Score at the time of the visit, captured automatically for calibration (SPEC §6.4). */
  score: z.object({
    value: score.nullable(),
    components: ComponentsSchema.nullable(),
    /** "daily" = from the published scores, "live" = calculated in the browser, "none" = not available. */
    source: z.enum(['daily', 'live', 'none']),
  }),
  created: z.string(),
});

export const FindLogFileSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  kind: z.literal('mushroom-finder-findlog'),
  exported: z.string().optional(),
  entries: z.array(FindEntrySchema),
});

export type Pin = z.infer<typeof PinSchema>;
export type PinsFile = z.infer<typeof PinsFileSchema>;
export type FindEntry = z.infer<typeof FindEntrySchema>;
export type FindLogFile = z.infer<typeof FindLogFileSchema>;
