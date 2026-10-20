import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  HistoryFileSchema,
  LatestFileSchema,
  type HistoryFile,
  type LatestFile,
} from '@mf/scoring';
import type { z } from 'zod';

/** Validate, then write via a temporary file and rename, so a crash never leaves a half-written or invalid file. */
export async function writeJsonValidated<T>(
  path: string,
  schema: z.ZodType<T>,
  data: T,
): Promise<void> {
  const parsed = schema.parse(data);
  const json = JSON.stringify(parsed);
  if (json.length < 10) throw new Error(`refusing to write near-empty ${path}`);
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  await writeFile(tmp, json + '\n');
  await rename(tmp, path);
}

async function readValidated<T>(path: string, schema: z.ZodType<T>): Promise<T | null> {
  try {
    return schema.parse(JSON.parse(await readFile(path, 'utf8')));
  } catch {
    return null;
  }
}

export const historyDir = (outDir: string): string => join(outDir, 'history');
export const historyPath = (outDir: string, date: string): string =>
  join(historyDir(outDir), `${date}.json`);
export const latestPath = (outDir: string): string => join(outDir, 'latest.json');

export const readLatest = (outDir: string): Promise<LatestFile | null> =>
  readValidated(latestPath(outDir), LatestFileSchema);

export const readHistory = (outDir: string, date: string): Promise<HistoryFile | null> =>
  readValidated(historyPath(outDir, date), HistoryFileSchema);

export async function listHistoryDates(outDir: string): Promise<string[]> {
  try {
    return (await readdir(historyDir(outDir)))
      .map((f) => /^(\d{4}-\d{2}-\d{2})\.json$/.exec(f)?.[1])
      .filter((d): d is string => !!d)
      .sort();
  } catch {
    return [];
  }
}

/** Delete history snapshots older than `keepFrom` (YYYY-MM-DD). Returns the deleted dates. */
export async function pruneHistory(outDir: string, keepFrom: string): Promise<string[]> {
  const old = (await listHistoryDates(outDir)).filter((d) => d < keepFrom);
  await Promise.all(old.map((d) => rm(historyPath(outDir, d))));
  return old;
}
