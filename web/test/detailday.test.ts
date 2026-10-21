// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { closedBadge, updateDetailDay } from '../src/detail.js';
import { fillPlaceInfo, placeInfoSection } from '../src/placeinfo.js';
import type { RulesFile } from '@mf/scoring';

const rules = {
  cantons: {
    ZH: { closedDaysOfMonth: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] },
    SZ: { closedDaysOfMonth: [] },
  },
} as unknown as RulesFile;

// One hazard zone with firing on 21 Oct only; every identify call (stops, trails, zones) gets it.
const zone = {
  geometry: { type: 'MultiPoint', coordinates: [[2672400, 1247400]] },
  attributes: {
    id: 'z1',
    name: 'Stop',
    bezeichnung: 'Testzone',
    belegungsdatum: ['21.10.2026', '22.10.2026'],
    zeit_von: ['0730', ''],
    zeit_bis: ['1900', ''],
    kein_schiessen: [false, true],
  },
};
afterEach(() => vi.unstubAllGlobals());

function panel(): HTMLElement {
  const el = document.createElement('div');
  el.innerHTML = `<div id="closed-day" data-spot-detail="ZH" data-today="2026-10-21"></div>${placeInfoSection()}`;
  return el;
}
const firing = (el: HTMLElement) => el.querySelector<HTMLElement>('#firing')!;

describe('detail follows the day slider', () => {
  it('shows the firing notice only on its day, and updates when the day changes', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ results: [zone] }))),
    );
    const el = panel();
    const place = { E: 2672000, N: 1247000, half: 500 };
    await fillPlaceInfo(el, place, '2026-10-21', '2026-10-21');
    expect(firing(el).hidden).toBe(false);
    expect(firing(el).textContent).toMatch(/Wed 21 Oct, 07:30–19:00/);

    // Slider to 22 Oct (listed, but no firing): the warning goes away.
    updateDetailDay(el, '2026-10-22', rules);
    await vi.waitFor(() => expect(el.querySelector('#place-info')!.textContent).toMatch(/22 Oct/));
    expect(firing(el).hidden).toBe(true);
  });

  it('keeps the newest day when an older answer arrives late', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let calls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        // The first request (for 21 Oct) is slow; the later ones answer at once.
        if (calls++ === 0) await gate;
        return new Response(JSON.stringify({ results: [zone] }));
      }),
    );
    const el = panel();
    const place = { E: 2600000, N: 1200000, half: 0 };
    const slow = fillPlaceInfo(el, place, '2026-10-21', '2026-10-21');
    const fast = fillPlaceInfo(el, place, '2026-10-22', '2026-10-21');
    release();
    await Promise.all([slow, fast]);
    expect(firing(el).hidden).toBe(true);
    expect(el.querySelector('#place-info')!.textContent).toMatch(/22 Oct/);
  });

  it('closed-day badge follows the day, and only in a spot/pin detail', () => {
    const el = panel();
    updateDetailDay(el, '2026-11-03', rules);
    expect(el.querySelector('#closed-day')!.textContent).toMatch(/Closed on Tue 3 Nov/);
    updateDetailDay(el, '2026-10-21', rules);
    expect(el.querySelector('#closed-day')!.textContent).toBe('');
    const square = document.createElement('div');
    square.innerHTML = '<h2>Forest square</h2>';
    expect(() => updateDetailDay(square, '2026-11-03', rules)).not.toThrow();
  });

  it('closed-day badge is for the shown day', () => {
    expect(closedBadge(rules, 'ZH', '2026-11-03', '2026-10-21')).toMatch(
      /Closed on Tue 3 Nov \(ZH rule\)/,
    );
    expect(closedBadge(rules, 'ZH', '2026-11-03', '2026-11-03')).toMatch(/Closed today/);
    expect(closedBadge(rules, 'ZH', '2026-10-21', '2026-10-21')).toBe('');
    expect(closedBadge(rules, 'SZ', '2026-11-03', '2026-10-21')).toBe('');
  });
});
