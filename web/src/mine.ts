import L from 'leaflet';
import {
  bandFor,
  bestOf,
  toTodayDetail,
  type DailyWeather,
  type FindEntry,
  type GridFile,
  type HabitatEntry,
  type LatestFile,
  type LatestSpot,
  type LocationResult,
  type Pin,
  type RulesFile,
  type Species,
  type Spot,
} from '@mf/scoring';
import type { VisitMarker } from './charts.js';
import { closeDetail, renderDetail } from './detail.js';
import { exportLogCsv, exportLogJson, importLog, loadLog, saveLog, sortLog } from './findlog.js';
import { esc, shortDate } from './format.js';
import { scorePlaceLive } from './live.js';
import { cantonAt, elevationAt, pinHabitat, reserveAt } from './pinplace.js';
import { exportPins, importPins, loadPins, newId, savePins } from './pins.js';

export type Place = FindEntry['place'];
export type ScoreCapture = (date: string, speciesId: string) => Promise<FindEntry['score']>;

export interface MineHooks {
  map: L.Map;
  species: Species[];
  rules: RulesFile;
  today: string;
  latest: () => LatestFile | null;
  grid: () => GridFile | null;
  reserves: () => Parameters<typeof reserveAt>[0];
  favourites: () => string[];
  /** Selected species ('favourites' or an id) and day index of the slider. */
  view: () => { species: string; dayIndex: number };
  /** Close any open spot/square detail before a pin detail opens. */
  closeOthers: () => void;
  /** The detail panel was closed: show the overview again. */
  closed: () => void;
  status: (msg: string) => void;
}

interface PinScores {
  results: Map<string, LocationResult>;
  weather: DailyWeather[];
  entry: HabitatEntry;
  cellKm: number | null;
}

const $ = (id: string) => document.getElementById(id)!;

