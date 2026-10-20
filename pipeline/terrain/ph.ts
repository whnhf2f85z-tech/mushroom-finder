import type { PhClassT } from '@mf/scoring';

/**
 * Soil pH class from a forest site type (NaiS / Ellenberg & Klötzli numbering plus the German name).
 * Site type overrides geology (SPEC §5.3). Only confident cases are mapped; everything else is null.
 */
const ACID_CODES = new Set([1, 2, 3, 4, 19, 46, 47, 56, 57, 58, 59, 68, 71]);
const CALC_CODES = new Set([
  12, 13, 14, 15, 16, 17, 22, 23, 25, 39, 41, 52, 53, 61, 62, 65, 67, 69,
]);
const NEUTRAL_CODES = new Set([6, 7, 8, 9, 10, 11, 18, 20, 21, 24, 26, 27, 30, 48, 49, 50]);

// Indicator plants in the German site names.
const ACID_WORDS =
  /waldsimse|hainsimse|heidelbeer|preiselbeer|torfmoos|peitschenmoos|wollreitgras|alpenlattich|moorbirke|rippenfarn|drahtschmiele/i;
const CALC_WORDS =
  /karbonat|weisssegge|weißsegge|seggen-buchen|blaugras|buntreitgras|zahnwurz|eiben|schneeheide|erika|orchideen|hirschzunge|mehlbeer|bergsegge|lindenmischwald|kalk/i;
const NEUTRAL_WORDS =
  /waldmeister|waldhirse|hochstauden|schachtelhalm|bärlauch|aronstab|lungenkraut|ahorn-eschen|eschen|ahorn/i;

export function phFromSiteType(
  code: string | null | undefined,
  name: string | null | undefined,
): PhClassT | null {
  // Indicator plants or "Karbonat" in the name are the most specific signal (e.g. "18M Karbonat-Tannen-Buchenwald"
  // is a calcareous variant of the otherwise neutral unit 18), then the unit number, then broad neutral words.
  if (name && ACID_WORDS.test(name)) return 'acidic';
  if (name && CALC_WORDS.test(name)) return 'calcareous';
  const n = Number.parseInt(code ?? name ?? '', 10);
  if (ACID_CODES.has(n)) return 'acidic';
  if (CALC_CODES.has(n)) return 'calcareous';
  if (NEUTRAL_CODES.has(n)) return 'neutral';
  if (name && NEUTRAL_WORDS.test(name)) return 'neutral';
  return null;
}

/**
 * Soil pH class from GeoCover lithology (German), SPEC §5.3:
 * acidic = flysch sandstones/shales, siliceous sandstones, decalcified moraine, peat/moor, crystalline;
 * calcareous = limestone, dolomite, marl, calcareous Nagelfluh, calcareous moraine; else neutral.
 */
export function phFromLithology(
  litho: string | null | undefined,
  description: string | null | undefined,
): PhClassT {
  const l = (litho ?? '').toLowerCase();
  const d = (description ?? '').toLowerCase();
  const all = `${l} ${d}`;
  if (!all.trim()) return 'unknown';
  if (/torf|moor|ried/.test(all)) return 'acidic';
  if (/granit|gneis|kristallin|quarzit|radiolarit|glimmerschiefer/.test(all)) return 'acidic';
  if (/entkalkt/.test(all)) return 'acidic';
  if (/kalk|dolomit|mergel|nagelfluh|gips/.test(l)) return 'calcareous';
  if (/flysch/.test(d) || /sandstein|tonschiefer|schiefer|siltstein|tonstein/.test(l))
    return 'acidic';
  if (/kalk|dolomit|mergel/.test(d)) return 'calcareous';
  return 'neutral';
}

/** Most common class among samples, ignoring 'unknown'; 'unknown' if there are none. */
export function majority(classes: PhClassT[]): PhClassT {
  const counts = new Map<PhClassT, number>();
  for (const c of classes) if (c !== 'unknown') counts.set(c, (counts.get(c) ?? 0) + 1);
  let best: PhClassT = 'unknown';
  let n = 0;
  for (const [c, k] of counts) if (k > n) [best, n] = [c, k];
  return best;
}
