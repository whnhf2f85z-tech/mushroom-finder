import speciesJson from '../../../data/species.json';
import { SpeciesFileSchema, type Species } from '../src/schemas.js';
import type { DailyWeather, Habitat } from '../src/types.js';

export const SPECIES = SpeciesFileSchema.parse(speciesJson).species;

export const sp = (id: string): Species => {
  const s = SPECIES.find((x) => x.id === id);
  if (!s) throw new Error(`unknown species ${id}`);
  return s;
};

const addDays = (date: string, n: number): string => {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** Mild, damp default day. */
export const BASE_DAY: Omit<DailyWeather, 'date'> = {
  precip: 0,
  tmin: 6,
  tmax: 14,
  tmean: 10,
  rh: 85,
  et0: 1,
  soilMoisture7_28: 0.3,
  soilTemp0_7: 10,
};

/**
 * `days` days of weather ending on `endDate` (oldest first).
 * `f(lag)` overrides fields for the day `lag` days before the end (0 = end day).
 */
export function series(
  endDate: string,
  days: number,
  f: (lag: number) => Partial<DailyWeather> = () => ({}),
): DailyWeather[] {
  const out: DailyWeather[] = [];
  for (let lag = days - 1; lag >= 0; lag--) {
    out.push({ ...BASE_DAY, date: addDays(endDate, -lag), ...f(lag) });
  }
  return out;
}

/** A good, fully known habitat for chanterelles around Ibergeregg. */
export const IBERGEREGG: Habitat = {
  elevation: 1250,
  forest_pct: 80,
  conifer_pct: 75,
  ph_class: 'acidic',
  aspect: 0,
  slope: 15,
  protected: { is: false },
};
