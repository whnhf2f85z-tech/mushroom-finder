import {
  bandFor,
  cellHabitat,
  elevationAboveWeatherPoint,
  isClosedDay,
  weatherDistanceKm,
  seasonScore,
  type GridFile,
  type RulesFile,
  type Species,
  mainTrees,
  treeMixOf,
} from '@mf/scoring';
import { scoreChart, type LineSeries, type VisitMarker } from './charts.js';
import { speciesStyle } from './colors.js';
import { badge } from './detail.js';
import { dayMonth, esc, shortDate } from './format.js';
import { cellCenter, cellScore, loadGridDay } from './gridlayer.js';
import { scorePlaceLive } from './live.js';
import { fillPlaceInfo, placeInfoSection } from './placeinfo.js';
import { whyHtml } from './why.js';

export interface CellContext {
  grid: GridFile;
  species: Species[];
  favourites: string[];
  rules: RulesFile;
  today: string;
  /** All dates of the chart: 14 past days then the forecast days. */
  dates: string[];
  forecastFrom: number;
  /** Index of the date picked with the slider. */
  dayIndex: number;
  onClose: () => void;
  onLogVisit: () => void;
  visits: VisitMarker[];
}

let cleanup: (() => void) | null = null;

const PH = {
  acidic: 'acidic',
  neutral: 'neutral',
  calcareous: 'calcareous (limestone)',
  unknown: 'not known',
};
const DIRS = [
  'north',
  'north-east',
  'east',
  'south-east',
  'south',
  'south-west',
  'west',
  'north-west',
];

