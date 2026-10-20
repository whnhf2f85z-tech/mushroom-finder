import 'leaflet/dist/leaflet.css';
import './style.css';
import L from 'leaflet';
import {
  ReservesFileSchema,
  RulesFileSchema,
  SCORE_BANDS,
  SpeciesFileSchema,
  SpotsFileSchema,
  isClosedDay,
  type CantonT,
  type Spot,
} from '@mf/scoring';
import reservesJson from '../../data/reserves.json';
import rulesJson from '../../data/rules.json';
import speciesJson from '../../data/species.json';
import spotsJson from '../../data/spots.json';

const spots = SpotsFileSchema.parse(spotsJson).spots;
const species = SpeciesFileSchema.parse(speciesJson).species;
const reserves = ReservesFileSchema.parse(reservesJson).reserves;
const rules = RulesFileSchema.parse(rulesJson);

const speciesName = new Map(species.map((s) => [s.id, `${s.name} (${s.german})`]));
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Zurich' }).format(new Date());

const esc = (s: string): string =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );

const $ = (id: string): HTMLElement => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} missing`);
  return el;
};

// --- Map -------------------------------------------------------------------

const map = L.map('map', { zoomControl: true }).setView([47.2, 8.65], 10);

L.tileLayer(
  'https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.pixelkarte-grau/default/current/3857/{z}/{x}/{y}.jpeg',
  {
    maxZoom: 18,
    attribution: '© <a href="https://www.swisstopo.admin.ch">swisstopo</a>',
  },
).addTo(map);

const borders = L.tileLayer(
  'https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.swissboundaries3d-kanton-flaeche.fill/default/current/3857/{z}/{x}/{y}.png',
  { maxZoom: 18, opacity: 0.35 },
).addTo(map);

const reserveLayer = L.layerGroup(
  reserves.map((r) =>
    L.circle([r.lat, r.lon], {
      radius: 900,
      color: '#b2182b',
      weight: 2,
      dashArray: '6 4',
      fillColor: '#b2182b',
      fillOpacity: 0.15,
    }).bindPopup(
      `<div class="popup"><h3>${esc(r.name)}</h3><p class="reserve-label">No picking</p><p>${esc(r.notes)}</p></div>`,
    ),
  ),
).addTo(map);

const cantonalMapUrl = (c: CantonT): string =>
  rules.cantons[c]?.cantonalMapUrl ?? 'https://map.geo.admin.ch';

function spotPopup(spot: Spot): string {
  const r = rules.cantons[spot.canton];
  const closed = isClosedDay(rules, spot.canton, today);
  const hints = spot.species_hint.map((id) => esc(speciesName.get(id) ?? id)).join(', ');
  const gmaps = `https://www.google.com/maps/search/?api=1&query=${spot.lat},${spot.lon}`;
  return `<div class="popup">
    <h3>${esc(spot.name)}</h3>
    <p>${spot.canton} · ${spot.elevation_band.min}–${spot.elevation_band.max} m</p>
    ${closed ? `<p><span class="badge closed">Closed today (${spot.canton} rule)</span></p>` : ''}
    ${hints ? `<p><strong>Known for:</strong> ${hints}</p>` : ''}
    <p>${esc(spot.notes)}</p>
    ${r ? `<p class="small">Limit: ${r.maxKgPerPersonPerDay} kg per person per day.</p>` : ''}
    <p class="small">Score: not available yet.</p>
    <div class="actions">
      <a href="${gmaps}" target="_blank" rel="noopener">Open in Google Maps</a>
      <a href="${cantonalMapUrl(spot.canton)}" target="_blank" rel="noopener">Open cantonal map</a>
    </div>
  </div>`;
}

const markers = new Map<string, L.CircleMarker>();
const spotLayer = L.layerGroup(
  spots.map((spot) => {
    const m = L.circleMarker([spot.lat, spot.lon], {
      radius: 9,
      color: '#ffffff',
      weight: 2,
      fillColor: '#4a5a4e',
      fillOpacity: 0.95,
    })
      .bindTooltip(spot.name)
      .bindPopup(spotPopup(spot), { maxWidth: 300 });
    markers.set(spot.id, m);
    return m;
  }),
).addTo(map);

L.control
  .layers(
    undefined,
    { Spots: spotLayer, 'Reserves (approx.)': reserveLayer, 'Canton borders': borders },
    { collapsed: true },
  )
  .addTo(map);

// Frame ZH + SZ. Refit once layout and styles have settled, otherwise Leaflet can measure a wrong size.
const ZH_SZ_BOUNDS = L.latLngBounds([46.93, 8.35], [47.7, 9.0]);
const frame = (): void => {
  map.invalidateSize();
  map.fitBounds(ZH_SZ_BOUNDS);
};
frame();
if (document.readyState !== 'complete') window.addEventListener('load', frame, { once: true });

// --- Panel -----------------------------------------------------------------

$('spot-list').innerHTML = spots
  .map(
    (s) =>
      `<li><button type="button" data-id="${s.id}">${esc(s.name)}<span class="meta">${s.canton} · ${s.elevation_band.min}–${s.elevation_band.max} m</span></button></li>`,
  )
  .join('');
$('spot-list').addEventListener('click', (e) => {
  const id = (e.target as HTMLElement).closest('button')?.dataset.id;
  const spot = spots.find((s) => s.id === id);
  const marker = id ? markers.get(id) : undefined;
  if (!spot || !marker) return;
  map.setView([spot.lat, spot.lon], Math.max(map.getZoom(), 13));
  marker.openPopup();
  document.getElementById('map')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
