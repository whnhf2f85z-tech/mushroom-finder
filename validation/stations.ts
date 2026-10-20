/**
 * Part D, weather check: Open-Meteo (best_match, as used by the app) against MeteoSwiss measurements at all
 * stations within 3 km of a forest square in Zürich and Schwyz: automatic weather stations (rain + temperature),
 * automatic rain gauges and manual rain gauges. Mushroom seasons 2025 (Apr–Nov) and 2026 (Jan – 18 Oct).
 * Open-Meteo is read twice per station: at the station itself (how good is the model there?) and at the app's
 * nearest grid weather point, shifted to the station's height (what a square there actually gets).
 *   npx tsx validation/stations.ts   → validation/results/stations.json
 * ~3,500 Open-Meteo calls: run it on GitHub Actions ("Validation (manual)") if the local daily quota is used up.
 * Source of the measurements: MeteoSwiss open data (OGD), data.geo.admin.ch; "Source: MeteoSwiss".
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DEFAULT_FAVOURITES,
  GridFileSchema,
  HISTORICAL_FORECAST_URL,
  RateLimiter,
  SCORE_BANDS,
  SpeciesFileSchema,
  adjustForElevation,
  bandFor,
  defaultDeps,
  fetchWeather,
  mergeDays,
  scoreSpecies,
  type DailyWeather,
  type WeatherLocation,
} from '@mf/scoring';

const DIR = import.meta.dirname;
const ROOT = join(DIR, '..');
const CACHE = join(DIR, 'cache', 'stations');
mkdirSync(CACHE, { recursive: true });
mkdirSync(join(DIR, 'results'), { recursive: true });

const grid = GridFileSchema.parse(
  JSON.parse(readFileSync(join(ROOT, 'web/public/data/static/grid.json'), 'utf8')),
);
const species = SpeciesFileSchema.parse(
  JSON.parse(readFileSync(join(ROOT, 'data/species.json'), 'utf8')),
).species;
const favourites = species.filter((s) => DEFAULT_FAVOURITES.includes(s.id));

const PERIODS = [
  { start: '2025-04-01', end: '2025-11-15', scoreFrom: '2025-06-01' },
  { start: '2026-01-01', end: '2026-10-18', scoreFrom: '2026-06-01' },
];
const MAX_DISTANCE_KM = 3;
const NETWORKS = [
  { id: 'ogd-smn', label: 'automatic station', temperature: true },
  { id: 'ogd-smn-precip', label: 'automatic rain gauge', temperature: false },
  { id: 'ogd-nime', label: 'manual rain gauge', temperature: false },
] as const;

const addDays = (d: string, n: number) => {
  const t = new Date(`${d}T12:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
};
const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length;

async function text(url: string, cacheName: string): Promise<string | null> {
  const path = join(CACHE, cacheName);
  if (existsSync(path)) return readFileSync(path, 'utf8');
  const res = await fetch(url);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const t = new TextDecoder('latin1').decode(await res.arrayBuffer());
  writeFileSync(path, t);
  return t;
}
const csv = (t: string) => {
  const [head, ...rows] = t.trim().split(/\r?\n/);
  const cols = head!.split(';');
  return rows.map(
    (r) => Object.fromEntries(r.split(';').map((v, i) => [cols[i], v])) as Record<string, string>,
  );
};

// Stations near forest squares ---------------------------------------------------------------------------------

interface Station {
  abbr: string;
  name: string;
  network: (typeof NETWORKS)[number];
  E: number;
  N: number;
  lat: number;
  lon: number;
  elevation: number;
  distanceKm: number;
  weatherPoint: number;
}
const cellE = grid.cells.e.map((e) => (e + 0.5) * 1000);
const cellN = grid.cells.n.map((n) => (n + 0.5) * 1000);
const stations: Station[] = [];
for (const network of NETWORKS) {
  const base = `https://data.geo.admin.ch/ch.meteoschweiz.${network.id}`;
  const meta = csv(
    (await text(`${base}/${network.id}_meta_stations.csv`, `${network.id}_meta.csv`))!,
  );
  for (const m of meta) {
    const E = Number(m.station_coordinates_lv95_east);
    const N = Number(m.station_coordinates_lv95_north);
    let best = Infinity;
    let cell = -1;
    for (let i = 0; i < cellE.length; i++) {
      const d = Math.hypot(cellE[i]! - E, cellN[i]! - N);
      if (d < best) [best, cell] = [d, i];
    }
    if (best / 1000 > MAX_DISTANCE_KM) continue;
    // A station listed in several networks is kept once, with the most complete one (automatic first).
    if (stations.some((s) => s.abbr === m.station_abbr)) continue;
    stations.push({
      abbr: m.station_abbr!,
      name: m.station_name!,
      network,
      E,
      N,
      lat: Number(m.station_coordinates_wgs84_lat),
      lon: Number(m.station_coordinates_wgs84_lon),
      elevation: Number(m.station_height_masl),
      distanceKm: best / 1000,
      weatherPoint: grid.cells.weather[cell]!,
    });
  }
}
console.log(`${stations.length} stations within ${MAX_DISTANCE_KM} km of a forest square`);

// Measurements: daily rain (rre150d0) and, at automatic stations, daily mean/min/max temperature.
interface Measured {
  precip?: number;
  tmean?: number;
  tmin?: number;
  tmax?: number;
}
const measured = new Map<string, Map<string, Measured>>();
for (const s of stations) {
  const base = `https://data.geo.admin.ch/ch.meteoschweiz.${s.network.id}/${s.abbr.toLowerCase()}`;
  const byDate = new Map<string, Measured>();
  for (const part of ['historical', 'recent']) {
    const t = await text(
      `${base}/${s.network.id}_${s.abbr.toLowerCase()}_d_${part}.csv`,
      `${s.abbr}_d_${part}.csv`,
    );
    if (!t) continue;
    for (const r of csv(t)) {
      const [dd, mm, yyyy] = r.reference_timestamp!.slice(0, 10).split('.');
      const date = `${yyyy}-${mm}-${dd}`;
      if (date < PERIODS[0]!.start) continue;
      const num = (k: string) => (r[k] === undefined || r[k] === '' ? undefined : Number(r[k]));
      byDate.set(date, {
        precip: num('rre150d0'),
        tmean: num('tre200d0'),
        tmin: num('tre200dn'),
        tmax: num('tre200dx'),
      });
    }
  }
  measured.set(s.abbr, byDate);
}

if (process.env.STATIONS_ONLY === '1') {
  for (const s of stations) {
    const m = measured.get(s.abbr)!;
    const n = [...m.values()].filter((v) => v.precip !== undefined).length;
    console.log(
      `${s.abbr} ${s.name} (${s.network.id}, ${s.elevation} m, ${s.distanceKm.toFixed(1)} km): ${n} rain days`,
    );
  }
  process.exit(0);
}

// Open-Meteo at the stations and at their weather points -------------------------------------------------------

const limiter = new RateLimiter(450, defaultDeps.sleep);
const deps = { ...defaultDeps, limiter, log: () => {} };
const atStation: WeatherLocation[] = stations.map((s) => ({
  id: s.abbr,
  lat: s.lat,
  lon: s.lon,
  elevation: s.elevation,
}));
const points = [...new Set(stations.map((s) => s.weatherPoint))];
const atPoint: WeatherLocation[] = points.map((k) => ({
  id: `wp${k}`,
  lat: grid.weatherPoints.lat[k]!,
  lon: grid.weatherPoints.lon[k]!,
  elevation: grid.weatherPoints.elevation[k]!,
}));
const om = new Map<string, DailyWeather[]>();
let calls = 0;
for (const p of PERIODS) {
  const locs = [...atStation, ...atPoint];
  const path = join(CACHE, `om_${p.start}_${p.end}_${locs.length}.json`);
  let byId: Record<string, DailyWeather[]> = {};
  if (existsSync(path)) byId = JSON.parse(readFileSync(path, 'utf8'));
  else {
    for (let i = 0; i < locs.length; i += 15) {
      const r = await fetchWeather(
        HISTORICAL_FORECAST_URL,
        locs.slice(i, i + 15),
        { start_date: p.start, end_date: p.end },
        deps,
      );
      calls += r.calls;
      if (r.failed.length)
        throw new Error(`Open-Meteo failed for ${r.failed.length} locations (daily limit?)`);
      Object.assign(byId, Object.fromEntries(r.weather));
    }
    writeFileSync(path, JSON.stringify(byId));
  }
  for (const [id, w] of Object.entries(byId)) om.set(id, mergeDays(om.get(id) ?? [], w));
  console.log(
    `Open-Meteo ${p.start} → ${p.end}: ${locs.length} locations (${calls.toFixed(0)} calls so far)`,
  );
}

// Comparison ---------------------------------------------------------------------------------------------------

const inPeriods = (d: string) => PERIODS.some((p) => d >= p.start && d <= p.end);
const corr = (a: number[], b: number[]) => {
  const ma = mean(a);
  const mb = mean(b);
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < a.length; i++) {
    num += (a[i]! - ma) * (b[i]! - mb);
    da += (a[i]! - ma) ** 2;
    db += (b[i]! - mb) ** 2;
  }
  return num / Math.sqrt(da * db);
};
/** Sums of the last `n` days for every day that has n complete days. */
function rolling(dates: string[], get: (d: string) => number | undefined, n: number) {
  const out = new Map<string, number>();
  for (const d of dates) {
    let s = 0;
    let ok = true;
    for (let k = 0; k < n; k++) {
      const v = get(addDays(d, -k));
      if (v === undefined) {
        ok = false;
        break;
      }
      s += v;
    }
    if (ok) out.set(d, s);
  }
  return out;
}

