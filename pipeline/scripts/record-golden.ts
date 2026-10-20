/**
 * Records the real autumn-2026 weather used by the golden test (pipeline/test/golden.test.ts).
 * Re-run after ~28 Oct 2026 to replace the forecast part (21–26 Oct) with what actually happened.
 *   npm run record:golden
 */
import { writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { addDays, zurichToday } from '../src/dates.js';
import {
  FORECAST_URL,
  HISTORICAL_FORECAST_URL,
  MODEL,
  fetchWeather,
  mergeDays,
  type WeatherLocation,
} from '../src/openmeteo.js';

const OUT = join(
  dirname(fileURLToPath(import.meta.url)),
  '../test/fixtures/golden-autumn-2026.json',
);
const END = '2026-10-26';

export const GOLDEN_LOCATIONS: WeatherLocation[] = [
  // Ibergeregg – Alpthal side, middle of its 1,100–1,400 m band.
  { id: 'ibergeregg', lat: 47.022, lon: 8.708, elevation: 1250 },
  // Zürich Weinland near Andelfingen: low, the driest part of the Mittelland in ZH.
  { id: 'weinland', lat: 47.6, lon: 8.67, elevation: 420 },
];

const today = zurichToday();
const histEnd = addDays(today, -2) < END ? addDays(today, -2) : END;
const hist = await fetchWeather(HISTORICAL_FORECAST_URL, GOLDEN_LOCATIONS, {
  start_date: '2026-07-15',
  end_date: histEnd,
});
const forecastDays = Math.max(
  1,
  Math.round((Date.parse(END) - Date.parse(today)) / 86_400_000) + 1,
);
const fc =
  histEnd < END
    ? await fetchWeather(FORECAST_URL, GOLDEN_LOCATIONS, {
        past_days: 2,
        forecast_days: forecastDays,
      })
    : null;
if (hist.failed.length || fc?.failed.length) throw new Error('fetch failed');

const locations = Object.fromEntries(
  GOLDEN_LOCATIONS.map((l) => [
    l.id,
    {
      ...l,
      weather: mergeDays(hist.weather.get(l.id)!, fc?.weather.get(l.id) ?? []).filter(
        (d) => d.date <= END,
      ),
    },
  ]),
);
await writeFile(
  OUT,
  JSON.stringify(
    {
      recordedOn: today,
      model: MODEL,
      forecastFrom: histEnd < END ? addDays(today, 1) : null,
      locations,
    },
    null,
    1,
  ) + '\n',
);
console.log(
  `Wrote ${OUT} (recorded ${today}; forecast from ${histEnd < END ? addDays(today, 1) : 'none'})`,
);
