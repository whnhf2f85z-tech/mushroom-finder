import { FindEntrySchema, FindLogFileSchema, type FindEntry, type Species } from '@mf/scoring';
import { readStore, writeStore } from './store.js';

const KEY = 'mf.findlog.v1';

export function loadLog(): FindEntry[] {
  return readStore(KEY, (raw) => FindEntrySchema.array().catch([]).parse(raw), []);
}

export const saveLog = (entries: FindEntry[]): boolean => writeStore(KEY, entries);

/** Newest visit first; same day: newest entry first. */
export const sortLog = (entries: FindEntry[]): FindEntry[] =>
  [...entries].sort((a, b) => b.date.localeCompare(a.date) || b.created.localeCompare(a.created));

export function exportLogJson(entries: FindEntry[], now = new Date()): string {
  return JSON.stringify(
    FindLogFileSchema.parse({
      schemaVersion: 1,
      kind: 'mushroom-finder-findlog',
      exported: now.toISOString(),
      entries,
    }),
    null,
    2,
  );
}

const csvCell = (v: unknown): string => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export const CSV_COLUMNS = [
  'date',
  'place_type',
  'place_id',
  'place_name',
  'lat',
  'lon',
  'species_id',
  'species',
  'found',
  'quantity_g',
  'note',
  'score_at_visit',
  'score_source',
  'S',
  'M',
  'T',
  'F',
  'D',
  'H',
] as const;

/** CSV with one row per visit (comma-separated, UTF-8, header row), for calibration in a spreadsheet. */
export function exportLogCsv(entries: FindEntry[], species: Species[]): string {
  const name = (id: string) => species.find((s) => s.id === id)?.name ?? id;
  const rows = sortLog(entries).map((e) => {
    const c = e.score.components;
    return [
      e.date,
      e.place.kind,
      e.place.id,
      e.place.name,
      e.place.lat.toFixed(5),
      e.place.lon.toFixed(5),
      e.species,
      name(e.species),
      e.found ? 'yes' : 'no',
      e.quantityG,
      e.note,
      e.score.value,
      e.score.source,
      c?.S,
      c?.M,
      c?.T,
      c?.F,
      c?.D,
      c?.H,
    ]
      .map(csvCell)
      .join(',');
  });
  return [CSV_COLUMNS.join(','), ...rows].join('\r\n') + '\r\n';
}

/** Merge an exported find log; entries with an id that already exists are skipped. */
export function importLog(
  current: FindEntry[],
  text: string,
): { entries: FindEntry[]; added: number; skipped: number } {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('This file is not valid JSON.');
  }
  const parsed = FindLogFileSchema.safeParse(data);
  if (!parsed.success) throw new Error('This is not a Mushroom Finder find log file.');
  const ids = new Set(current.map((e) => e.id));
  const fresh = parsed.data.entries.filter((e) => !ids.has(e.id));
  return {
    entries: [...current, ...fresh],
    added: fresh.length,
    skipped: parsed.data.entries.length - fresh.length,
  };
}