export async function renderCellDetail(
  el: HTMLElement,
  i: number,
  ctx: CellContext,
): Promise<void> {
  cleanup?.();
  cleanup = null;
  const g = ctx.grid;
  const c = g.cells;
  const canton = c.canton[i]!;
  const date = ctx.dates[ctx.dayIndex] ?? ctx.today;
  const center = cellCenter(g, i);
  const r = ctx.rules.cantons[canton];
  const site = c.site[i] !== null ? g.siteTypes[c.site[i]!] : null;
  const protName = c.protectedName[i] !== null ? g.protectedNames[c.protectedName[i]!] : null;
  const closed = isClosedDay(ctx.rules, canton, date);
  const dz = elevationAboveWeatherPoint(g, i);

  el.innerHTML = `
    <div class="detail-head">
      <div>
        <h2>Forest square ${c.e[i]}/${c.n[i]}</h2>
        <p class="small">${canton} · 1 × 1 km · about ${c.elevation[i]} m · ${c.forest[i]} % tree cover</p>
      </div>
      <button type="button" class="close" aria-label="Close">×</button>
    </div>
    ${closed ? `<p><span class="badge closed">Closed on ${shortDate(date)} (${canton} rule)</span></p>` : ''}
    ${c.protected[i] === 2 ? `<p class="badge closed">No picking in part of this square: ${esc(protName ?? 'reserve')}</p>` : ''}
    ${c.protected[i] === 1 ? `<p class="small"><strong>Protected area in this square:</strong> ${esc(protName ?? '')}. Check its rules before picking.</p>` : ''}
    <div class="actions actions-top"><button type="button" class="action-button" data-act="log">Log a visit</button></div>
    <div id="cell-body"><p class="small">Loading scores…</p></div>
    <h3>About this square</h3>
    <p class="small">
      Trees: ${treesText(site?.code ?? null, c.conifer[i] ?? null)}.
      Soil: ${PH[c.ph[i]!]}${site ? ` (forest type: ${esc(site.code)} ${esc(site.name)})` : c.phSource[i] === 'geology' ? ' (from the geology map)' : ''}.
      ${c.aspect[i] !== null && c.slope[i]! >= 5 ? `Mostly ${DIRS[Math.round(c.aspect[i]! / 45) % 8]}-facing slopes (${Math.round(c.slope[i]!)}°).` : ''}
    </p>
    <h3>Weather point</h3>
    <p class="small">
      Weather comes from a point ${weatherDistanceKm(g, i).toFixed(1)} km away at ${g.weatherPoints.elevation[c.weather[i]!]} m.
      This square is ${Math.abs(dz)} m ${dz >= 0 ? 'higher' : 'lower'}, so its temperatures are adjusted by
      ${(Math.abs(dz) * 0.0065).toFixed(1)} °C (${dz >= 0 ? 'cooler' : 'warmer'}). Rain is not adjusted.
    </p>
    ${dz > 200 ? '<p class="small warn-note"><strong>Rain may be underestimated here:</strong> this square is more than 200 m higher than its weather point, and higher ground usually gets more rain.</p>' : ''}
    ${r ? `<p class="small">${esc(r.name)}: max ${r.maxKgPerPersonPerDay} kg per person per day.</p>` : ''}
    ${placeInfoSection()}
    <div class="actions">
      <a href="https://www.google.com/maps/search/?api=1&query=${center.lat.toFixed(5)},${center.lon.toFixed(5)}" target="_blank" rel="noopener">Open in Google Maps</a>
      <a href="${r?.cantonalMapUrl ?? 'https://map.geo.admin.ch'}" target="_blank" rel="noopener">Open cantonal map</a>
    </div>`;
  el.hidden = false;
  el.querySelector<HTMLButtonElement>('.close')!.addEventListener('click', ctx.onClose);
  el.querySelector('[data-act="log"]')?.addEventListener('click', ctx.onLogVisit);
  el.scrollTop = 0;
  void fillPlaceInfo(
    el,
    { E: (c.e[i]! + 0.5) * 1000, N: (c.n[i]! + 0.5) * 1000, half: 500 },
    date,
    ctx.today,
  );

  const days = await Promise.all(ctx.dates.map((d) => loadGridDay(d, g.count)));
  const body = el.querySelector<HTMLElement>('#cell-body');
  if (!body) return; // closed meanwhile
  const day = days[ctx.dayIndex] ?? null;
  if (!day) {
    body.innerHTML = '<p class="small">No scores for this day yet.</p>';
    return;
  }
  const fav = ctx.favourites
    .map((id) => ({ id, v: cellScore(day, [id], i) }))
    .filter((x): x is { id: string; v: number } => x.v !== null)
    .sort((a, b) => b.v - a.v)[0];
  const name = (id: string) => ctx.species.find((s) => s.id === id)?.name ?? id;
  const rows = ctx.species
    .map((s) => ({ s, v: cellScore(day, [s.id], i) }))
    .sort((a, b) => (b.v ?? -1) - (a.v ?? -1));
  body.innerHTML = `
    <div class="meta-score">
      ${badge(fav?.v ?? 0, true)}
      <div><strong>${bandFor(fav?.v ?? 0).label}</strong>${fav ? ` · best of your favourites: ${esc(name(fav.id))}` : ''}
      <div class="small">${day.source === 'forecast' ? 'Forecast for ' : 'Scores for '}${shortDate(date)}</div></div>
    </div>
    <h3>Species</h3>
    <ul class="sp-list">${rows
      .map(({ s, v }) =>
        v === null
          ? `<li class="sp-row off"><span class="sp-name">${esc(s.name)}</span><span class="sp-off">No score</span></li>`
          : seasonScore(s, date, c.elevation[i]!) === 0
            ? `<li class="sp-row off"><span class="sp-name">${esc(s.name)}</span><span class="sp-off">Out of season</span></li>`
            : `<li class="sp-row"><span class="sp-name">${ctx.favourites.includes(s.id) ? '★ ' : ''}${esc(s.name)}</span><span class="bar" aria-hidden="true"><span style="width:${v}%;background:${bandFor(v).color}"></span></span>${badge(v)}</li>`,
      )
      .join('')}</ul>
    <h3>Why this score</h3>
    <label class="why-pick">Species
      <select id="cell-why-species">${rows
        .map(
          ({ s }) =>
            `<option value="${s.id}"${s.id === fav?.id ? ' selected' : ''}>${esc(s.name)}</option>`,
        )
        .join('')}</select>
    </label>
    <p class="small" id="cell-why-note" aria-live="polite">Recalculating with the latest weather…</p>
    <ul class="why" id="cell-why"></ul>
    <h3>Last 14 days and forecast</h3>
    <div class="chart" id="cell-chart"></div>
    <details class="table-view"><summary>Show as table</summary><div id="cell-table"></div></details>`;

  void renderCellWhy(body, i, ctx, date, day);

  const lines: LineSeries[] = ctx.species.map((s, k) => ({
    label: s.name,
    values: days.map((d) => cellScore(d, [s.id], i)),
    style: speciesStyle(k),
  }));
  const visible = new Set(
    ctx.species.filter((s) => ctx.favourites.includes(s.id)).map((s) => s.name),
  );
  const chart = scoreChart(
    body.querySelector('#cell-chart')!,
    ctx.dates,
    ctx.forecastFrom,
    lines,
    visible,
    ctx.visits,
  );
  cleanup = chart.destroy;
  const shown = lines.filter((l) => visible.has(l.label));
  body.querySelector('#cell-table')!.innerHTML = `<table><thead><tr><th scope="col">Day</th>${shown
    .map((l) => `<th scope="col">${esc(l.label)}</th>`)
    .join('')}</tr></thead><tbody>${ctx.dates
    .map(
      (d, k) =>
        `<tr><th scope="row">${dayMonth(d)}${k >= ctx.forecastFrom ? '*' : ''}</th>${shown.map((l) => `<td>${l.values[k] ?? '–'}</td>`).join('')}</tr>`,
    )
    .join('')}</tbody></table><p class="small">* forecast</p>`;
}

