/**
 * Natural main tree species of a forest site type (SZ Waldstandorte / ZH Waldvegetationskarte, both numbered after
 * Ellenberg & Klötzli 1972 and NaiS). Shares are rounded approximations of the main species named for each group
 * (see docs/DATA_SOURCES.md, "Site type → main trees"); they describe the natural forest, not the current stand.
 */

export const TREES = [
  'spruce',
  'fir',
  'pine',
  'larch',
  'beech',
  'oak',
  'ash',
  'maple',
  'hornbeam',
  'lime',
  'birch',
  'alder',
  'other',
] as const;
export type Tree = (typeof TREES)[number];
export type TreeMix = Partial<Record<Tree, number>>;
export const CONIFERS: readonly Tree[] = ['spruce', 'fir', 'pine', 'larch'];

interface Group {
  /** Unit numbers (leading integer of the code). */
  units: [number, number];
  label: string;
  trees: TreeMix;
}

/** Groups of site types by unit number, with their natural main trees (shares sum to 1). */
export const SITE_GROUPS: Group[] = [
  {
    units: [1, 5],
    label: 'Acid beech forests (Hainsimsen-/Waldsimsen-Buchenwälder)',
    trees: { beech: 0.75, oak: 0.15, fir: 0.1 },
  },
  {
    units: [6, 11],
    label:
      'Beech forests on mull soils (Waldmeister-, Waldhirsen-, Lungenkraut-, Aronstab-Buchenwälder)',
    trees: { beech: 0.7, oak: 0.1, ash: 0.1, maple: 0.05, fir: 0.05 },
  },
  {
    units: [12, 13],
    label: 'Beech forests on base-rich soils (Zahnwurz-, Bingelkraut-Buchenwälder)',
    trees: { beech: 0.7, maple: 0.1, ash: 0.1, fir: 0.1 },
  },
  {
    units: [14, 17],
    label:
      'Dry limestone beech forests (Seggen-, Weisseggen-, Bergseggen-, Eiben-, Steilhang-Buchenwälder)',
    trees: { beech: 0.8, oak: 0.05, maple: 0.05, pine: 0.05, other: 0.05 },
  },
  {
    units: [18, 21],
    label: 'Fir-beech forests (Tannen-Buchenwälder)',
    trees: { beech: 0.5, fir: 0.4, spruce: 0.1 },
  },
  {
    units: [22, 24],
    label: 'Maple forests on scree (Ahornwälder)',
    trees: { maple: 0.5, ash: 0.2, lime: 0.2, beech: 0.1 },
  },
  {
    units: [25, 25],
    label: 'Lime forests (Lindenwälder)',
    trees: { lime: 0.5, maple: 0.2, beech: 0.2, ash: 0.1 },
  },
  {
    units: [26, 26],
    label: 'Maple-ash forests (Ahorn-Eschenwälder)',
    trees: { ash: 0.45, maple: 0.35, beech: 0.1, fir: 0.1 },
  },
  {
    units: [27, 30],
    label:
      'Ash forests on wet soils and floodplains (Bach-, Seggen-, Zweiblatt-, Traubenkirschen-Eschenwälder, Ulmen-Eschen-Auenwald)',
    trees: { ash: 0.6, alder: 0.2, maple: 0.1, oak: 0.1 },
  },
  {
    units: [31, 32],
    label: 'Alder floodplain forests (Erlen-Auenwälder)',
    trees: { alder: 0.7, ash: 0.2, other: 0.1 },
  },
  {
    units: [33, 37],
    label: 'Oak-hornbeam forests (Hainbuchen-/Eichenmischwälder)',
    trees: { hornbeam: 0.4, oak: 0.3, beech: 0.2, lime: 0.1 },
  },
  {
    units: [38, 43],
    label: 'Oak forests (Eichenwälder)',
    trees: { oak: 0.7, pine: 0.1, hornbeam: 0.1, lime: 0.1 },
  },
  {
    units: [44, 45],
    label: 'Pine-birch bog forests (Föhren-Birkenbruchwälder)',
    trees: { pine: 0.5, birch: 0.4, spruce: 0.1 },
  },
  {
    units: [46, 51],
    label: 'Fir-spruce forests (Tannen-Fichtenwälder)',
    trees: { spruce: 0.5, fir: 0.45, other: 0.05 },
  },
  {
    units: [52, 60],
    label: 'Spruce forests (Fichtenwälder)',
    trees: { spruce: 0.85, fir: 0.05, larch: 0.05, maple: 0.05 },
  },
  {
    units: [61, 66],
    label: 'Scots pine forests (Föhrenwälder)',
    trees: { pine: 0.8, spruce: 0.1, oak: 0.05, beech: 0.05 },
  },
  {
    units: [67, 71],
    label: 'Mountain pine forests (Bergföhrenwälder)',
    trees: { pine: 0.8, spruce: 0.2 },
  },
  {
    units: [72, 72],
    label: 'Stone pine / larch forests (Arven-, Lärchen-Arvenwälder)',
    trees: { pine: 0.5, larch: 0.4, spruce: 0.1 },
  },
];

