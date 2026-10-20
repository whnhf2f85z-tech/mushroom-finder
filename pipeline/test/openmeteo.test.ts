import { describe, expect, it } from 'vitest';
import {
  estimateCalls,
  fetchWeather,
  hourlyToDaily,
  mergeDays,
  parseLocation,
  postWithRetry,
} from '../src/openmeteo.js';
import { fakeDeps } from './fake-openmeteo.js';

const LOCS = [
  { id: 'a', lat: 47.1, lon: 8.7, elevation: 1200 },
  { id: 'b', lat: 47.2, lon: 8.6, elevation: 800 },
];

describe('parsing', () => {
  it('averages hourly values per local day and needs 20+ hours', () => {
    const time = [
      ...Array.from({ length: 24 }, (_, h) => `2026-10-01T${String(h).padStart(2, '0')}:00`),
      '2026-10-02T00:00',
    ];
    const values = [...Array.from({ length: 24 }, (_, h) => (h < 12 ? 0.2 : 0.4)), 0.5];
    const daily = hourlyToDaily(time, values);
    expect(daily.get('2026-10-01')).toBeCloseTo(0.3);
    expect(daily.has('2026-10-02')).toBe(false);
  });

  it('drops days without precipitation or temperature and keeps optional fields optional', () => {
    const days = parseLocation({
      daily: {
        time: ['2026-10-01', '2026-10-02'],
        precipitation_sum: [1.5, null],
        temperature_2m_min: [3, 4],
        temperature_2m_max: [11, 12],
        temperature_2m_mean: [null, 8],
      },
    });
    expect(days).toEqual([{ date: '2026-10-01', precip: 1.5, tmin: 3, tmax: 11, tmean: 7 }]);
  });

  it('merges day lists with later lists winning', () => {
    const a = [
      { date: '2026-10-02', precip: 1, tmin: 0, tmax: 0, tmean: 0 },
      { date: '2026-10-01', precip: 1, tmin: 0, tmax: 0, tmean: 0 },
    ];
    const b = [{ date: '2026-10-02', precip: 9, tmin: 0, tmax: 0, tmean: 0 }];
    expect(mergeDays(a, b).map((d) => [d.date, d.precip])).toEqual([
      ['2026-10-01', 1],
      ['2026-10-02', 9],
    ]);
  });

  it('estimates weighted API calls like Open-Meteo', () => {
    expect(estimateCalls(1, 9, 14)).toBe(1);
    expect(estimateCalls(14, 9, 28)).toBe(28);
    expect(estimateCalls(1, 15, 14)).toBe(1.5);
  });
});

describe('fetching', () => {
  it('batches locations into one request and parses each', async () => {
    const deps = fakeDeps({ today: '2026-10-20' });
    const r = await fetchWeather(
      'https://x',
      LOCS,
      { start_date: '2026-10-01', end_date: '2026-10-10' },
      deps,
    );
    expect(deps.requests).toHaveLength(1);
    expect(deps.requests[0]!.get('elevation')).toBe('1200,800');
    expect(r.failed).toEqual([]);
    expect(r.weather.get('b')).toHaveLength(10);
    expect(r.weather.get('a')![0]!.soilMoisture7_28).toBeDefined();
  });

  it('retries with backoff after server errors', async () => {
    const deps = fakeDeps({ today: '2026-10-20', flaky: 2 });
    const r = await fetchWeather('https://x', LOCS, { past_days: 2, forecast_days: 4 }, deps);
    expect(deps.requests).toHaveLength(3);
    expect(r.weather.get('a')).toHaveLength(6);
  });

  it('isolates a failing location and reports it', async () => {
    const deps = fakeDeps({ today: '2026-10-20', failLats: [47.2] });
    const r = await fetchWeather('https://x', LOCS, { past_days: 2, forecast_days: 4 }, deps);
    expect(r.failed).toEqual(['b']);
    expect(r.weather.has('a')).toBe(true);
  });

  it('does not retry client errors', async () => {
    let n = 0;
    const deps = {
      ...fakeDeps({ today: '2026-10-20' }),
      fetch: (async () => (n++, new Response('bad', { status: 400 }))) as typeof fetch,
    };
    await expect(postWithRetry('https://x', new URLSearchParams(), deps)).rejects.toThrow(
      'HTTP 400',
    );
    expect(n).toBe(1);
  });
});
