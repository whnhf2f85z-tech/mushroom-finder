import 'leaflet/dist/leaflet.css';
import './style.css';
import L from 'leaflet';
import {
  HabitatFileSchema,
  LatestFileSchema,
  ReservesFileSchema,
  RulesFileSchema,
  SCORE_BANDS,
  SpeciesFileSchema,
  SpotsFileSchema,
  DEFAULT_FAVOURITES,
  bandFor,
  bestOf,
  isClosedDay,
  type CantonT,
  type GridFile,
  type HabitatFile,
  type LatestFile,
  type Spot,
} from '@mf/scoring';
import reservesJson from '../../data/reserves.json';
import rulesJson from '../../data/rules.json';
import speciesJson from '../../data/species.json';
import spotsJson from '../../data/spots.json';
import { closeCellDetail, renderCellDetail } from './celldetail.js';
import { closeDetail, renderDetail, resetChartLines } from './detail.js';
import {
  GridLayer,
  cellCenter,
  cellScore,
  loadGrid,
  loadGridDay,
  type CellStyle,
  type GridDay,
} from './gridlayer.js';
import { dateTime, esc, shortDate } from './format.js';
import { loadFavourites, saveFavourites } from './settings.js';

const spots = SpotsFileSchema.parse(spotsJson).spots;
const species = SpeciesFileSchema.parse(speciesJson).species;
const reserves = ReservesFileSchema.parse(reservesJson).reserves;
const rules = RulesFileSchema.parse(rulesJson);
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Zurich' }).format(new Date());

const $ = (id: string): HTMLElement => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} missing`);
  return el;
};

/** What the map shows: the best of the favourites, or one species, on one day of the 17-day window. */
const state = {
  species: 'favourites',
  dayIndex: 13,
  selected: null as string | null,
  selectedCell: null as number | null,
  view: 'both' as 'grid' | 'spots' | 'both',
};
let favourites = loadFavourites(species.map((s) => s.id));
let latest: LatestFile | null = null;
let habitat: HabitatFile | null = null;
let grid: GridFile | null = null;
let gridLayer: GridLayer | null = null;
let shownDay: GridDay | null = null;

// --- Map -------------------------------------------------------------------

const map = L.map('map', { zoomControl: true });

L.tileLayer(
  'https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.pixelkarte-grau/default/current/3857/{z}/{x}/{y}.jpeg',
  {
    maxZoom: 18,
    attribution:
      '© <a href="https://www.swisstopo.admin.ch">swisstopo</a> · weather <a href="https://open-meteo.com">Open-Meteo</a>',
  },
).addTo(map);

const borders = L.tileLayer(
  'https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.swissboundaries3d-kanton-flaeche.fill/default/current/3857/{z}/{x}/{y}.png',
  { maxZoom: 18, opacity: 0.35 },
).addTo(map);

// Reserves: real outlines from the habitat build (static/reserves.geojson), drawn above the heatmap.
// Hatched red = no picking; dashed orange = protected, check the rules. Not clickable, so squares below stay usable.
map.createPane('reserves').style.zIndex = '450';
const reserveLayer = L.layerGroup().addTo(map);
async function loadReserves(): Promise<void> {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}data/static/reserves.geojson`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as GeoJSON.FeatureCollection;
    L.geoJSON(data, {
      pane: 'reserves',
      interactive: false,
      style: (f) =>
        f?.properties?.noPicking
          ? { color: '#b2182b', weight: 1.5, fillColor: 'url(#hatch)', fillOpacity: 1 }
          : { color: '#e08214', weight: 2, dashArray: '5 4', fill: false },
    }).addTo(reserveLayer);
  } catch {
    // Fallback: the approximate markers from data/reserves.json.
    for (const r of reserves)
      L.circle([r.lat, r.lon], {
        radius: 900,
        color: '#b2182b',
        weight: 2,
        dashArray: '6 4',
        fillOpacity: 0.15,
      })
        .bindPopup(
          `<div class="popup"><h3>${esc(r.name)}</h3><p class="reserve-label">No picking</p><p>${esc(r.notes)}</p></div>`,
        )
        .addTo(reserveLayer);
  }
}

const markers = new Map<string, L.Marker>();
const spotLayer = L.layerGroup().addTo(map);
for (const spot of spots) {
  const m = L.marker([spot.lat, spot.lon], {
    // Empty pin until scores load, so Leaflet doesn't fetch its default marker images.
    icon: L.divIcon({ className: 'pin-wrap', html: '', iconSize: [34, 34] }),
    keyboard: true,
    title: spot.name,
    riseOnHover: true,
  });
  m.on('click', () => select(spot.id));
  markers.set(spot.id, m);
  spotLayer.addLayer(m);
}

L.control
  .layers(undefined, { Reserves: reserveLayer, 'Canton borders': borders }, { collapsed: true })
  .addTo(map);

