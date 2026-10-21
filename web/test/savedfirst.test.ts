// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { encodeScores } from '@mf/scoring';

const COUNT = 3;
const file = (date: string, source: string, v: number) => ({
  schemaVersion: 1,
  date,
  generatedAt: '2026-10-21T04:00:00Z',
  source,
  count: COUNT,
  species: { chanterelle: encodeScores([v, v, v]) },
  staleCells: 0,
});

let saved: Record<string, unknown>;
let network: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.resetModules();
  saved = {};
  vi.stubGlobal('caches', {
    match: async (url: string) => {
      const d = /grid\/(.*)\.json/.exec(url)?.[1];
      return d && saved[d] ? new Response(JSON.stringify(saved[d])) : undefined;
    },
  });
  network = vi.fn(async (url: string) => {
    const d = /grid\/(.*)\.json/.exec(url)![1]!;
    return new Response(JSON.stringify(file(d, d >= '2026-10-22' ? 'forecast' : 'daily', 50)));
  });
  vi.stubGlobal('fetch', network);
});
afterEach(() => vi.unstubAllGlobals());

const load = async () => import('../src/gridlayer.js');

describe('grid days: saved copy first', () => {
  it('uses a saved real day without the network', async () => {
    saved['2026-10-20'] = file('2026-10-20', 'daily', 10);
    const g = await load();
    g.setGridDays(['2026-10-22'], false);
    const d = await g.loadGridDay('2026-10-20', COUNT);
    expect(d!.scores.chanterelle![0]).toBe(10);
    expect(network).not.toHaveBeenCalled();
  });

  it('fetches a day whose saved copy is still the forecast version', async () => {
    saved['2026-10-21'] = file('2026-10-21', 'forecast', 10); // yesterday's forecast for today
    const g = await load();
    g.setGridDays(['2026-10-22'], false);
    const d = await g.loadGridDay('2026-10-21', COUNT);
    expect(d!.scores.chanterelle![0]).toBe(50);
    expect(network).toHaveBeenCalledTimes(1);
  });

  it('uses a saved forecast day, but fetches it again once a newer run came in', async () => {
    saved['2026-10-22'] = file('2026-10-22', 'forecast', 10);
    const g = await load();
    g.setGridDays(['2026-10-22'], false);
    expect((await g.loadGridDay('2026-10-22', COUNT))!.scores.chanterelle![0]).toBe(10);
    expect(network).not.toHaveBeenCalled();
    g.setGridDays(['2026-10-22'], true);
    expect((await g.loadGridDay('2026-10-22', COUNT))!.scores.chanterelle![0]).toBe(50);
    expect(network).toHaveBeenCalledTimes(1);
  });

  it('loads each day only once per session', async () => {
    const g = await load();
    g.setGridDays([], false);
    await Promise.all([g.loadGridDay('2026-10-19', COUNT), g.loadGridDay('2026-10-19', COUNT)]);
    await g.loadGridDay('2026-10-19', COUNT);
    expect(network).toHaveBeenCalledTimes(1);
  });
});