/** Natural main trees of a site type, or null if the code isn't a forest unit (e.g. "ub" unbestockt). */
export function naturalTrees(
  code: string | null | undefined,
  name?: string | null,
): TreeMix | null {
  if (!code) return null;
  if (/^AV\b/.test(code) || /grünerle/i.test(name ?? '')) return { alder: 1 };
  const n = Number.parseInt(code.replace(/^\(/, ''), 10);
  if (!Number.isFinite(n)) return null;
  return SITE_GROUPS.find((g) => n >= g.units[0] && n <= g.units[1])?.trees ?? null;
}

/**
 * Estimated current tree mix of a place: the measured conifer share (NFI, current stand) split among the site's
 * natural conifers, the rest among its natural broadleaves. Where conifers are less than 30 % of the natural forest
 * (e.g. lowland beech sites), today's conifers are taken as planted spruce, by far the most planted tree.
 * Broadleaves where the site has none: beech/maple/ash. Without a site type: conifers 70 % spruce / 30 % fir.
 */
export function currentTreeMix(site: TreeMix | null, coniferPct: number | null): TreeMix {
  const coniferShare = (coniferPct ?? 40) / 100;
  // (Without a measured conifer share use treeMixOf, which falls back to the natural mix.)
  const nat = site ?? {};
  const split = (keys: readonly Tree[], fallback: TreeMix): TreeMix => {
    const part = Object.fromEntries(
      Object.entries(nat).filter(([t]) => keys.includes(t as Tree)),
    ) as TreeMix;
    const sum = Object.values(part).reduce((a, b) => a + b, 0);
    return sum > 0
      ? Object.fromEntries(Object.entries(part).map(([t, v]) => [t, v / sum]))
      : fallback;
  };
  const naturalConifers = CONIFERS.reduce((a, t) => a + (nat[t] ?? 0), 0);
  const conifers =
    site && naturalConifers >= 0.3
      ? split(CONIFERS, { spruce: 1 })
      : site
        ? { spruce: 1 }
        : { spruce: 0.7, fir: 0.3 };
  const broadleaves = split(
    TREES.filter((t) => !CONIFERS.includes(t)),
    { beech: 0.5, maple: 0.25, ash: 0.25 },
  );
  const mix: TreeMix = {};
  for (const [t, v] of Object.entries(conifers))
    mix[t as Tree] = (mix[t as Tree] ?? 0) + v * coniferShare;
  for (const [t, v] of Object.entries(broadleaves))
    mix[t as Tree] = (mix[t as Tree] ?? 0) + v * (1 - coniferShare);
  return mix;
}

/**
 * Tree mix of a place from its site type code and measured conifer share; the natural mix if the conifer share is
 * unknown; null if neither is known.
 */
export function treeMixOf(p: {
  site_type_code?: string | null;
  conifer_pct?: number | null;
}): TreeMix | null {
  const site = naturalTrees(p.site_type_code);
  if (p.conifer_pct === undefined || p.conifer_pct === null) return site;
  return currentTreeMix(site, p.conifer_pct);
}

/** Trees of a mix with at least `min` share, largest first. */
export const mainTrees = (mix: TreeMix, min = 0.1): [Tree, number][] =>
  (Object.entries(mix) as [Tree, number][])
    .filter(([t, v]) => v >= min && t !== 'other')
    .sort((a, b) => b[1] - a[1]);
