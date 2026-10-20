/**
 * Categorical slots for species lines, in fixed order (validated for colour-vision deficiency, light and dark).
 * Colour follows the species, never its rank. The 9th species (morel) gets a grey dashed line instead of a new hue.
 */
const LIGHT = [
  '#2a78d6',
  '#eb6834',
  '#1baf7a',
  '#eda100',
  '#e87ba4',
  '#008300',
  '#4a3aa7',
  '#e34948',
];
const DARK = [
  '#3987e5',
  '#d95926',
  '#199e70',
  '#c98500',
  '#d55181',
  '#008300',
  '#9085e9',
  '#e66767',
];
const EXTRA = { light: '#8a8a85', dark: '#9a9a94' };

export const isDark = (): boolean => {
  const t = document.documentElement.dataset.theme;
  if (t) return t === 'dark';
  return matchMedia('(prefers-color-scheme: dark)').matches;
};

export interface SeriesStyle {
  color: string;
  dash?: number[];
}

export const speciesStyle = (index: number): SeriesStyle => {
  const dark = isDark();
  const slots = dark ? DARK : LIGHT;
  return index < slots.length
    ? { color: slots[index]! }
    : { color: dark ? EXTRA.dark : EXTRA.light, dash: [6, 4] };
};

/** Colours for the weather charts: rain (sequential blue), Tmin (slot 1), Tmax (slot 2). */
export const weatherColors = () => {
  const dark = isDark();
  return dark
    ? { rain: '#3987e5', tmin: '#3987e5', tmax: '#d95926' }
    : { rain: '#2a78d6', tmin: '#2a78d6', tmax: '#eb6834' };
};

/** Theme tokens for chart chrome, read from CSS. */
export const cssVar = (name: string): string =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim();