// Frame ZH + SZ. Refit once layout and styles have settled, otherwise Leaflet can measure a wrong size.
const ZH_SZ_BOUNDS = L.latLngBounds([46.93, 8.35], [47.7, 9.0]);
const frame = (): void => {
  map.invalidateSize();
  map.fitBounds(ZH_SZ_BOUNDS);
};
frame();
if (document.readyState !== 'complete') window.addEventListener('load', frame, { once: true });

// --- Scores ----------------------------------------------------------------

const allDates = (): string[] => (latest ? [...latest.days, ...latest.forecastDays] : [today]);
const selectedDate = (): string => allDates()[state.dayIndex] ?? today;

interface Shown {
  score: number | null;
  outOfSeason: boolean;
}

function shownScore(spot: Spot): Shown {
  const d = latest?.spots[spot.id];
  if (!d) return { score: null, outOfSeason: false };
  if (state.species === 'favourites') {
    const scores = Object.fromEntries(favourites.map((id) => [id, d.series[id]?.[state.dayIndex]]));
    return { score: bestOf(scores, favourites)?.score ?? null, outOfSeason: false };
  }
  const outOfSeason = d.today.species[state.species]?.outOfSeason ?? false;
  return { score: d.series[state.species]?.[state.dayIndex] ?? null, outOfSeason };
}

function markerHtml(spot: Spot, s: Shown, closed: boolean): string {
  if (s.outOfSeason) return `<span class="pin pin-off" aria-hidden="true">–</span>`;
  if (s.score === null) return `<span class="pin pin-none" aria-hidden="true">?</span>`;
  const b = bandFor(s.score);
  return `<span class="pin${closed ? ' pin-closed' : ''}${state.selected === spot.id ? ' pin-selected' : ''}" style="background:${b.color};color:${b.text}" aria-hidden="true">${s.score}</span>`;
}

function describe(spot: Spot, s: Shown, closed: boolean): string {
  const what =
    state.species === 'favourites'
      ? 'your favourites'
      : species.find((x) => x.id === state.species)?.name;
  const score = s.outOfSeason
    ? 'out of season'
    : s.score === null
      ? 'no score'
      : `${s.score} (${bandFor(s.score).label})`;
  return `${spot.name}: ${score} for ${what}${closed ? ', closed today' : ''}`;
}

function refresh(): void {
  const date = selectedDate();
  for (const spot of spots) {
    const s = shownScore(spot);
    const closed = isClosedDay(rules, spot.canton, date);
    const m = markers.get(spot.id)!;
    m.setIcon(
      L.divIcon({
        className: 'pin-wrap',
        html: markerHtml(spot, s, closed),
        iconSize: [34, 34],
        iconAnchor: [17, 17],
      }),
    );
    m.getElement()?.setAttribute('aria-label', describe(spot, s, closed));
    m.setZIndexOffset(s.score ?? 0);
  }

  // Spot list, best first.
  const rows = spots
    .map((spot) => ({ spot, s: shownScore(spot) }))
    .sort((a, b) => (b.s.score ?? -1) - (a.s.score ?? -1));
  $('spot-list').innerHTML = rows
    .map(({ spot, s }) => {
      const b = s.score !== null && !s.outOfSeason ? bandFor(s.score) : null;
      const val = s.outOfSeason ? '–' : (s.score ?? '?');
      return `<li><button type="button" data-id="${spot.id}"><span class="score" style="${b ? `background:${b.color};color:${b.text}` : ''}">${val}</span><span>${esc(spot.name)}<span class="meta">${spot.canton} · ${spot.elevation_band.min}–${spot.elevation_band.max} m</span></span></button></li>`;
    })
    .join('');

  const isForecast = latest !== null && state.dayIndex >= latest.days.length;
  $('day-label').textContent =
    date === today
      ? `Today, ${shortDate(date)}`
      : `${isForecast ? 'Forecast: ' : ''}${shortDate(date)}`;
  $('day-label').classList.toggle('forecast', isForecast);
  void refreshGrid();
}

// --- Grid ------------------------------------------------------------------

const shownIds = (): string[] => (state.species === 'favourites' ? favourites : [state.species]);
let gridRequest = 0;

