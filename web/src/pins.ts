import { PinSchema, PinsFileSchema, type Pin } from '@mf/scoring';
import { readStore, writeStore } from './store.js';

const KEY = 'mf.pins.v1';

export const newId = (prefix: string): string =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

export function loadPins(): Pin[] {
  return readStore(KEY, (raw) => PinSchema.array().catch([]).parse(raw), []);
}

export const savePins = (pins: Pin[]): boolean => writeStore(KEY, pins);

export function exportPins(pins: Pin[], now = new Date()): string {
  return JSON.stringify(
    PinsFileSchema.parse({
      schemaVersion: 1,
      kind: 'mushroom-finder-pins',
      exported: now.toISOString(),
      pins,
    }),
    null,
    2,
  );
}

/**
 * Merge an exported pins file into the current pins. Pins with the same id, or within ~10 m of an existing pin,
 * are skipped. Throws a readable error for files that aren't a pins export.
 */
export function importPins(
  current: Pin[],
  text: string,
): { pins: Pin[]; added: number; skipped: number } {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('This file is not valid JSON.');
  }
  const parsed = PinsFileSchema.safeParse(data);
  if (!parsed.success) throw new Error('This is not a Mushroom Finder pins file.');
  const pins = [...current];
  let added = 0;
  let skipped = 0;
  for (const p of parsed.data.pins) {
    const dup = pins.some(
      (q) =>
        q.id === p.id || (Math.abs(q.lat - p.lat) < 0.0001 && Math.abs(q.lon - p.lon) < 0.00015),
    );
    if (dup) skipped++;
    else {
      pins.push(p);
      added++;
    }
  }
  return { pins, added, skipped };
}
