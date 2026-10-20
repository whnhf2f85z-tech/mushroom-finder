import type { Species } from './schemas.js';
import { dayOfYear } from './util.js';

const trapezoid = (x: number, a: number, b: number, c: number, d: number): number => {
  if (x <= a || x >= d) return 0;
  if (x < b) return (x - a) / (b - a);
  if (x <= c) return 1;
  return (d - x) / (d - c);
};

/** Season points (day of year) after the elevation shift. Points may exceed 365 when a season crosses New Year. */
export function shiftedSeason(
  species: Species,
  elevation: number,
): [number, number, number, number] {
  const { season, elevationShift: es } = species;
  const hundreds = (elevation - es.referenceElevation) / 100;
  const startShift = es.startDaysPer100m * hundreds;
  const endShift = es.endDaysPer100m * hundreds;
  let a = dayOfYear(season.start) + startShift;
  let b = dayOfYear(season.peakStart) + startShift;
  let c = dayOfYear(season.peakEnd) + endShift;
  let d = dayOfYear(season.end) + endShift;
  // Unwrap seasons that cross New Year so the points are increasing.
  if (b < a) b += 365;
  if (c < b) c += 365;
  if (d < c) d += 365;
  // Different start/end shifts must not invert the plateau.
  if (c < b) c = b;
  return [a, b, c, d];
}

/** S: 0–1 season score for a date (YYYY-MM-DD) at an elevation. */
export function seasonScore(species: Species, date: string, elevation: number): number {
  const [a, b, c, d] = shiftedSeason(species, elevation);
  const doy = dayOfYear(date);
  return Math.max(
    trapezoid(doy, a, b, c, d),
    trapezoid(doy + 365, a, b, c, d),
    trapezoid(doy - 365, a, b, c, d),
  );
}
