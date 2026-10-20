import { describe, expect, it } from 'vitest';
import { doyToText, explain } from '../src/explain.js';
import { scoreSpecies } from '../src/score.js';
import { IBERGEREGG, series, sp } from './helpers.js';

const END = '2026-10-23';

describe('why this score', () => {
  it('formats days of the year', () => {
    expect(doyToText(1)).toBe('1 Jan');
    expect(doyToText(285)).toBe('12 Oct');
    expect(doyToText(365 + 31)).toBe('31 Jan');
  });

  it('explains every component in plain English', () => {
    const w = series(END, 60, (lag) => ({
      precip: lag >= 8 && lag <= 12 ? 9 : 1,
      tmin: lag === 1 ? -4 : 5,
    }));
    const s = sp('chanterelle');
    const r = scoreSpecies(s, w, IBERGEREGG);
    const ex = explain(s, r.components, r.details, {
      ...IBERGEREGG,
      ph_source: 'site_type',
      site_type_name: 'Heidelbeer-Tannen-Fichtenwald',
    });
    expect(ex.map((e) => e.key)).toEqual(['S', 'M', 'T', 'F', 'D', 'H']);
    const text = (k: string) => ex.find((e) => e.key === k)!.lines.join(' ');
    expect(text('M')).toMatch(/mm of useful rain 7–14 days ago/);
    expect(text('F')).toMatch(/1 frost night in the last 7 days, 1 of them hard/);
    expect(text('H')).toMatch(/75 % conifers/);
    expect(text('H')).toMatch(/Heidelbeer-Tannen-Fichtenwald/);
    expect(text('H')).toMatch(/faces north/);
    expect(ex.find((e) => e.key === 'F')!.verdict).toBe('poor');
  });

  it('says out of season instead of a confusing low score', () => {
    const s = sp('morel');
    const r = scoreSpecies(s, series(END, 60), { ...IBERGEREGG, elevation: 600 });
    const season = explain(s, r.components, r.details, { ...IBERGEREGG, elevation: 600 })[0]!;
    expect(season.verdict).toBe('poor');
    expect(season.lines[0]).toMatch(/^Out of season: fruits from about 1 Mar to 31 May at 600 m/);
  });
});
