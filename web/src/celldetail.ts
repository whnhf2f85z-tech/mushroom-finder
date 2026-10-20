import {
  bandFor,
  elevationAboveWeatherPoint,
  isClosedDay,
  weatherDistanceKm,
  seasonScore,
  type GridFile,
  type RulesFile,
  type Species,
} from '@mf/scoring';
import { scoreChart, type LineSeries } from './charts.js';
import { speciesStyle } from './colors.js';
import { badge } from './detail.js';
import { dayMonth, esc, shortDate } from './format.js';
import { cellCenter, cellScore, loadGridDay } from './gridlayer.js';

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
    <div id="cell-body"><p class="small">Loading scores…</p></div>
    <h3>About this square</h3>
    <p class="small">
      Trees: ${c.conifer[i] === null ? 'mix not known' : `${c.conifer[i]} % conifers`}.
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
    <div class="actions">
      <a href="https://www.google.com/maps/search/?api=1&query=${center.lat.toFixed(5)},${center.lon.toFixed(5)}" target="_blank" rel="noopener">Open in Google Maps</a>
      <a href="${r?.cantonalMapUrl ?? 'https://map.geo.admin.ch'}" target="_blank" rel="noopener">Open cantonal map</a>
    </div>`;
  el.hidden = false;
  el.querySelector<HTMLButtonElement>('.close')!.addEventListener('click', ctx.onClose);
  el.scrollTop = 0;

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
    <h3>Last 14 days and forecast</h3>
    <div class="chart" id="cell-chart"></div>
    <details class="table-view"><summary>Show as table</summary><div id="cell-table"></div></details>`;

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

export function closeCellDetail(el: HTMLElement): void {
  cleanup?.();
  cleanup = null;
  el.hidden = true;
  el.innerHTML = '';
}
