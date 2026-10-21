import { describe, expect, it } from 'vitest';
import { doyToText, explain, treeLines } from '../src/explain.js';
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
      site_type_code: '46',
    });
    expect(ex.map((e) => e.key)).toEqual(['S', 'M', 'T', 'F', 'D', 'H']);
    const text = (k: string) => ex.find((e) => e.key === k)!.lines.join(' ');
    expect(text('M')).toMatch(/mm of useful rain 7–14 days ago/);
    expect(text('F')).toMatch(/1 frost night in the last 7 days, 1 of them hard/);
    // 75 % conifers on a fir-spruce site (natural spruce 50 %, fir 45 %): spruce 39 %, fir 36 %.
    expect(text('H')).toMatch(/Main trees here \(estimated\): spruce 39 %, fir 36 %/);
    expect(text('H')).toMatch(/Good host trees for chanterelle here: fir/);
    expect(text('H')).toMatch(/Weaker hosts for chanterelle: spruce/);
    expect(text('H')).toMatch(/Heidelbeer-Tannen-Fichtenwald/);
    expect(text('H')).toMatch(/faces north/);
    expect(ex.find((e) => e.key === 'F')!.verdict).toBe('poor');
  });

  it('says out of season instead of a confusing low score', () => {
    const s = sp('morel');
    const r = scoreSpecies(s, series(END, 60), { ...IBERGEREGG, elevation: 600 });
    const season = explain(s, r.components, r.details, { ...IBERGEREGG, elevation: 600 })[0]!;
    expect(season.verdict).toBe('poor');
    expect(season.lines[0]).toMatch(
      /^Out of season: fruits from about \d+ Mar to \d+ (May|Jun) at 600 m/,
    );
  });
});

describe('why this score: host trees', () => {
  it('says when a species is not tied to trees, and when the tree mix is unknown', () => {
    const facts = { elevation: 800, ph_class: 'neutral', site_type_code: '7a', conifer_pct: 30 };
    expect(treeLines(sp('parasol'), facts).join(' ')).toMatch(/isn't tied to particular trees/);
    expect(treeLines(sp('chanterelle'), { elevation: 800, ph_class: 'neutral' })).toEqual([
      'Tree mix not known.',
    ]);
    // Beech site with 30 % planted spruce: beech is a good host for horn of plenty, spruce a weak one.
    const t = treeLines(sp('horn_of_plenty'), facts).join(' ');
    expect(t).toMatch(/Good host trees for horn of plenty here: beech/);
    expect(t).toMatch(/Weaker hosts for horn of plenty: spruce/);
  });
});
