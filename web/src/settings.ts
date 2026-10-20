import { DEFAULT_FAVOURITES } from '@mf/scoring';

const KEY = 'mf.favourites.v1';

/** Favourite species ids, stored on this device. Falls back to the defaults if storage is empty or unavailable. */
export function loadFavourites(known: string[]): string[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const ids = (JSON.parse(raw) as unknown[]).filter(
        (x): x is string => typeof x === 'string' && known.includes(x),
      );
      if (ids.length) return ids;
    }
  } catch {
    // Private mode or blocked storage: use the defaults.
  }
  return DEFAULT_FAVOURITES.filter((id) => known.includes(id));
}

export function saveFavourites(ids: string[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(ids));
  } catch {
    // Not saved, but still used for this visit.
  }
}
