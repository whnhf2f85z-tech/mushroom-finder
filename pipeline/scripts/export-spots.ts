/** Writes pilze-schwyz.kml and spots.txt in the project root from data/spots.json (npm run export:spots). */
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ReservesFileSchema, SpotsFileSchema } from '@mf/scoring';
import { zurichToday } from '../src/dates.js';
import { toKml, toText } from '../src/export.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = async (f: string) => JSON.parse(await readFile(join(ROOT, 'data', f), 'utf8'));
const spots = SpotsFileSchema.parse(await read('spots.json')).spots;
const reserves = ReservesFileSchema.parse(await read('reserves.json')).reserves;
await writeFile(join(ROOT, 'pilze-schwyz.kml'), toKml(spots, reserves));
await writeFile(join(ROOT, 'spots.txt'), toText(spots, reserves, zurichToday()));
console.log(
  `Wrote pilze-schwyz.kml and spots.txt (${spots.length} spots, ${reserves.length} reserves)`,
);
