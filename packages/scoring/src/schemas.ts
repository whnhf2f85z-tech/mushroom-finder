import { z } from 'zod';
import { TREES } from './trees.js';

/** Versioned schemas for the hand-edited files in /data. Bump schemaVersion on breaking changes. */
export const SCHEMA_VERSION = 1;

const monthDay = z.string().regex(/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, 'expected MM-DD');
const range = z
  .object({ min: z.number(), max: z.number() })
  .refine((r) => r.min <= r.max, 'min must be <= max');
const unit = z.number().min(0).max(1);

export const PhClass = z.enum(['acidic', 'neutral', 'calcareous', 'unknown']);
export const FrostTolerance = z.enum(['low', 'medium', 'medium-high', 'high']);
export const Canton = z.enum(['ZH', 'SZ']);

export const SpeciesSchema = z.object({
  id: z.string().regex(/^[a-z_]+$/),
  name: z.string(),
  german: z.string(),
  latin: z.string(),
  /** Trapezoid at the reference elevation: 0 before start, ramps to 1 at peakStart, 1 until peakEnd, 0 at end. */
  season: z.object({ start: monthDay, peakStart: monthDay, peakEnd: monthDay, end: monthDay }),
  /** Days the season moves per 100 m above referenceElevation (negative = earlier). */
  elevationShift: z.object({
    referenceElevation: z.number(),
    startDaysPer100m: z.number(),
    endDaysPer100m: z.number(),
  }),
  hosts: z.array(z.string()),
  /**
   * Host-tree preference: 1 = found with that tree as often as the tree occurs in the Swiss forest, > 1 preferred.
   * Missing = not tied to particular trees (decomposers, parasites). Sources: docs/DATA_SOURCES.md.
   */
  hostPreference: z.record(z.enum(TREES), z.number().min(0)).optional(),
  /** Where the host preference comes from (shown in the docs). */
  hostSource: z.string().optional(),
  forest_pct: range,
  ph: z.object({ acidic: unit, neutral: unit, calcareous: unit, unknown: unit }),
  elevation: range,
  temperature: z.object({
    source: z.enum(['air', 'soil']),
    min: z.number(),
    max: z.number(),
    /** °C beyond the band at which the score reaches 0. */
    tail: z.number().positive(),
  }),
  /** Added to T when a cooling trigger is detected (0 = no trigger effect). */
  coolingBonus: unit,
  rainLag: z.object({ min: z.number().int().min(0), max: z.number().int().min(0) }),
  /** Effective rain (mm) in the lag window for a full rain score. */
  fullRainMm: z.number().positive(),
  frostTolerance: FrostTolerance,
  /** Optional per-species override of the habitat weights in config.ts. */
  habitatWeights: z
    .object({ host: z.number(), ph: z.number(), elevation: z.number(), forest: z.number() })
    .partial()
    .optional(),
  notes: z.string(),
  /** Look-alikes by name and danger only: the app never explains how to tell mushrooms apart. */
  lookalikes: z
    .array(
      z.object({
        name: z.string(),
        latin: z.string(),
        danger: z.enum(['deadly', 'poisonous', 'inedible']),
      }),
    )
    .min(1),
  /** Extra safety note (e.g. must be cooked thoroughly); empty if none. */
  safety: z.string(),
  /** One openly licensed photo of the edible species (never of look-alikes), with its credit. */
  photo: z
    .object({
      file: z.string(),
      /** Taxon shown (for genera: the species in the photo). */
      shows: z.string(),
      author: z.string().min(1),
      license: z.string().min(1),
      licenseUrl: z.string(),
      source: z.string().url(),
    })
    .optional(),
});

export const SpeciesFileSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  species: z.array(SpeciesSchema).min(1),
});

export const SpotSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string(),
  canton: Canton,
  lat: z.number().min(45.8).max(47.9),
  lon: z.number().min(5.9).max(10.5),
  elevation_band: range,
  notes: z.string(),
  /** Species the spot is known for (ids from species.json). */
  species_hint: z.array(z.string()).default([]),
  /** Provisional habitat from the spot notes, until the terrain/habitat build (Milestone 3) replaces it. */
  habitat_hint: z
    .object({ conifer_pct: z.number().min(0).max(100).optional(), ph_class: PhClass.optional() })
    .optional(),
});

export const SpotsFileSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  spots: z.array(SpotSchema).min(1),
});

export const ReserveSchema = z.object({
  id: z.string(),
  name: z.string(),
  canton: Canton,
  lat: z.number(),
  lon: z.number(),
  approximate: z.boolean(),
  notes: z.string(),
});

export const ReservesFileSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  reserves: z.array(ReserveSchema),
});

export const CantonRulesSchema = z.object({
  name: z.string(),
  maxKgPerPersonPerDay: z.number().positive(),
  speciesLimits: z.array(z.object({ species: z.string(), maxKg: z.number().positive() })),
  /** Days of the month (1–31) when picking is not allowed. */
  closedDaysOfMonth: z.array(z.number().int().min(1).max(31)),
  /** null = not confirmed from an official source yet. */
  groupPickingBanned: z.boolean().nullable(),
  rules: z.array(z.string()).min(1),
  noPickingAreas: z.array(z.string()),
  cantonalMapUrl: z.string().url(),
  sources: z.array(z.object({ title: z.string(), url: z.string().url() })).min(1),
  checked: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export const RulesFileSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  cantons: z.record(Canton, CantonRulesSchema),
});

export type Species = z.infer<typeof SpeciesSchema>;
export type SpeciesFile = z.infer<typeof SpeciesFileSchema>;
export type Spot = z.infer<typeof SpotSchema>;
export type SpotsFile = z.infer<typeof SpotsFileSchema>;
export type Reserve = z.infer<typeof ReserveSchema>;
export type ReservesFile = z.infer<typeof ReservesFileSchema>;
export type CantonRules = z.infer<typeof CantonRulesSchema>;
export type RulesFile = z.infer<typeof RulesFileSchema>;
export type PhClassT = z.infer<typeof PhClass>;
export type FrostToleranceT = z.infer<typeof FrostTolerance>;
export type CantonT = z.infer<typeof Canton>;