/** Live recalculation of one square: same engine, weather point and elevation shift as the daily job. */
export function scoreCellLive(
  g: GridFile,
  i: number,
  species: Species[],
  dates: string[],
  today: string,
) {
  const k = g.cells.weather[i]!;
  return scorePlaceLive(
    species,
    {
      lat: g.weatherPoints.lat[k]!,
      lon: g.weatherPoints.lon[k]!,
      elevation: g.weatherPoints.elevation[k]!,
    },
    cellHabitat(g, i),
    dates,
    today,
    { dz: elevationAboveWeatherPoint(g, i), ctx: { weatherDistanceKm: weatherDistanceKm(g, i) } },
  );
}

/** Live recalculation of the square (same engine, weather point and elevation shift as the daily job) → reasons. */
async function renderCellWhy(
  body: HTMLElement,
  i: number,
  ctx: CellContext,
  date: string,
  day: Awaited<ReturnType<typeof loadGridDay>>,
): Promise<void> {
  const g = ctx.grid;
  const c = g.cells;
  const note = body.querySelector<HTMLElement>('#cell-why-note')!;
  const list = body.querySelector<HTMLElement>('#cell-why')!;
  const pick = body.querySelector<HTMLSelectElement>('#cell-why-species')!;
  const site = c.site[i] !== null ? g.siteTypes[c.site[i]!] : null;
  const facts = {
    elevation: c.elevation[i]!,
    conifer_pct: c.conifer[i] ?? null,
    forest_pct: c.forest[i]!,
    ph_class: c.ph[i]!,
    ph_source: c.phSource[i]!,
    site_type_name: site?.name ?? null,
    site_type_code: site?.code ?? null,
    aspect: c.aspect[i] ?? null,
    slope: c.slope[i] ?? null,
  };
  let live;
  try {
    live = await scoreCellLive(g, i, ctx.species, ctx.dates, ctx.today);
  } catch {
    if (body.isConnected)
      note.textContent =
        'The reasons could not be loaded (weather service unavailable). Try again later.';
    return;
  }
  if (!body.isConnected) return;
  const render = (id: string) => {
    const s = ctx.species.find((x) => x.id === id);
    const r = live.results.get(date)?.species.find((x) => x.speciesId === id);
    if (!s || !r) {
      note.textContent = 'No weather for this day yet.';
      list.innerHTML = '';
      return;
    }
    const stored = cellScore(day, [id], i);
    note.textContent =
      stored !== null && stored !== r.score
        ? `Recalculated now with the latest weather: ${r.score} (morning run: ${stored}).`
        : `Score ${r.score} for ${shortDate(date)}.`;
    list.innerHTML = whyHtml(s, r, facts);
  };
  pick.addEventListener('change', () => render(pick.value));
  render(pick.value);
}

export function closeCellDetail(el: HTMLElement): void {
  cleanup?.();
  cleanup = null;
  el.hidden = true;
  el.innerHTML = '';
}

/** "beech 45 %, spruce 40 % (estimated), 40 % conifers" for the square's facts. */
function treesText(code: string | null, conifer: number | null): string {
  const mix = treeMixOf({ site_type_code: code, conifer_pct: conifer });
  if (!mix) return 'mix not known';
  const main = mainTrees(mix)
    .map(([t, v]) => `${t} ${Math.round(v * 100)} %`)
    .join(', ');
  return `${main} (estimated)${conifer !== null ? `, ${conifer} % conifers measured` : ''}`;
}
