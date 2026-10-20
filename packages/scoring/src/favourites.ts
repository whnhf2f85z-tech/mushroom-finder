/** Species used for the metascore unless the viewer picks others (stored on their device). */
export const DEFAULT_FAVOURITES = [
  'chanterelle',
  'porcini',
  'winter_chanterelle',
  'horn_of_plenty',
  'hedgehog',
];

/** Best score among the chosen species; null if none of them has a score. */
export function bestOf(
  scores: Record<string, number | null | undefined>,
  ids: string[],
): { score: number; id: string } | null {
  let best: { score: number; id: string } | null = null;
  for (const id of ids) {
    const v = scores[id];
    if (v === null || v === undefined) continue;
    if (best === null || v > best.score) best = { score: v, id };
  }
  return best;
}