/**
 * MeteoSwiss daily rain (rre150d0) runs 06–06 UTC; Open-Meteo days are local calendar days. Find the shift
 * (measured day D vs Open-Meteo day D + shift) with the best correlation over all stations, per network.
 */
const shiftFor: Record<string, number> = {};
for (const network of NETWORKS) {
  let bestShift = 0;
  let bestR = -2;
  for (const shift of [-1, 0, 1]) {
    const a: number[] = [];
    const b: number[] = [];
    for (const s of stations.filter((x) => x.network.id === network.id)) {
      const m = measured.get(s.abbr)!;
      const w = new Map(om.get(s.abbr)!.map((x) => [x.date, x]));
      for (const [d, v] of m) {
        const o = w.get(addDays(d, shift));
        if (v.precip !== undefined && o && inPeriods(d)) {
          a.push(v.precip);
          b.push(o.precip);
        }
      }
    }
    if (a.length) {
      const r = corr(a, b);
      if (r > bestR) [bestR, bestShift] = [r, shift];
    }
  }
  shiftFor[network.id] = bestShift;
  console.log(
    `${network.id}: measured day D matches Open-Meteo day D${bestShift >= 0 ? '+' : ''}${bestShift} (r = ${bestR.toFixed(2)})`,
  );
}

const results = [];
for (const s of stations) {
  const m = measured.get(s.abbr)!;
  const shift = shiftFor[s.network.id]!;
  const wStation = new Map(om.get(s.abbr)!.map((x) => [x.date, x]));
  // The point's weather as a square at the station's height would get it (temperatures shifted by the lapse rate).
  const pointSeries = adjustForElevation(
    om.get(`wp${s.weatherPoint}`)!,
    s.elevation - grid.weatherPoints.elevation[s.weatherPoint]!,
  );
  const wPoint = new Map(pointSeries.map((x) => [x.date, x]));
  const dates = [...m.keys()].filter(inPeriods).sort();
  const rainDates = dates.filter(
    (d) => m.get(d)!.precip !== undefined && wStation.has(addDays(d, shift)),
  );
  const total = PERIODS.reduce(
    (n, p) => n + 1 + (Date.parse(p.end) - Date.parse(p.start)) / 86_400_000,
    0,
  );
  const complete = rainDates.length / total;

  const rainStats = (w: Map<string, DailyWeather>) => {
    const meas = rainDates.map((d) => m.get(d)!.precip!);
    const mod = rainDates.map((d) => w.get(addDays(d, shift))!.precip);
    const get = (src: 'm' | 'o') => (d: string) =>
      src === 'm' ? m.get(d)?.precip : w.get(addDays(d, shift))?.precip;
    const window = (n: number) => {
      const a = rolling(rainDates, get('m'), n);
      const b = rolling(rainDates, get('o'), n);
      const ks = [...a.keys()].filter((k) => b.has(k));
      return {
        r: corr(
          ks.map((k) => a.get(k)!),
          ks.map((k) => b.get(k)!),
        ),
        ratio: mean(ks.map((k) => b.get(k)!)) / mean(ks.map((k) => a.get(k)!)),
        mae: mean(ks.map((k) => Math.abs(b.get(k)! - a.get(k)!))),
      };
    };
    // Rain days ≥ 5 mm: share found by the model (hits) and model rain days without measured rain ≥ 1 mm.
    const wet = rainDates.filter((d) => m.get(d)!.precip! >= 5);
    const modelWet = rainDates.filter((d) => w.get(addDays(d, shift))!.precip >= 5);
    return {
      days: rainDates.length,
      totalMeasured: meas.reduce((a, b) => a + b, 0),
      totalModel: mod.reduce((a, b) => a + b, 0),
      dailyR: corr(meas, mod),
      dailyMae: mean(meas.map((x, i) => Math.abs(mod[i]! - x))),
      sum11: window(11),
      sum60: window(60),
      wetDaysHit: wet.filter((d) => w.get(addDays(d, shift))!.precip >= 2).length / wet.length,
      falseWet: modelWet.filter((d) => m.get(d)!.precip! < 1).length / Math.max(1, modelWet.length),
    };
  };
  const tempStats = (w: Map<string, DailyWeather>) => {
    const ds = dates.filter((d) => m.get(d)!.tmean !== undefined && w.has(d));
    if (ds.length < 100) return null;
    const bias = mean(ds.map((d) => w.get(d)!.tmean - m.get(d)!.tmean!));
    const mae = mean(ds.map((d) => Math.abs(w.get(d)!.tmean - m.get(d)!.tmean!)));
    const minBias = mean(
      ds.filter((d) => m.get(d)!.tmin !== undefined).map((d) => w.get(d)!.tmin - m.get(d)!.tmin!),
    );
    // 7-day means, as the temperature score uses them.
    const a = rolling(ds, (d) => m.get(d)?.tmean, 7);
    const b = rolling(ds, (d) => w.get(d)?.tmean, 7);
    const ks = [...a.keys()].filter((k) => b.has(k));
    const mae7 = mean(ks.map((k) => Math.abs(b.get(k)! - a.get(k)!) / 7));
    // Frost nights (tmin ≤ −1 °C) in autumn: measured vs model.
    const autumn = ds.filter((d) => d.slice(5) >= '09-01' && m.get(d)!.tmin !== undefined);
    return {
      days: ds.length,
      bias,
      mae,
      mae7,
      minBias,
      frostMeasured: autumn.filter((d) => m.get(d)!.tmin! <= -1).length,
      frostModel: autumn.filter((d) => w.get(d)!.tmin <= -1).length,
    };
  };

  // Score impact: the app's weather at the point, with measured rain (and temperatures where measured) put in.
  const scoreImpact = () => {
    const replaced = pointSeries.map((x) => {
      const v = m.get(addDays(x.date, -shift));
      const t = s.network.temperature ? m.get(x.date) : undefined;
      return {
        ...x,
        precip: v?.precip ?? x.precip,
        ...(t?.tmean !== undefined && t.tmin !== undefined && t.tmax !== undefined
          ? { tmean: t.tmean, tmin: t.tmin, tmax: t.tmax }
          : {}),
      };
    });
    const diffs: number[] = [];
    let bandChanges = 0;
    for (const p of PERIODS) {
      for (let d = p.scoreFrom; d <= p.end; d = addDays(d, 1)) {
        if (d.slice(5) > '11-15') break;
        const k = pointSeries.findIndex((x) => x.date === d);
        if (k < 61) continue;
        const habitat = { elevation: s.elevation, ph_class: 'unknown' as const };
        const best = (w: DailyWeather[]) =>
          Math.max(...favourites.map((sp) => scoreSpecies(sp, w, habitat).score));
        const a = best(pointSeries.slice(0, k + 1));
        const b = best(replaced.slice(0, k + 1));
        diffs.push(a - b);
        if (bandFor(a).label !== bandFor(b).label) bandChanges++;
      }
    }
    const abs = diffs.map(Math.abs).sort((x, y) => x - y);
    return {
      days: diffs.length,
      meanDiff: mean(diffs),
      meanAbsDiff: mean(abs),
      p90AbsDiff: abs[Math.floor(0.9 * abs.length)]!,
      bandChangeShare: bandChanges / diffs.length,
    };
  };

  results.push({
    abbr: s.abbr,
    name: s.name,
    network: s.network.label,
    elevation: s.elevation,
    distanceToForestKm: Math.round(s.distanceKm * 10) / 10,
    weatherPoint: s.weatherPoint,
    pointElevation: grid.weatherPoints.elevation[s.weatherPoint],
    complete,
    rain: complete >= 0.9 ? { station: rainStats(wStation), point: rainStats(wPoint) } : null,
    temperature: s.network.temperature
      ? { station: tempStats(wStation), point: tempStats(wPoint) }
      : null,
    scoreImpact: complete >= 0.9 ? scoreImpact() : null,
  });
}

