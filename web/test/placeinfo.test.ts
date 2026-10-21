import { afterEach, describe, expect, it, vi } from 'vitest';
import { firingNotice } from '../src/placeinfo.js';

const zone = (id: string, kein: boolean[]) => ({
  attributes: {
    id,
    bezeichnung: 'Testzone',
    belegungsdatum: ['21.10.2026', '22.10.2026'],
    zeit_von: ['0730', ''],
    zeit_bis: ['1900', ''],
    kein_schiessen: kein,
    url_en: 'https://www.armee.ch/shootingrangebulletin/1',
  },
});

afterEach(() => vi.unstubAllGlobals());

describe('military firing notices', () => {
  it('warns on a listed firing day, not on a "no firing" day or an unlisted day', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ results: [zone('z1', [false, true])] }))),
    );
    const p = { E: 2672000, N: 1247000, half: 500 };
    const fire = await firingNotice(p, '2026-10-21');
    expect(fire).toMatch(/Military firing notice Wed 21 Oct, 07:30–19:00/);
    expect(fire).toMatch(/covers part of this square/);
    expect(await firingNotice({ ...p, E: p.E + 1 }, '2026-10-22')).toBeNull();
    expect(await firingNotice({ ...p, E: p.E + 2 }, '2026-10-25')).toBeNull();
  });
});
