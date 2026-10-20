import { mkdtemp, readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { LatestFileSchema } from '@mf/scoring';
import { addDays } from '../src/dates.js';
import { run } from '../src/run.js';
import { fakeDeps } from './fake-openmeteo.js';

const DATA = join(import.meta.dirname, '../../data');
const TODAY = '2026-10-20';
let out: string;
beforeEach(async () => {
  out = await mkdtemp(join(tmpdir(), 'mf-run-'));
});

const latest = async () =>
  LatestFileSchema.parse(JSON.parse(await readFile(join(out, 'latest.json'), 'utf8')));
const historyFiles = async () => (await readdir(join(out, 'history'))).sort();

describe('daily run', () => {
  it('backfills 14 days on the first run and writes a valid latest.json', async () => {
    const s = await run({
      today: TODAY,
      backfill: 0,
      outDir: out,
      dataDir: DATA,
      deps: fakeDeps({ today: TODAY }),
    });
    expect(s.written).toHaveLength(14);
    expect(await historyFiles()).toHaveLength(14);
    const l = await latest();
    expect(l.days[13]).toBe(TODAY);
    expect(l.forecastDays).toEqual(['2026-10-21', '2026-10-22', '2026-10-23']);
    expect(Object.keys(l.spots)).toHaveLength(14);
    expect(l.stale).toBe(false);
    const spot = l.spots['ibergeregg-alpthal']!;
    expect(spot.metaSeries).toHaveLength(17);
    expect(spot.metaSeries.every((v) => v !== null)).toBe(true);
    expect(spot.series.morel!.every((v) => v === 0)).toBe(true);
    expect(spot.weather.precip).toHaveLength(17);
    expect(s.apiCalls).toBeGreaterThan(0);
  });

  it('only scores today on the next day (history already there)', async () => {
    await run({
      today: TODAY,
      backfill: 0,
      outDir: out,
      dataDir: DATA,
      deps: fakeDeps({ today: TODAY }),
    });
    const next = addDays(TODAY, 1);
    const s = await run({
      today: next,
      backfill: 0,
      outDir: out,
      dataDir: DATA,
      deps: fakeDeps({ today: next }),
    });
    expect(s.written).toEqual([next]);
  });

  it('recomputes the last N days with --backfill', async () => {
    await run({
      today: TODAY,
      backfill: 0,
      outDir: out,
      dataDir: DATA,
      deps: fakeDeps({ today: TODAY }),
    });
    const s = await run({
      today: TODAY,
      backfill: 20,
      outDir: out,
      dataDir: DATA,
      deps: fakeDeps({ today: TODAY }),
    });
    expect(s.written).toHaveLength(20);
    const h = JSON.parse(await readFile(join(out, 'history', '2026-10-05.json'), 'utf8'));
    expect(h.source).toBe('backfill');
  });

  it('keeps the previous scores of a failing spot and marks it stale', async () => {
    await run({
      today: TODAY,
      backfill: 0,
      outDir: out,
      dataDir: DATA,
      deps: fakeDeps({ today: TODAY }),
    });
    const before = (await latest()).spots.gersau!;
    const next = addDays(TODAY, 1);
    const s = await run({
      today: next,
      backfill: 0,
      outDir: out,
      dataDir: DATA,
      deps: fakeDeps({ today: next, failLats: [46.995] }),
    });
    expect(s.failed).toEqual(['gersau']);
    const l = await latest();
    expect(l.stale).toBe(true);
    expect(l.spots.gersau!.stale).toBe(true);
    expect(l.spots.gersau!.updated).toBe(TODAY);
    expect(l.spots.gersau!.today).toEqual(before.today);
    // Yesterday's chart value moved one place left.
    expect(l.spots.gersau!.metaSeries[12]).toBe(before.metaSeries[13]);
    expect(l.spots.gersau!.metaSeries[13]).toBeNull();
    expect(l.spots['ibergeregg-alpthal']!.stale).toBe(false);
  });

  it('writes nothing and fails when all weather fails', async () => {
    await run({
      today: TODAY,
      backfill: 0,
      outDir: out,
      dataDir: DATA,
      deps: fakeDeps({ today: TODAY }),
    });
    const before = await readFile(join(out, 'latest.json'), 'utf8');
    const next = addDays(TODAY, 1);
    await expect(
      run({
        today: next,
        backfill: 0,
        outDir: out,
        dataDir: DATA,
        deps: fakeDeps({ today: next, failAll: true }),
      }),
    ).rejects.toThrow(/keeping the previous data/);
    expect(await readFile(join(out, 'latest.json'), 'utf8')).toBe(before);
    expect(await historyFiles()).not.toContain(`${next}.json`);
  });

  it('keeps 30 daily snapshots and prunes older ones', async () => {
    await mkdir(join(out, 'history'), { recursive: true });
    await writeFile(join(out, 'history', '2026-09-01.json'), '{}');
    const s = await run({
      today: TODAY,
      backfill: 0,
      outDir: out,
      dataDir: DATA,
      deps: fakeDeps({ today: TODAY }),
    });
    expect(s.pruned).toEqual(['2026-09-01']);
    expect(await historyFiles()).not.toContain('2026-09-01.json');
  });
});

describe('daily run with the habitat build', () => {
  it('uses the habitat file for the weather elevation and the habitat score', async () => {
    const entry = {
      lat: 47.03473,
      lon: 8.791,
      elevation: 1234,
      slope: 20,
      aspect: 10,
      forest_pct: 80,
      conifer_pct: 10,
      site_type_code: '8',
      site_type_name: 'Waldhirsen-Buchenwald',
      lithology: null,
      ph_class: 'calcareous' as const,
      ph_source: 'site_type' as const,
      protected: { is: false, name: null, noPicking: false },
    };
    await mkdir(join(out, 'static'), { recursive: true });
    await writeFile(
      join(out, 'static', 'habitat.json'),
      JSON.stringify({ schemaVersion: 1, generatedAt: 'x', spots: { 'oberiberg-ybrig': entry } }),
    );
    const deps = fakeDeps({ today: TODAY });
    await run({ today: TODAY, backfill: 0, outDir: out, dataDir: DATA, deps });
    // Oberiberg is the 2nd spot in data/spots.json.
    expect(deps.requests[0]!.get('elevation')!.split(',')[1]).toBe('1234');
    const calcareous = (await latest()).spots['oberiberg-ybrig']!.today.species.chanterelle!
      .components.H;
    // Same spot with an acidic conifer site: better for chanterelles.
    await writeFile(
      join(out, 'static', 'habitat.json'),
      JSON.stringify({
        schemaVersion: 1,
        generatedAt: 'x',
        spots: { 'oberiberg-ybrig': { ...entry, ph_class: 'acidic', conifer_pct: 85 } },
      }),
    );
    await run({
      today: TODAY,
      backfill: 1,
      outDir: out,
      dataDir: DATA,
      deps: fakeDeps({ today: TODAY }),
    });
    const acidic = (await latest()).spots['oberiberg-ybrig']!.today.species.chanterelle!.components
      .H;
    expect(calcareous).toBeLessThan(acidic);
  });
});
