/**
 * The copy of a file the offline cache already holds (instant, no network), or null. Lets the app show the saved
 * scores at once and check for newer ones afterwards, instead of waiting for the network on every refresh.
 */
export async function savedJson(url: string): Promise<unknown | null> {
  try {
    if (!('caches' in globalThis)) return null;
    const res = await caches.match(new URL(url, location.href).href, { ignoreSearch: true });
    return res ? await res.json() : null;
  } catch {
    return null;
  }
}