function download(name: string, text: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Pick a JSON file; resolves with its text (or null if cancelled). */
function pickFile(): Promise<string | null> {
  const input = $('file-input') as HTMLInputElement;
  return new Promise((resolve) => {
    input.value = '';
    input.onchange = async () => resolve(input.files?.[0] ? await input.files[0].text() : null);
    input.click();
  });
}

export function setupMine(h: MineHooks) {
  let pins = loadPins();
  let log = loadLog();
  const scores = new Map<string, PinScores | 'loading' | 'error'>();
  const markers = new Map<string, L.Marker>();
  const layer = L.layerGroup().addTo(h.map);
  let selectedPin: string | null = null;
  let addMode = false;

  const dates = (): string[] => {
    const l = h.latest();
    return l ? [...l.days, ...l.forecastDays] : [h.today];
  };

  // --- Pins: scoring --------------------------------------------------------

  async function scorePin(pin: Pin): Promise<void> {
    scores.set(pin.id, 'loading');
    try {
      const { habitat, entry, cellKm } = pinHabitat(
        h.grid(),
        pin,
        reserveAt(h.reserves(), pin.lat, pin.lon),
      );
      const { results, weather } = await scorePlaceLive(
        h.species,
        { lat: pin.lat, lon: pin.lon, elevation: entry.elevation },
        habitat,
        dates(),
        h.today,
      );
      scores.set(pin.id, { results, weather, entry, cellKm });
    } catch {
      scores.set(pin.id, 'error');
    }
    refresh();
    if (selectedPin === pin.id) openPin(pin.id, false);
  }

  /** Score all pins one after the other (each needs two small Open-Meteo requests). */
  async function scoreAll(): Promise<void> {
    for (const p of pins) if (!scores.has(p.id) || scores.get(p.id) === 'error') await scorePin(p);
  }

  function shown(pin: Pin): number | null | 'loading' {
    const s = scores.get(pin.id);
    if (!s || s === 'loading') return 'loading';
    if (s === 'error') return null;
    const date = dates()[h.view().dayIndex];
    const r = date ? s.results.get(date) : undefined;
    if (!r) return null;
    const sel = h.view().species;
    const ids = sel === 'favourites' ? h.favourites() : [sel];
    const byId = Object.fromEntries(r.species.map((x) => [x.speciesId, x.score]));
    return bestOf(byId, ids)?.score ?? null;
  }

  // --- Pins: map and list ---------------------------------------------------

  function refresh(): void {
    for (const [id, m] of markers)
      if (!pins.some((p) => p.id === id)) {
        layer.removeLayer(m);
        markers.delete(id);
      }
    for (const pin of pins) {
      let m = markers.get(pin.id);
      if (!m) {
        m = L.marker([pin.lat, pin.lon], {
          keyboard: true,
          title: pin.name,
          icon: L.divIcon({ className: 'pin-wrap', html: '' }),
        });
        m.on('click', () => openPin(pin.id));
        layer.addLayer(m);
        markers.set(pin.id, m);
      }
      const v = shown(pin);
      const b = typeof v === 'number' ? bandFor(v) : null;
      m.setIcon(
        L.divIcon({
          className: 'pin-wrap',
          html: `<span class="pin pin-user${selectedPin === pin.id ? ' pin-selected' : ''}" style="${b ? `background:${b.color};color:${b.text}` : ''}" aria-hidden="true">${v === 'loading' ? '…' : (v ?? '?')}</span>`,
          iconSize: [34, 34],
          iconAnchor: [17, 17],
        }),
      );
      m.getElement()?.setAttribute(
        'aria-label',
        `My pin ${pin.name}: ${typeof v === 'number' ? `${v} (${b!.label})` : v === 'loading' ? 'scoring…' : 'no score'}`,
      );
    }
    $('pin-list').innerHTML = pins.length
      ? pins
          .map((p) => {
            const v = shown(p);
            const b = typeof v === 'number' ? bandFor(v) : null;
            return `<li><button type="button" data-pin="${p.id}"><span class="score" style="${b ? `background:${b.color};color:${b.text}` : ''}">${v === 'loading' ? '…' : (v ?? '?')}</span><span>${esc(p.name)}<span class="meta">${p.canton}${p.elevation !== null ? ` · ${p.elevation} m` : ''}</span></span></button></li>`;
          })
          .join('')
      : '<li class="small">No pins yet.</li>';
    renderLog();
  }

  // --- Pins: detail ---------------------------------------------------------

  function pinLatest(pin: Pin, s: PinScores): { latest: LatestFile; spot: Spot } | null {
    const l = h.latest();
    // "Today" of the published scores (the browser's date can be ahead if the daily update ran late).
    const today = l ? s.results.get(l.today) : undefined;
    if (!l || !today) return null;
    const ds = dates();
    const byDate = new Map(s.weather.map((d) => [d.date, d]));
    const r1 = (x: number | undefined) => (x === undefined ? null : Math.round(x * 10) / 10);
    const spot: LatestSpot = {
      stale: false,
      updated: l.today,
      today: toTodayDetail(today),
      metaSeries: ds.map((d) => s.results.get(d)?.metascore ?? null),
      series: Object.fromEntries(
        h.species.map((sp) => [
          sp.id,
          ds.map(
            (d) => s.results.get(d)?.species.find((x) => x.speciesId === sp.id)?.score ?? null,
          ),
        ]),
      ),
      weather: {
        precip: ds.map((d) => r1(byDate.get(d)?.precip)),
        tmin: ds.map((d) => r1(byDate.get(d)?.tmin)),
        tmax: ds.map((d) => r1(byDate.get(d)?.tmax)),
      },
    };
    return {
      latest: { ...l, spots: { [pin.id]: spot } },
      spot: {
        id: pin.id,
        name: pin.name,
        canton: pin.canton,
        lat: pin.lat,
        lon: pin.lon,
        elevation_band: { min: s.entry.elevation, max: s.entry.elevation },
        notes: pin.note,
        species_hint: [],
      },
    };
  }

  function openPin(id: string, focus = true): void {
    const pin = pins.find((p) => p.id === id);
    if (!pin) return;
    if (selectedPin !== id) h.closeOthers();
    selectedPin = id;
    const detail = $('detail');
    $('overview').hidden = true;
    const s = scores.get(id);
    if (!s || s === 'loading' || s === 'error') {
      detail.hidden = false;
      detail.innerHTML = `<div class="detail-head"><div><h2>${esc(pin.name)}</h2><p class="small">My pin · ${pin.canton}</p></div><button type="button" class="close" aria-label="Close">×</button></div>
        <p class="small">${s === 'error' ? 'The weather for this pin could not be loaded. <button type="button" class="link-button" data-act="retry">Try again</button>' : 'Scoring this pin with the latest weather…'}</p>
        <div class="actions"><button type="button" class="action-button secondary" data-act="delete">Delete pin</button></div>`;
      detail.querySelector('.close')!.addEventListener('click', closePin);
      detail
        .querySelector('[data-act="retry"]')
        ?.addEventListener('click', () => void scorePin(pin));
      detail.querySelector('[data-act="delete"]')!.addEventListener('click', () => deletePin(pin));
    } else {
      const built = pinLatest(pin, s);
      if (!built) return;
      renderDetail(detail, built.spot, {
        latest: built.latest,
        species: h.species,
        rules: h.rules,
        today: h.today,
        favourites: h.favourites(),
        habitat: s.entry,
        onClose: closePin,
        onLogVisit: () => openVisit(placeOfPin(pin), captureForPin(pin)),
        visits: visitsFor('pin', pin.id),
        pin: {
          cellKm: s.cellKm,
          onRename: () => openPinDialog(pin),
          onDelete: () => deletePin(pin),
        },
      });
    }
    h.map.panTo([pin.lat, pin.lon]);
    refresh();
    if (focus) detail.querySelector<HTMLElement>('.close')?.focus({ preventScroll: true });
  }

  function closePin(): void {
    if (!selectedPin) return;
    const id = selectedPin;
    selectedPin = null;
    closeDetail($('detail'));
    h.closed();
    refresh();
    markers.get(id)?.getElement()?.focus();
  }

  const placeOfPin = (p: Pin): Place => ({
    kind: 'pin',
    id: p.id,
    name: p.name,
    lat: p.lat,
    lon: p.lon,
  });

  const r3 = (x: number) => Math.round(x * 1000) / 1000;
  const captureForPin =
    (p: Pin): ScoreCapture =>
    async (date, sp) => {
      const s = scores.get(p.id);
      const r =
        s && typeof s === 'object'
          ? s.results.get(date)?.species.find((x) => x.speciesId === sp)
          : undefined;
      if (!r) return { value: null, components: null, source: 'none' };
      const c = r.components;
      return {
        value: r.score,
        components: { S: r3(c.S), M: r3(c.M), T: r3(c.T), F: r3(c.F), D: r3(c.D), H: r3(c.H) },
        source: 'live',
      };
    };

  // --- Pins: add, rename, delete, export, import ---------------------------

  const dialog = $('pin-dialog') as HTMLDialogElement;
  let editing: Pin | null = null;

  function openPinDialog(pin: Pin | null, at?: { lat: number; lng: number }): void {
    editing = pin;
    $('pin-h').textContent = pin ? 'Rename pin' : 'New pin';
    ($('pin-name') as HTMLInputElement).value = pin?.name ?? `My pin ${pins.length + 1}`;
    const lat = $('pin-lat') as HTMLInputElement;
    const lon = $('pin-lon') as HTMLInputElement;
    lat.value = pin ? String(pin.lat) : at ? at.lat.toFixed(5) : '';
    lon.value = pin ? String(pin.lon) : at ? at.lng.toFixed(5) : '';
    lat.disabled = lon.disabled = !!pin;
    ($('pin-note') as HTMLTextAreaElement).value = pin?.note ?? '';
    $('pin-error').hidden = true;
    ($('pin-save') as HTMLButtonElement).disabled = false;
    dialog.showModal();
  }

  $('pin-save').addEventListener('click', async (e) => {
    e.preventDefault();
    const err = $('pin-error');
    const fail = (m: string) => {
      err.textContent = m;
      err.hidden = false;
      ($('pin-save') as HTMLButtonElement).disabled = false;
    };
    const name = ($('pin-name') as HTMLInputElement).value.trim();
    const note = ($('pin-note') as HTMLTextAreaElement).value.trim();
    if (!name) return fail('Give the pin a name.');
    if (editing) {
      const id = editing.id;
      pins = pins.map((p) => (p.id === id ? { ...p, name, note } : p));
      savePins(pins);
      dialog.close();
      markers.get(id)?.remove();
      markers.delete(id);
      refresh();
      if (selectedPin === id) openPin(id, false);
      return;
    }
    const lat = Number(($('pin-lat') as HTMLInputElement).value.replace(',', '.'));
    const lon = Number(($('pin-lon') as HTMLInputElement).value.replace(',', '.'));
    if (
      !Number.isFinite(lat) ||
      !Number.isFinite(lon) ||
      lat < 45.8 ||
      lat > 47.9 ||
      lon < 5.9 ||
      lon > 10.5
    )
      return fail('Enter a latitude and longitude in Switzerland, e.g. 47.0200 and 8.7100.');
    ($('pin-save') as HTMLButtonElement).disabled = true;
    err.textContent = 'Checking the place…';
    err.hidden = false;
    let canton;
    try {
      canton = await cantonAt(lat, lon);
    } catch {
      return fail('Could not check the canton (no connection?). Try again.');
    }
    if (!canton) return fail('Pins must be in canton Zürich or Schwyz.');
    const pin: Pin = {
      id: newId('pin'),
      name,
      lat,
      lon,
      note,
      elevation: await elevationAt(lat, lon),
      canton,
      created: new Date().toISOString(),
    };
    pins = [...pins, pin];
    if (!savePins(pins))
      h.status(
        'Your browser did not allow saving: the pin is only kept until you close this page.',
      );
    dialog.close();
    refresh();
    openPin(pin.id);
    void scorePin(pin);
  });

  function deletePin(pin: Pin): void {
    if (!confirm(`Delete the pin "${pin.name}"? Logged visits stay in your find log.`)) return;
    pins = pins.filter((p) => p.id !== pin.id);
    savePins(pins);
    scores.delete(pin.id);
    if (selectedPin === pin.id) closePin();
    refresh();
  }

  function setAddMode(on: boolean): void {
    addMode = on;
    $('add-hint').hidden = !on;
    $('map').classList.toggle('adding', on);
  }
  $('pin-add').addEventListener('click', () => {
    setAddMode(true);
    $('map').scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
  $('add-cancel').addEventListener('click', () => setAddMode(false));
  $('pin-coords').addEventListener('click', () => openPinDialog(null));
  h.map.on('click', (e: L.LeafletMouseEvent) => {
    if (!addMode) return;
    setAddMode(false);
    openPinDialog(null, e.latlng);
  });
  // Long-press on phones, right-click on computers.
  h.map.on('contextmenu', (e: L.LeafletMouseEvent) => openPinDialog(null, e.latlng));
  $('pin-list').addEventListener('click', (e) => {
    const id = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-pin]')?.dataset.pin;
    if (id) openPin(id);
  });
  $('pin-export').addEventListener('click', () => {
    if (!pins.length) return h.status('There are no pins to export yet.');
    download(`mushroom-finder-pins-${h.today}.json`, exportPins(pins), 'application/json');
  });
  $('pin-import').addEventListener('click', async () => {
    const text = await pickFile();
    if (text === null) return;
    try {
      const r = importPins(pins, text);
      pins = r.pins;
      savePins(pins);
      refresh();
      h.status(
        `Imported ${r.added} pin(s)${r.skipped ? `, skipped ${r.skipped} you already had` : ''}.`,
      );
      void scoreAll();
    } catch (err) {
      h.status((err as Error).message);
    }
  });

  // --- Find log -------------------------------------------------------------

  const vdialog = $('visit-dialog') as HTMLDialogElement;
  let visitPlace: Place | null = null;
  let visitCapture: ScoreCapture | null = null;

  function openVisit(place: Place, capture: ScoreCapture): void {
    visitPlace = place;
    visitCapture = capture;
    $('visit-place').textContent = place.name;
    const date = $('visit-date') as HTMLInputElement;
    const selected = dates()[h.view().dayIndex];
    date.max = h.today;
    date.value = selected && selected <= h.today ? selected : h.today;
    const fav = h.favourites();
    const opt = (s: Species) => `<option value="${s.id}">${esc(s.name)}</option>`;
    const sel = h.view().species;
    ($('visit-species') as HTMLSelectElement).innerHTML =
      `<optgroup label="My favourites">${h.species
        .filter((s) => fav.includes(s.id))
        .map(opt)
        .join('')}</optgroup>` +
      `<optgroup label="Other species">${h.species
        .filter((s) => !fav.includes(s.id))
        .map(opt)
        .join('')}</optgroup>`;
    ($('visit-species') as HTMLSelectElement).value =
      sel !== 'favourites' ? sel : (fav[0] ?? h.species[0]!.id);
    (document.querySelector('input[name="visit-found"][value="yes"]') as HTMLInputElement).checked =
      true;
    ($('visit-qty') as HTMLInputElement).value = '';
    ($('visit-note') as HTMLTextAreaElement).value = '';
    $('visit-error').hidden = true;
    ($('visit-save') as HTMLButtonElement).disabled = false;
    vdialog.showModal();
  }

  $('visit-save').addEventListener('click', async (e) => {
    e.preventDefault();
    if (!visitPlace || !visitCapture) return;
    const date = ($('visit-date') as HTMLInputElement).value;
    const err = $('visit-error');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > h.today) {
      err.textContent = 'Pick a date up to today.';
      err.hidden = false;
      return;
    }
    const species = ($('visit-species') as HTMLSelectElement).value;
    const qtyRaw = ($('visit-qty') as HTMLInputElement).value;
    const qty = qtyRaw === '' ? null : Math.max(0, Math.round(Number(qtyRaw)));
    ($('visit-save') as HTMLButtonElement).disabled = true;
    const score = await visitCapture(date, species).catch(() => ({
      value: null,
      components: null,
      source: 'none' as const,
    }));
    const entry: FindEntry = {
      id: newId('visit'),
      date,
      place: visitPlace,
      species,
      found:
        (document.querySelector('input[name="visit-found"]:checked') as HTMLInputElement).value ===
        'yes',
      quantityG: Number.isFinite(qty) ? qty : null,
      note: ($('visit-note') as HTMLTextAreaElement).value.trim(),
      score,
      created: new Date().toISOString(),
    };
    log = [...log, entry];
    if (!saveLog(log))
      h.status(
        'Your browser did not allow saving: the visit is only kept until you close this page.',
      );
    vdialog.close();
    renderLog();
    h.status(`Visit saved${score.value !== null ? ` (score that day: ${score.value})` : ''}.`);
    // Re-open the same detail so the new marker shows on its chart.
    if (selectedPin) openPin(selectedPin, false);
    else document.dispatchEvent(new CustomEvent('mf:visit-saved'));
  });

  function renderLog(): void {
    const name = (id: string) => h.species.find((s) => s.id === id)?.name ?? id;
    $('log-list').innerHTML = log.length
      ? sortLog(log)
          .slice(0, 50)
          .map(
            (e) =>
              `<li><div><span class="found">${e.found ? '▲ Found' : '✕ Not found'}</span> ${esc(name(e.species))}${e.quantityG ? ` · ${e.quantityG} g` : ''}
              <span class="meta">${shortDate(e.date)} · ${esc(e.place.name)}${e.score.value !== null ? ` · score ${e.score.value}` : ''}</span>
              ${e.note ? `<span class="meta">${esc(e.note)}</span>` : ''}</div>
              <button type="button" class="link-button" data-del="${e.id}" aria-label="Delete this visit">Delete</button></li>`,
          )
          .join('') +
        (log.length > 50
          ? `<li class="small">… and ${log.length - 50} older visits (all are in the exports).</li>`
          : '')
      : '<li class="small">No visits logged yet.</li>';
  }

  $('log-list').addEventListener('click', (e) => {
    const id = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-del]')?.dataset.del;
    if (!id || !confirm('Delete this visit from your find log?')) return;
    log = log.filter((x) => x.id !== id);
    saveLog(log);
    renderLog();
  });
  $('log-csv').addEventListener('click', () => {
    if (!log.length) return h.status('The find log is empty.');
    download(
      `mushroom-finder-findlog-${h.today}.csv`,
      exportLogCsv(log, h.species),
      'text/csv;charset=utf-8',
    );
  });
  $('log-json').addEventListener('click', () => {
    if (!log.length) return h.status('The find log is empty.');
    download(`mushroom-finder-findlog-${h.today}.json`, exportLogJson(log), 'application/json');
  });
  $('log-import').addEventListener('click', async () => {
    const text = await pickFile();
    if (text === null) return;
    try {
      const r = importLog(log, text);
      log = r.entries;
      saveLog(log);
      renderLog();
      h.status(
        `Imported ${r.added} visit(s)${r.skipped ? `, skipped ${r.skipped} you already had` : ''}.`,
      );
    } catch (err) {
      h.status((err as Error).message);
    }
  });

  /** Visits at one place within the chart window, as chart markers. */
  function visitsFor(kind: Place['kind'], id: string): VisitMarker[] {
    const ds = dates();
    return log
      .filter((e) => e.place.kind === kind && e.place.id === id)
      .map((e) => ({ index: ds.indexOf(e.date), found: e.found }))
      .filter((m) => m.index >= 0);
  }

  refresh();
  return {
    refresh,
    scoreAll,
    openVisit,
    visitsFor,
    isPinOpen: () => selectedPin !== null,
    /** True while the next map tap places a pin (squares must not open then). */
    isAdding: () => addMode,
    closePin: () => {
      if (!selectedPin) return;
      selectedPin = null;
      refresh();
    },
  };
}
