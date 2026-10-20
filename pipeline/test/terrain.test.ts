import { describe, expect, it } from 'vitest';
import { lv95ToWgs84, wgs84ToLv95 } from '../terrain/lv95.js';
import { majority, phFromLithology, phFromSiteType } from '../terrain/ph.js';

describe('LV95', () => {
  it('matches swisstopo reference points', () => {
    // swisstopo's worked example: 46°2'38.87"N 8°43'49.79"E → E 2'699'999.76 / N 1'099'999.97
    const { E, N } = wgs84ToLv95(46 + 2 / 60 + 38.87 / 3600, 8 + 43 / 60 + 49.79 / 3600);
    expect(Math.abs(E - 2699999.76)).toBeLessThan(1);
    expect(Math.abs(N - 1099999.97)).toBeLessThan(1);
  });

  it('round-trips within a metre', () => {
    const { E, N } = wgs84ToLv95(47.022, 8.708);
    const back = lv95ToWgs84(E, N);
    expect(Math.abs(back.lat - 47.022) * 111_000).toBeLessThan(1);
    expect(Math.abs(back.lon - 8.708) * 76_000).toBeLessThan(1);
  });
});

describe('pH from forest site type', () => {
  it('maps well-known site codes', () => {
    expect(phFromSiteType('46', 'Peitschenmoos-Fichten-Tannenwald')).toBe('acidic');
    expect(phFromSiteType('17', 'Steilhang-Buchenwald mit Buntreitgras')).toBe('calcareous');
    expect(phFromSiteType('8e', 'Waldhirsen-Buchenwald mit Hornstrauch')).toBe('neutral');
    expect(phFromSiteType('18', 'Tannen-Buchenwald')).toBe('neutral');
  });

  it('lets indicators in the name override the unit number', () => {
    expect(phFromSiteType('18M', 'Karbonat-Tannen-Buchenwald')).toBe('calcareous');
    expect(phFromSiteType('18v', 'Buntreitgras-Tannen-Buchenwald mit Rostsegge')).toBe(
      'calcareous',
    );
    expect(phFromSiteType('19', 'Waldsimsen-Tannen-Buchenwald')).toBe('acidic');
  });

  it('uses indicator plants in the name when the code is unknown', () => {
    expect(phFromSiteType('99', 'Heidelbeer-Fichtenwald')).toBe('acidic');
    expect(phFromSiteType(null, 'Seggen-Buchenwald mit Weisssegge')).toBe('calcareous');
    expect(phFromSiteType(null, 'Unbekannter Wald')).toBeNull();
  });
});

describe('pH from geology', () => {
  it('follows the SPEC lithology mapping', () => {
    expect(phFromLithology('Kalkstein: mergelig - Mergel', 'Couches-Rouges')).toBe('calcareous');
    expect(phFromLithology('Sandstein - Tonschiefer', 'Wägital-Flysch')).toBe('acidic');
    expect(phFromLithology('Torf', 'Moor')).toBe('acidic');
    expect(phFromLithology('Nagelfluh', 'Obere Süsswassermolasse')).toBe('calcareous');
    expect(phFromLithology('Kies, sandig', 'Moräne')).toBe('neutral');
    expect(phFromLithology(null, null)).toBe('unknown');
  });

  it('takes the majority of samples, ignoring unknown', () => {
    expect(majority(['acidic', 'calcareous', 'acidic', 'unknown'])).toBe('acidic');
    expect(majority(['unknown'])).toBe('unknown');
  });
});

import { inArea } from '../terrain/sources.js';

describe('point in area', () => {
  const square: [number, number][] = [
    [0, 0],
    [10, 0],
    [10, 10],
    [0, 10],
    [0, 0],
  ];
  const hole: [number, number][] = [
    [4, 4],
    [6, 4],
    [6, 6],
    [4, 6],
    [4, 4],
  ];
  it('handles outer rings and holes', () => {
    const a = { name: 'x', rings: [square, hole] };
    expect(inArea(a, 2, 2)).toBe(true);
    expect(inArea(a, 5, 5)).toBe(false);
    expect(inArea(a, 12, 5)).toBe(false);
  });
});
