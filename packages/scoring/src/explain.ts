import type { Species } from './schemas.js';
import { shiftedSeason } from './season.js';
import { mainTrees, treeMixOf, type Tree } from './trees.js';
import type { Components, Details } from './types.js';

export type Verdict = 'good' | 'fair' | 'poor';

export interface Explanation {
  key: keyof Components;
  title: string;
  value: number;
  verdict: Verdict;
  lines: string[];
}

/** Habitat facts used in the text (a subset of the habitat build). */
export interface HabitatFacts {
  elevation: number;
  conifer_pct?: number | null;
  forest_pct?: number | null;
  ph_class: string;
  ph_source?: 'site_type' | 'geology' | 'none';
  site_type_name?: string | null;
  /** Site type code (e.g. "7a"): with the conifer share it gives the estimated tree mix. */
  site_type_code?: string | null;
  aspect?: number | null;
  slope?: number | null;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const CUM = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334, 365];

/** Day of year (may be > 365 for seasons over New Year) → "12 Oct". */
export function doyToText(doy: number): string {
  let d = Math.round(doy);
  while (d > 365) d -= 365;
  while (d < 1) d += 365;
  const m = CUM.findIndex((c, i) => d > c && d <= CUM[i + 1]!);
  return `${d - CUM[m]!} ${MONTHS[m]}`;
}

const verdict = (v: number, good = 0.7, fair = 0.4): Verdict =>
  v >= good ? 'good' : v >= fair ? 'fair' : 'poor';
const n0 = (x: number) => Math.round(x).toLocaleString('en-GB');
const n1 = (x: number) => (Math.round(x * 10) / 10).toString();

const PH_TEXT: Record<string, string> = {
  acidic: 'acidic',
  neutral: 'neutral',
  calcareous: 'calcareous (limestone)',
  unknown: 'unknown',
};

