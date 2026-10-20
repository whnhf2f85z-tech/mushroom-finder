import {
  bandFor,
  isClosedDay,
  type LatestFile,
  type RulesFile,
  type Species,
  type Spot,
} from '@mf/scoring';
import { rainChart, scoreChart, tempChart, type LineSeries } from './charts.js';
import { speciesStyle } from './colors.js';
import { dayMonth, esc, shortDate } from './format.js';

export interface DetailContext {
  latest: LatestFile | null;
  species: Species[];
  rules: RulesFile;
  today: string;
  onClose: () => void;
}

let cleanups: (() => void)[] = [];
/** Species lines the viewer has switched on, kept while moving between spots. */
let visible: Set<string> | null = null;

const confidenceText = {
  high: 'High confidence',
  medium: 'Medium confidence',
  low: 'Low confidence',
};

function badge(score: number, big = false): string {
  const b = bandFor(score);
  return `<span class="score${big ? ' score-big' : ''}" style="background:${b.color};color:${b.text}">${score}</span>`;
}

export function renderDetail(el: HTMLElement, spot: Spot, ctx: DetailContext): void {
  cleanups.forEach((f) => f());
  cleanups = [];
  const data = ctx.latest?.spots[spot.id];
  const r = ctx.rules.cantons[spot.canton];
  const closed = isClosedDay(ctx.rules, spot.canton, ctx.today);
  const gmaps = `https://www.google.com/maps/search/?api=1&query=${spot.lat},${spot.lon}`;
  const name = (id: string) => ctx.species.find((s) => s.id === id)?.name ?? id;

  let body = '';
  if (!data || !ctx.latest) {
    body = '<p class="small">No scores available for this spot yet.</p>';
  } else {
    const t = data.today;
    const rows = ctx.species
      .map((s) => ({ s, d: t.species[s.id] }))
      .filter((x) => x.d)
      .sort(
        (a, b) => b.d!.score - a.d!.score || Number(a.d!.outOfSeason) - Number(b.d!.outOfSeason),
      );
    const list = rows
      .map(({ s, d }) =>
        d!.outOfSeason
          ? `<li class="sp-row off"><span class="sp-name">${esc(s.name)}</span><span class="sp-off">Out of season</span></li>`
          : `<li class="sp-row"><span class="sp-name">${esc(s.name)}</span><span class="bar" aria-hidden="true"><span style="width:${d!.score}%;background:${bandFor(d!.score).color}"></span></span>${badge(d!.score)}</li>`,
      )
      .join('');
    const best = t.best ? t.species[t.best] : undefined;
    body = `
      <div class="meta-score">
        ${badge(t.metascore, true)}
        <div>
          <strong>${bandFor(t.metascore).label}</strong>${best ? ` · best: ${esc(name(t.best!))}` : ''}
          ${best ? `<div class="small">${confidenceText[best.confidence]} · scores for ${shortDate(data.updated)}</div>` : ''}
        </div>
      </div>
      <h3>Species today</h3>
      <ul class="sp-list">${list}</ul>
      <h3>Last 14 days and forecast</h3>
      <div class="chips chips-small" id="line-toggles" aria-label="Show species in chart"></div>
      <div class="chart" id="score-chart"></div>
      <h3>Weather</h3>
      <p class="chart-title small">Rain per day</p>
      <div class="chart" id="rain-chart"></div>
      <p class="chart-title small">Temperature: <span class="key key-max"></span>max <span class="key key-min"></span>min</p>
      <div class="chart" id="temp-chart"></div>
      <details class="table-view"><summary>Show as table</summary><div id="table"></div></details>`;
  }

  el.innerHTML = `
    <div class="detail-head">
      <div>
        <h2>${esc(spot.name)}</h2>
        <p class="small">${spot.canton} · ${spot.elevation_band.min}–${spot.elevation_band.max} m</p>
      </div>
      <button type="button" class="close" aria-label="Close">×</button>
    </div>
    ${closed ? `<p><span class="badge closed">Closed today (${spot.canton} rule)</span></p>` : ''}
    ${data?.stale ? `<p class="badge closed">Weather could not be updated; showing scores from ${shortDate(data.updated)}</p>` : ''}
    ${body}
    <h3>About this spot</h3>
    <p>${esc(spot.notes)}</p>
    ${r ? `<p class="small">${esc(r.name)}: max ${r.maxKgPerPersonPerDay} kg per person per day${r.speciesLimits.map((l) => `, ${esc(name(l.species).toLowerCase())}s max ${l.maxKg} kg`).join('')}.</p>` : ''}
    <div class="actions">
      <a href="${gmaps}" target="_blank" rel="noopener">Open in Google Maps</a>
      <a href="${r?.cantonalMapUrl ?? 'https://map.geo.admin.ch'}" target="_blank" rel="noopener">Open cantonal map</a>
    </div>`;
  el.hidden = false;
  el.querySelector<HTMLButtonElement>('.close')!.addEventListener('click', ctx.onClose);
  el.scrollTop = 0;
  if (!data || !ctx.latest) return;

  const latest = ctx.latest;
  const dates = [...latest.days, ...latest.forecastDays];
  const forecastFrom = latest.days.length;
  const lines: LineSeries[] = ctx.species.map((s, i) => ({
    label: s.name,
    values: data.series[s.id] ?? dates.map(() => null),
    style: speciesStyle(i),
  }));
  // Default: the three best species today that are in season.
  visible ??= new Set(
    ctx.species
      .filter((s) => !data.today.species[s.id]?.outOfSeason)
      .sort(
        (a, b) => (data.today.species[b.id]?.score ?? 0) - (data.today.species[a.id]?.score ?? 0),
      )
      .slice(0, 3)
      .map((s) => s.name),
  );

  const toggles = el.querySelector<HTMLElement>('#line-toggles')!;
  toggles.innerHTML = lines
    .map(
      (l) =>
        `<button type="button" class="chip" aria-pressed="${visible!.has(l.label)}" data-label="${esc(l.label)}"><span class="line-key" style="border-color:${l.style.color};border-top-style:${l.style.dash ? 'dashed' : 'solid'}"></span>${esc(l.label)}</button>`,
    )
    .join('');
  const sc = scoreChart(el.querySelector('#score-chart')!, dates, forecastFrom, lines, visible);
  toggles.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-label]');
    if (!b) return;
    const label = b.dataset.label!;
    const on = !visible!.has(label);
    if (on) visible!.add(label);
    else visible!.delete(label);
    b.setAttribute('aria-pressed', String(on));
    sc.chart.setSeries(lines.findIndex((l) => l.label === label) + 1, { show: on });
  });
  const rc = rainChart(el.querySelector('#rain-chart')!, dates, forecastFrom, data.weather.precip);
  const tc = tempChart(
    el.querySelector('#temp-chart')!,
    dates,
    forecastFrom,
    data.weather.tmin,
    data.weather.tmax,
  );
  cleanups.push(sc.destroy, rc.destroy, tc.destroy);

  // Table view: every value the charts show, reachable without colour or hover.
  const head = ['Day', ...lines.map((l) => esc(l.label)), 'Rain (mm)', 'Min °C', 'Max °C'];
  const cell = (v: number | null | undefined) => (v === null || v === undefined ? '–' : String(v));
  el.querySelector('#table')!.innerHTML =
    `<table><thead><tr>${head.map((h) => `<th scope="col">${h}</th>`).join('')}</tr></thead><tbody>${dates
      .map(
        (d, i) =>
          `<tr><th scope="row">${dayMonth(d)}${i >= forecastFrom ? '*' : ''}</th>${lines.map((l) => `<td>${cell(l.values[i])}</td>`).join('')}<td>${cell(data.weather.precip[i])}</td><td>${cell(data.weather.tmin[i])}</td><td>${cell(data.weather.tmax[i])}</td></tr>`,
      )
      .join('')}</tbody></table><p class="small">* forecast</p>`;
}

export function closeDetail(el: HTMLElement): void {
  cleanups.forEach((f) => f());
  cleanups = [];
  el.hidden = true;
  el.innerHTML = '';
}