async function refreshGrid(): Promise<void> {
  if (!grid || !gridLayer || !latest) return;
  const g = grid;
  const date = selectedDate();
  const request = ++gridRequest;
  const day = await loadGridDay(date, g.count);
  if (request !== gridRequest) return; // a newer request is on its way
  shownDay = day;
  const ids = shownIds();
  const styles: CellStyle[] = g.cells.e.map((_, i) => ({
    score: cellScore(day, ids, i),
    closed: isClosedDay(rules, g.cells.canton[i]!, date),
    selected: state.selectedCell === i,
  }));
  gridLayer.update(styles);

  // Best squares, for reading the heatmap without colour.
  const best = styles
    .map((s, i) => ({ i, score: s.closed ? null : s.score }))
    .filter((x): x is { i: number; score: number } => x.score !== null)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);
  $('cell-list').innerHTML = best
    .map(({ i, score }) => {
      const b = bandFor(score);
      return `<li><button type="button" data-cell="${i}"><span class="score" style="background:${b.color};color:${b.text}">${score}</span><span>Forest square ${g.cells.e[i]}/${g.cells.n[i]}<span class="meta">${g.cells.canton[i]} · ~${g.cells.elevation[i]} m · ${g.cells.forest[i]} % trees</span></span></button></li>`;
    })
    .join('');
  $('cells-section').hidden = state.view === 'spots' || best.length === 0;
  if (state.selectedCell !== null) void openCell(state.selectedCell, false);
}

function describeCell(i: number): string {
  if (!grid) return '';
  const date = selectedDate();
  const v = cellScore(shownDay, shownIds(), i);
  const closed = isClosedDay(rules, grid.cells.canton[i]!, date);
  const what =
    state.species === 'favourites'
      ? 'your favourites'
      : (species.find((x) => x.id === state.species)?.name ?? '');
  return `${v === null ? 'No score' : `${v} (${bandFor(v).label})`} for ${esc(what)} · forest square ${grid.cells.e[i]}/${grid.cells.n[i]}, ${grid.cells.canton[i]}${closed ? ' · closed that day' : ''}`;
}

async function openCell(i: number, pan = true): Promise<void> {
  if (!grid || !latest) return;
  const detail = $('detail');
  if (state.selected) closeDetail(detail);
  state.selected = null;
  const first = state.selectedCell !== i;
  state.selectedCell = i;
  $('overview').hidden = true;
  if (pan) {
    const c = cellCenter(grid, i);
    map.panTo([c.lat, c.lon]);
  }
  if (first) refresh();
  await renderCellDetail(detail, i, {
    grid,
    species,
    favourites,
    rules,
    today,
    dates: allDates(),
    forecastFrom: latest.days.length,
    dayIndex: state.dayIndex,
    onClose: () => {
      state.selectedCell = null;
      closeCellDetail(detail);
      $('overview').hidden = false;
      refresh();
    },
  });
  if (first) detail.querySelector<HTMLElement>('.close')?.focus({ preventScroll: true });
}

function applyView(): void {
  const showGrid = state.view !== 'spots';
  const showSpots = state.view !== 'grid';
  if (gridLayer) {
    if (showGrid && !map.hasLayer(gridLayer.group)) gridLayer.group.addTo(map);
    if (!showGrid && map.hasLayer(gridLayer.group)) gridLayer.group.remove();
  }
  if (showSpots && !map.hasLayer(spotLayer)) spotLayer.addTo(map);
  if (!showSpots && map.hasLayer(spotLayer)) spotLayer.remove();
  for (const b of document.querySelectorAll<HTMLButtonElement>('[data-view]'))
    b.setAttribute('aria-checked', String(b.dataset.view === state.view));
  refresh();
}

function select(id: string): void {
  const spot = spots.find((s) => s.id === id);
  if (!spot) return;
  const detail = $('detail');
  if (state.selectedCell !== null) closeCellDetail(detail);
  state.selectedCell = null;
  state.selected = id;
  renderDetail(detail, spot, {
    latest,
    species,
    rules,
    today,
    favourites,
    habitat: habitat?.spots[id] ?? null,
    onClose: () => {
      state.selected = null;
      closeDetail(detail);
      $('overview').hidden = false;
      refresh();
      markers.get(id)?.getElement()?.focus();
    },
  });
  $('overview').hidden = true;
  map.panTo([spot.lat, spot.lon]);
  refresh();
  detail.querySelector<HTMLElement>('.close')?.focus({ preventScroll: true });
}

// --- Controls --------------------------------------------------------------

$('species-chips').innerHTML = [{ id: 'favourites', name: 'My favourites' }, ...species]
  .map(
    (s) =>
      `<button type="button" class="chip" role="radio" aria-checked="${s.id === state.species}" data-id="${s.id}">${esc(s.name)}</button>`,
  )
  .join('');
$('species-chips').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-id]');
  if (!b) return;
  state.species = b.dataset.id!;
  for (const c of $('species-chips').querySelectorAll('button'))
    c.setAttribute('aria-checked', String(c === b));
  refresh();
});

