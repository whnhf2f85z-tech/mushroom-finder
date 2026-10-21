import {
  bandFor,
  bestOf,
  type HabitatEntry,
  isClosedDay,
  type LatestFile,
  type RulesFile,
  type Species,
  type Spot,
  wgs84ToLv95,
} from '@mf/scoring';
import { rainChart, scoreChart, tempChart, type LineSeries, type VisitMarker } from './charts.js';
import { speciesStyle } from './colors.js';
import { dayMonth, esc, shortDate } from './format.js';
import { fillPlaceInfo, placeInfoSection, updatePlaceInfoDay } from './placeinfo.js';
import { whyHtml } from './why.js';

export interface DetailContext {
  latest: LatestFile | null;
  species: Species[];
  rules: RulesFile;
  today: string;
  /** Day shown on the map (for the firing notices); today if missing. */
  date?: string;
  favourites: string[];
  habitat: HabitatEntry | null;
  onClose: () => void;
  /** Opens the "Log a visit" dialog for this place. */
  onLogVisit?: () => void;
  /** Find-log visits at this place, shown on the chart. */
  visits?: VisitMarker[];
  /** Set for the viewer's own pins. */
  pin?: { cellKm: number | null; onRename: () => void; onDelete: () => void };
}

let cleanups: (() => void)[] = [];
/** Species lines the viewer has switched on, kept while moving between spots. */
let visible: Set<string> | null = null;

const confidenceText = {
  high: 'High confidence',
  medium: 'Medium confidence',
  low: 'Low confidence',
};

export function badge(score: number, big = false): string {
  const b = bandFor(score);
  return `<span class="score${big ? ' score-big' : ''}" style="background:${b.color};color:${b.text}">${score}</span>`;
}

