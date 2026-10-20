/**
 * WGS84 ↔ Swiss LV95 (EPSG:2056), swisstopo's approximate formulas (accurate to ~1 m, enough for 10 m rasters).
 * Source: swisstopo, "Approximate formulas for the transformation between Swiss projection coordinates and WGS84".
 */
export function wgs84ToLv95(lat: number, lon: number): { E: number; N: number } {
  const p = (lat * 3600 - 169028.66) / 10000;
  const l = (lon * 3600 - 26782.5) / 10000;
  const E = 2600072.37 + 211455.93 * l - 10938.51 * l * p - 0.36 * l * p * p - 44.54 * l ** 3;
  const N =
    1200147.07 +
    308807.95 * p +
    3745.25 * l * l +
    76.63 * p * p -
    194.56 * l * l * p +
    119.79 * p ** 3;
  return { E, N };
}

export function lv95ToWgs84(E: number, N: number): { lat: number; lon: number } {
  const y = (E - 2600000) / 1e6;
  const x = (N - 1200000) / 1e6;
  const l = 2.6779094 + 4.728982 * y + 0.791484 * y * x + 0.1306 * y * x * x - 0.0436 * y ** 3;
  const p =
    16.9023892 +
    3.238272 * x -
    0.270978 * y * y -
    0.002528 * x * x -
    0.0447 * y * y * x -
    0.014 * x ** 3;
  return { lat: (p * 100) / 36, lon: (l * 100) / 36 };
}
