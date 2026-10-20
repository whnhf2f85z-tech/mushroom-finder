/**
 * Part C: fetch the 60 extra days of weather history in front of each case-control window (needed by the
 * 120-day soil-range variant), prefixes only. The window list is written locally to
 * validation/data/history-windows.json (it depends on cached GBIF data) and committed, so this can also run on
 * GitHub Actions ("Validation (manual)") when the local daily API quota is used up; the workflow keeps the
 * downloaded files as an artifact, to unpack into validation/cache/weather/.
 *   npx tsx validation/fetch-history.ts
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadCases, loadWeather, windowsOf, type WeatherWindow } from './lib/casecontrol.js';

const LIST = join(import.meta.dirname, 'data', 'history-windows.json');
if (!existsSync(LIST)) {
  const { cases, placeboCases } = await loadCases();
  writeFileSync(LIST, JSON.stringify([...windowsOf([...cases, ...placeboCases]).values()]));
}
const list = JSON.parse(readFileSync(LIST, 'utf8')) as WeatherWindow[];
await loadWeather(new Map(list.map((w) => [w.key, w])), 60, true);
console.log(`History prefixes ready for ${list.length} windows`);