export function renderDetail(el: HTMLElement, spot: Spot, ctx: DetailContext): void {
  cleanups.forEach((f) => f());
  cleanups = [];
  const data = ctx.latest?.spots[spot.id];
  const r = ctx.rules.cantons[spot.canton];
  const gmaps = `https://www.google.com/maps/search/?api=1&query=${spot.lat},${spot.lon}`;
  const name = (id: string) => ctx.species.find((s) => s.id === id)?.name ?? id;
  const star = (id: string) =>
    ctx.favourites.includes(id) ? '<span class="fav-star" aria-label="Favourite">★</span> ' : '';

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
          ? `<li class="sp-row off"><span class="sp-name">${star(s.id)}${esc(s.name)}</span><span class="sp-off">Out of season</span></li>`
          : `<li class="sp-row"><span class="sp-name">${star(s.id)}${esc(s.name)}</span><span class="bar" aria-hidden="true"><span style="width:${d!.score}%;background:${bandFor(d!.score).color}"></span></span>${badge(d!.score)}</li>`,
      )
      .join('');
    const fav = bestOf(
      Object.fromEntries(ctx.favourites.map((id) => [id, t.species[id]?.score])),
      ctx.favourites,
    );
    const best = fav ? t.species[fav.id] : undefined;
    const main = fav?.score ?? 0;
    body = `
      <div class="meta-score">
        ${badge(main, true)}
        <div>
          <strong>${bandFor(main).label}</strong>${fav ? ` · best of your favourites: ${esc(name(fav.id))}` : ''}
          ${best ? `<div class="small">${confidenceText[best.confidence]} · scores for ${shortDate(data.updated)}</div>` : ''}
        </div>
      </div>
      <h3>Species today</h3>
      <ul class="sp-list">${list}</ul>
      <h3>Why this score</h3>
      <label class="why-pick">Species
        <select id="why-species">${rows
          .map(
            ({ s }) =>
              `<option value="${s.id}"${s.id === fav?.id ? ' selected' : ''}>${esc(s.name)}</option>`,
          )
          .join('')}</select>
      </label>
      <ul class="why" id="why"></ul>
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
        <p class="small">${ctx.pin ? `My pin · ${spot.canton} · ${spot.elevation_band.min} m` : `${spot.canton} · ${spot.elevation_band.min}–${spot.elevation_band.max} m`}</p>
      </div>
      <button type="button" class="close" aria-label="Close">×</button>
    </div>
    <div id="closed-day" data-spot-detail="${esc(spot.canton)}" data-today="${ctx.today}">${closedBadge(ctx.rules, spot.canton, ctx.date ?? ctx.today, ctx.today)}</div>
    ${data?.stale ? `<p class="badge closed">Weather could not be updated; showing scores from ${shortDate(data.updated)}</p>` : ''}
    ${body}
    ${ctx.habitat?.protected.noPicking ? `<p class="badge closed">No picking: ${esc(ctx.habitat.protected.name ?? 'protected area')}</p>` : ''}
    ${ctx.habitat?.protected.is && !ctx.habitat.protected.noPicking ? `<p class="small"><strong>Protected area nearby:</strong> ${esc(ctx.habitat.protected.name ?? '')}. Check the reserve rules before picking.</p>` : ''}
    <h3>${ctx.pin ? 'About this pin' : 'About this spot'}</h3>
    ${spot.notes ? `<p>${esc(spot.notes)}</p>` : ''}
    ${ctx.pin ? `<p class="small">${ctx.pin.cellKm === null ? 'No forest square within 1.5 km: tree mix and soil are unknown, so confidence is lower.' : `Tree mix, soil and slope come from the nearest forest square (${ctx.pin.cellKm.toFixed(1)} km away); elevation is the pin's own.`}</p>` : ''}
    ${ctx.habitat && !ctx.pin ? `<p class="small">Pin at ${ctx.habitat.elevation} m${ctx.habitat.site_type_name ? ` · forest type: ${esc(ctx.habitat.site_type_name)}` : ''}${ctx.habitat.conifer_pct !== null ? ` · ${ctx.habitat.conifer_pct} % conifers` : ''} · tree cover ${ctx.habitat.forest_pct} %.</p>` : ''}
    ${r ? `<p class="small">${esc(r.name)}: max ${r.maxKgPerPersonPerDay} kg per person per day${r.speciesLimits.map((l) => `, ${esc(name(l.species).toLowerCase())}s max ${l.maxKg} kg`).join('')}.</p>` : ''}
    ${placeInfoSection()}
    <div class="actions">
      ${ctx.onLogVisit ? '<button type="button" class="action-button" data-act="log">Log a visit</button>' : ''}
      <a href="${gmaps}" target="_blank" rel="noopener">Open in Google Maps</a>
      <a href="${r?.cantonalMapUrl ?? 'https://map.geo.admin.ch'}" target="_blank" rel="noopener">Open cantonal map</a>
    </div>
    ${ctx.pin ? '<div class="actions"><button type="button" class="action-button secondary" data-act="rename">Rename</button><button type="button" class="action-button secondary" data-act="delete">Delete pin</button></div>' : ''}`;
  el.hidden = false;
  {
    const { E, N } = wgs84ToLv95(spot.lat, spot.lon);
    void fillPlaceInfo(el, { E, N, half: 0 }, ctx.date ?? ctx.today, ctx.today);
  }
  el.querySelector<HTMLButtonElement>('.close')!.addEventListener('click', ctx.onClose);
  el.querySelector('[data-act="log"]')?.addEventListener('click', () => ctx.onLogVisit?.());
  el.querySelector('[data-act="rename"]')?.addEventListener('click', () => ctx.pin?.onRename());
  el.querySelector('[data-act="delete"]')?.addEventListener('click', () => ctx.pin?.onDelete());
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
  // Default chart lines: the favourites that are in season.
  visible ??= new Set(
    ctx.species
      .filter((s) => ctx.favourites.includes(s.id) && !data.today.species[s.id]?.outOfSeason)
      .map((s) => s.name),
  );

  const toggles = el.querySelector<HTMLElement>('#line-toggles')!;
  toggles.innerHTML = lines
    .map(
      (l) =>
        `<button type="button" class="chip" aria-pressed="${visible!.has(l.label)}" data-label="${esc(l.label)}"><span class="line-key" style="border-color:${l.style.color};border-top-style:${l.style.dash ? 'dashed' : 'solid'}"></span>${esc(l.label)}</button>`,
    )
    .join('');
  const sc = scoreChart(
    el.querySelector('#score-chart')!,
    dates,
    forecastFrom,
    lines,
    visible,
    ctx.visits ?? [],
  );
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

  // Why this score: plain-English reasons for the chosen species.
  const facts = ctx.habitat ?? {
    elevation: (spot.elevation_band.min + spot.elevation_band.max) / 2,
    ph_class: spot.habitat_hint?.ph_class ?? 'unknown',
    conifer_pct: spot.habitat_hint?.conifer_pct ?? null,
  };
  const why = el.querySelector<HTMLElement>('#why')!;
  const renderWhy = (id: string) => {
    const s = ctx.species.find((x) => x.id === id);
    const d = data.today.species[id];
    if (s && d) why.innerHTML = whyHtml(s, d, facts);
  };
  const pick = el.querySelector<HTMLSelectElement>('#why-species')!;
  pick.addEventListener('change', () => renderWhy(pick.value));
  renderWhy(pick.value);

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

/** Forget the chart line choices, e.g. after the favourites change. */
export function resetChartLines(): void {
  visible = null;
}

export function closeDetail(el: HTMLElement): void {
  cleanups.forEach((f) => f());
  cleanups = [];
  el.hidden = true;
  el.innerHTML = '';
}

/** "Closed today / on Thu 23 Oct (ZH rule)" badge, or nothing. */
export function closedBadge(
  rules: RulesFile,
  canton: Spot['canton'],
  date: string,
  today: string,
): string {
  if (!isClosedDay(rules, canton, date)) return '';
  return `<p><span class="badge closed">Closed ${date === today ? 'today' : `on ${shortDate(date)}`} (${esc(canton)} rule)</span></p>`;
}

/**
 * The day slider moved while a spot or pin detail is open: update what depends on the day (closed-day badge,
 * firing notices). The scores, chart and "why" are for today and don't change.
 */
export function updateDetailDay(el: HTMLElement, date: string, rules: RulesFile): void {
  const box = el.querySelector<HTMLElement>('#closed-day[data-spot-detail]');
  if (!box) return; // no spot/pin detail open
  box.innerHTML = closedBadge(
    rules,
    box.dataset.spotDetail as Spot['canton'],
    date,
    box.dataset.today ?? date,
  );
  void updatePlaceInfoDay(el, date);
}