/** Plain-English reasons for one species' score, one block per component (SPEC §6, "Why this score"). */
export function explain(
  species: Species,
  c: Components,
  d: Details,
  h: HabitatFacts,
): Explanation[] {
  const out: Explanation[] = [];

  // Season
  const [a, b, cc, e] = shiftedSeason(species, h.elevation);
  const where = `at ${n0(h.elevation)} m`;
  let season: string;
  if (c.S === 0)
    season = `Out of season: fruits from about ${doyToText(a)} to ${doyToText(e)} ${where}.`;
  else if (c.S === 1) season = `Peak season ${where}: ${doyToText(b)} – ${doyToText(cc)}.`;
  else if (d.dayOfYear < b && d.dayOfYear + 365 > e)
    season = `Early in the season; the peak starts around ${doyToText(b)} ${where}.`;
  else season = `Late in the season; it ends around ${doyToText(e)} ${where}.`;
  out.push({ key: 'S', title: 'Season', value: c.S, verdict: verdict(c.S), lines: [season] });

  // Moisture
  const [lo, hi] = d.rainWindow;
  const m = [
    `${n0(d.effectiveRainMm)} mm of useful rain ${lo}–${hi} days ago (full score from about ${n0(species.fullRainMm)} mm).`,
  ];
  if (d.soilScore === null) m.push('No soil moisture data.');
  else
    m.push(
      `Soil moisture ${d.soilScore >= 0.66 ? 'high' : d.soilScore >= 0.33 ? 'average' : 'low'} compared with the last 2 months.`,
    );
  out.push({
    key: 'M',
    title: 'Rain and soil moisture',
    value: c.M,
    verdict: verdict(c.M),
    lines: m,
  });

  // Temperature
  const t = [
    d.meanTemp7d === null
      ? 'No temperature data.'
      : `7-day mean ${d.tempSource === 'soil' ? 'soil ' : ''}temperature ${n1(d.meanTemp7d)} °C; best is ${species.temperature.min}–${species.temperature.max} °C.`,
  ];
  if (d.coolingTrigger) t.push('It turned cooler after warm weather, which often starts a flush.');
  out.push({ key: 'T', title: 'Temperature', value: c.T, verdict: verdict(c.T), lines: t });

  // Frost
  const frost =
    d.frostNights + d.hardFrostNights === 0
      ? 'No frost in the last 7 nights.'
      : `${d.frostNights + d.hardFrostNights} frost night${d.frostNights + d.hardFrostNights > 1 ? 's' : ''} in the last 7 days` +
        (d.hardFrostNights ? `, ${d.hardFrostNights} of them hard (below −3 °C).` : '.') +
        (species.frostTolerance === 'high' ? ' This species copes well with frost.' : '');
  out.push({
    key: 'F',
    title: 'Frost',
    value: c.F,
    verdict: verdict(c.F, 0.9, 0.5),
    lines: [frost],
  });

  // Drought memory
  const pct = d.precip60dNormalMm > 0 ? (100 * d.precip60dMm) / d.precip60dNormalMm : 100;
  const dl = [`Last 60 days: ${n0(d.precip60dMm)} mm of rain, ${n0(pct)} % of normal.`];
  if (c.D < 1) dl.push('After a dry spell, flushes tend to be smaller and later.');
  out.push({
    key: 'D',
    title: 'Dry spell',
    value: c.D,
    verdict: verdict(c.D, 0.9, 0.75),
    lines: dl,
  });

  // Habitat
  const hl: string[] = [];
  hl.push(...treeLines(species, h));
  const phFrom =
    h.ph_source === 'site_type' && h.site_type_name
      ? ` (forest type: ${h.site_type_name})`
      : h.ph_source === 'geology'
        ? ' (from the geology map)'
        : '';
  hl.push(`Soil: ${PH_TEXT[h.ph_class] ?? h.ph_class}${phFrom}.`);
  hl.push(
    `Elevation ${n0(h.elevation)} m (this species: ${n0(species.elevation.min)}–${n0(species.elevation.max)} m).`,
  );
  if (h.forest_pct !== null && h.forest_pct !== undefined)
    hl.push(`Tree cover around the spot: ${n0(h.forest_pct)} %.`);
  if (h.aspect !== null && h.aspect !== undefined && (h.slope ?? 0) >= 5) {
    const dirs = [
      'north',
      'north-east',
      'east',
      'south-east',
      'south',
      'south-west',
      'west',
      'north-west',
    ];
    hl.push(
      `Slope faces ${dirs[Math.round(h.aspect / 45) % 8]} (${n0(h.slope ?? 0)}°)${c.D < 1 && Math.cos((h.aspect * Math.PI) / 180) > 0.5 ? ', which stays moister in a dry spell' : ''}.`,
    );
  }
  out.push({ key: 'H', title: 'Habitat', value: c.H, verdict: verdict(c.H), lines: hl });

  return out;
}

/** Good host: found with the tree clearly more often than the tree occurs; weak: clearly less. */
const GOOD_HOST = 1.3;
const WEAK_HOST = 0.8;
const list = (xs: string[]) =>
  xs.length <= 1 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`;

/** Habitat lines about the trees: the estimated main trees and which of them suit the species. */
export function treeLines(species: Species, h: HabitatFacts): string[] {
  const mix = treeMixOf(h);
  if (!mix) return ['Tree mix not known.'];
  const main = mainTrees(mix);
  const lines = [
    `Main trees here (estimated): ${main.map(([t, v]) => `${t} ${Math.round(v * 100)} %`).join(', ')}.`,
  ];
  const pref = species.hostPreference;
  if (!pref) {
    lines.push(`${species.name} isn't tied to particular trees.`);
    return lines;
  }
  const good = main.filter(([t]) => (pref[t as Tree] ?? 1) >= GOOD_HOST).map(([t]) => t);
  const weak = main.filter(([t]) => (pref[t as Tree] ?? 1) < WEAK_HOST).map(([t]) => t);
  if (good.length)
    lines.push(`Good host trees for ${species.name.toLowerCase()} here: ${list(good)}.`);
  if (weak.length) lines.push(`Weaker hosts for ${species.name.toLowerCase()}: ${list(weak)}.`);
  if (!good.length && !weak.length)
    lines.push(`The trees here are average hosts for ${species.name.toLowerCase()}.`);
  return lines;
}