// Favourites dialog
const dialog = $('fav-dialog') as HTMLDialogElement;
const favList = $('fav-list');
const renderFavList = (ids: string[]) => {
  favList.querySelectorAll('label').forEach((l) => l.remove());
  favList.insertAdjacentHTML(
    'beforeend',
    species
      .map(
        (s) =>
          `<label><input type="checkbox" name="fav" value="${s.id}"${ids.includes(s.id) ? ' checked' : ''} /> ${esc(s.name)} <span class="small">(${esc(s.german)})</span></label>`,
      )
      .join(''),
  );
};
$('edit-favourites').addEventListener('click', () => {
  renderFavList(favourites);
  $('fav-error').hidden = true;
  dialog.showModal();
});
$('fav-reset').addEventListener('click', () => renderFavList(DEFAULT_FAVOURITES));
// Save updates the map directly instead of waiting for the dialog's close event, which isn't reliable.
$('fav-save').addEventListener('click', (e) => {
  e.preventDefault();
  const ids = [...favList.querySelectorAll<HTMLInputElement>('input:checked')].map((i) => i.value);
  if (ids.length === 0) {
    $('fav-error').hidden = false;
    return;
  }
  favourites = ids;
  saveFavourites(ids);
  dialog.close('save');
  resetChartLines();
  refresh();
  if (state.selected) select(state.selected);
});

const slider = $('day') as HTMLInputElement;
slider.addEventListener('input', () => {
  state.dayIndex = Number(slider.value);
  refresh();
});

document.querySelector('.view-control')!.addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-view]');
  if (!b) return;
  state.view = b.dataset.view as typeof state.view;
  applyView();
});
$('cell-list').addEventListener('click', (e) => {
  const i = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-cell]')?.dataset.cell;
  if (i !== undefined) void openCell(Number(i));
});

$('spot-list').addEventListener('click', (e) => {
  const id = (e.target as HTMLElement).closest('button')?.dataset.id;
  if (id) select(id);
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && (state.selected || state.selectedCell !== null))
    $('detail').querySelector<HTMLButtonElement>('.close')?.click();
});

$('legend').innerHTML = SCORE_BANDS.map(
  (b) =>
    `<li><span class="swatch" style="background:${b.color};color:${b.text}">${b.min}–${b.max}</span>${b.label}</li>`,
).join('');

$('rules').innerHTML = (Object.keys(rules.cantons) as CantonT[])
  .map((c) => {
    const r = rules.cantons[c]!;
    return `<div class="rules-block"><strong>${esc(r.name)} (${c})</strong><ul>${r.rules.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
      <p class="small">Source: ${r.sources.map((s) => `<a href="${s.url}" target="_blank" rel="noopener">${esc(s.title)}</a>`).join(', ')} (checked ${r.checked})</p></div>`;
  })
  .join('');

$('rules-today').innerHTML = (Object.keys(rules.cantons) as CantonT[])
  .map((c) =>
    isClosedDay(rules, c, today)
      ? `<span class="badge closed">${c}: closed today</span>`
      : `<span class="badge">${c}: open today · max ${rules.cantons[c]!.maxKgPerPersonPerDay} kg</span>`,
  )
  .join('');

// --- Data ------------------------------------------------------------------

async function loadLatest(): Promise<void> {
  const status = $('status');
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}data/latest.json`, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    latest = LatestFileSchema.parse(await res.json());
  } catch (e) {
    console.error('Could not load scores', e);
    status.textContent = 'Scores could not be loaded. The map shows the spots only.';
    status.hidden = false;
    $('updated').textContent = 'no scores';
    refresh();
    return;
  }
  slider.max = String(latest.days.length + latest.forecastDays.length - 1);
  state.dayIndex = latest.days.length - 1;
  slider.value = String(state.dayIndex);
  $('updated').textContent = `updated ${dateTime(latest.generatedAt)}`;

  const ageHours = (Date.now() - Date.parse(latest.generatedAt)) / 3_600_000;
  const notes: string[] = [];
  if (ageHours > 36)
    notes.push(`Scores are ${Math.round(ageHours / 24)} days old: the daily update hasn't run.`);
  if (latest.stale) notes.push('Some spots could not be updated and show older scores.');
  status.textContent = notes.join(' ');
  status.hidden = notes.length === 0;
  refresh();
}

async function loadHabitat(): Promise<void> {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}data/static/habitat.json`);
    if (res.ok) habitat = HabitatFileSchema.parse(await res.json());
  } catch (e) {
    console.warn('No habitat data', e);
  }
}

async function loadGridLayer(): Promise<void> {
  grid = await loadGrid();
  if (!grid) return;
  gridLayer = new GridLayer(map, grid, (i) => void openCell(i), describeCell);
  applyView();
}

// Map and scores first; the reserve outlines (the largest file) load afterwards, when the browser is idle.
const whenIdle = (fn: () => void) =>
  'requestIdleCallback' in window
    ? requestIdleCallback(fn, { timeout: 3000 })
    : setTimeout(fn, 500);

refresh();
void loadHabitat();
void loadLatest()
  .then(loadGridLayer)
  .finally(() => whenIdle(() => void loadReserves()));
