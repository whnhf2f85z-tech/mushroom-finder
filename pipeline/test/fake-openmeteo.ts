import { addDays, dateRange } from '../src/dates.js';
import type { FetchDeps } from '../src/openmeteo.js';

export interface FakeOptions {
  today: string;
  /** Latitudes (as sent) that always fail. */
  failLats?: number[];
  /** Fail every request. */
  failAll?: boolean;
  /** Fail the first N requests with HTTP 500 (to test retries). */
  flaky?: number;
}

/** A fake Open-Meteo that answers POSTs with simple, deterministic weather. */
export function fakeDeps(
  opts: FakeOptions,
): FetchDeps & { requests: URLSearchParams[]; logs: string[] } {
  const requests: URLSearchParams[] = [];
  const logs: string[] = [];
  let flaky = opts.flaky ?? 0;
  const fetch = (async (_url: string, init?: RequestInit) => {
    const body = init!.body as URLSearchParams;
    requests.push(body);
    const lats = body.get('latitude')!.split(',').map(Number);
    if (opts.failAll || flaky-- > 0 || lats.some((l) => opts.failLats?.includes(l))) {
      return new Response('boom', { status: 500 });
    }
    const dates = body.has('past_days')
      ? dateRange(
          addDays(opts.today, -Number(body.get('past_days'))),
          addDays(opts.today, Number(body.get('forecast_days')) - 1),
        )
      : dateRange(body.get('start_date')!, body.get('end_date')!);
    const hours = dates.flatMap((d) =>
      Array.from({ length: 24 }, (_, h) => `${d}T${String(h).padStart(2, '0')}:00`),
    );
    const loc = (lat: number) => ({
      latitude: lat,
      daily: {
        time: dates,
        precipitation_sum: dates.map((_, i) => (i % 5 === 0 ? 8 : 1)),
        temperature_2m_min: dates.map(() => 6),
        temperature_2m_max: dates.map(() => 14),
        temperature_2m_mean: dates.map(() => 10),
        relative_humidity_2m_mean: dates.map(() => 85),
        et0_fao_evapotranspiration: dates.map(() => 1),
      },
      hourly: {
        time: hours,
        soil_moisture_0_to_7cm: hours.map(() => 0.3),
        soil_moisture_7_to_28cm: hours.map((_, i) => 0.25 + (i % 240) / 2400),
        soil_temperature_0_to_7cm: hours.map(() => 9),
      },
    });
    const json = lats.length === 1 ? loc(lats[0]!) : lats.map(loc);
    return new Response(JSON.stringify(json), { status: 200 });
  }) as typeof globalThis.fetch;
  return { fetch, sleep: async () => {}, log: (m) => logs.push(m), requests, logs };
}