writeFileSync(
  join(DIR, 'results', 'stations.json'),
  JSON.stringify(
    {
      periods: PERIODS,
      maxDistanceKm: MAX_DISTANCE_KM,
      shift: shiftFor,
      bands: SCORE_BANDS.map((b) => b.label),
      calls: Math.round(calls),
      stations: results,
    },
    null,
    1,
  ),
);
for (const r of results)
  console.log(
    `${r.abbr.padEnd(4)} ${r.name.slice(0, 22).padEnd(22)} ${r.network.padEnd(20)} ${String(r.elevation).padStart(5)} m`,
    r.rain
      ? `rain ${r.rain.station.totalMeasured.toFixed(0)} mm, model ×${(r.rain.station.totalModel / r.rain.station.totalMeasured).toFixed(2)} (point ×${(r.rain.point.totalModel / r.rain.point.totalMeasured).toFixed(2)}), 11-day r ${r.rain.point.sum11.r.toFixed(2)}`
      : `incomplete (${(100 * r.complete).toFixed(0)} %)`,
    r.temperature?.point ? `T bias ${r.temperature.point.bias.toFixed(2)} °C` : '',
    r.scoreImpact ? `score |Δ| ${r.scoreImpact.meanAbsDiff.toFixed(1)}` : '',
  );
