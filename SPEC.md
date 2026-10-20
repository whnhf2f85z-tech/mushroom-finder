# Mushroom Likelihood App: Zürich & Schwyz

**Spec for Claude Code.** Build a mobile-first web app, hosted on GitHub Pages and installable as a PWA. It estimates how likely you are to find specific edible mushrooms right now at locations in the cantons of Zürich (ZH) and Schwyz (SZ). It shows a 0–100 metascore with a red→green colour scale and how each score changed over the past 14 days.

UI language: **English**. Audience: the owner and friends, via a public but unpromoted GitHub Pages URL.

---

## 1. Goals and non-goals

**Goals (v1)**
- Score **9 species** at **named spots** and on a **forest grid heatmap** covering ZH and SZ.
- Combine **recent and forecast weather**, **season**, and **static terrain/habitat** (forest type, tree mix, soil pH proxy, elevation, aspect) into one explainable score.
- Show a **14-day history** per spot and per species, plus a time slider for the heatmap.
- Let users **add their own pins**, scored the same way.
- Provide a **find log** (found / not found) stored on the device and exportable, for later calibration.
- Flag **no-picking areas** (nature reserves) and **canton rules**, e.g. ZH closed days.

**Non-goals (v1)**
- No mushroom identification, ever. The app must never suggest a mushroom is safe to eat.
- No alerts or notifications.
- No native Android app or APK. An installable PWA only.
- No user accounts or server database.

---

## 2. Architecture

```
GitHub repo
├── Daily GitHub Action (cron)  ──►  fetch weather ─► compute scores ─► commit /public/data/*.json
├── Manual GitHub Action        ──►  build static terrain/habitat layer (rarely re-run)
└── GitHub Pages                ──►  static PWA reads /data/*.json; scores user pins in-browser
```

- **Single scoring engine in TypeScript** (`packages/scoring`). The Node pipeline uses it for spots and the grid. The browser uses the same module for user pins, fetching Open-Meteo live. There must be no duplicate logic.
- **Frontend:** Vite + TypeScript, Leaflet (or MapLibre GL) for maps, Chart.js (or uPlot) for history charts, `vite-plugin-pwa` for install and offline. Keep dependencies lean. No heavy framework is required; Preact or Svelte is fine if it helps.
- **Pipeline:** Node 20+ with TypeScript (`tsx`). Python is only acceptable for the one-off terrain build if the GIS tooling is much simpler there (e.g. rasterio, geopandas). If so, document it.
- **Data refresh:** daily at ~05:00 Europe/Zurich. GitHub cron runs in UTC, so use `30 3 * * *` and accept that runs can be delayed.
- **Keepalive:** GitHub disables scheduled workflows in public repos after 60 days without repository activity. Verify that the daily data commit counts as activity; if not, add a keepalive.
- **History retention:** keep 30 daily snapshots in the repo and display 14. Prune older ones.
- **Backfill:** on the first run, or with `--backfill N`, compute the past N days from historical weather so the charts are never empty.

---

## 3. Locations

### 3.1 Seed spots (canton Schwyz)

Store in `data/spots.json` with `id`, `name`, `canton`, `lat`, `lon`, `elevation_band` and `notes`.

| Name | Lat | Lon | Notes |
|---|---|---|---|
| Ibergeregg – Alpthal side | 47.022 | 8.708 | 1,100–1,400 m, flysch, spruce-fir |
| Oberiberg – Ybrig forests | 47.035 | 8.790 | 1,100–1,300 m |
| Unteriberg – Studen slopes | 47.058 | 8.835 | Breitried reserve nearby |
| Wägital – Innerthal lake slopes | 47.095 | 8.925 | wet flysch valley |
| Sattel – Hochstuckli | 47.075 | 8.660 | 1,000–1,300 m |
| Raten – Biberegg side | 47.115 | 8.660 | near ZG border, near Rothenthurm moors |
| Ibergeregg – upper spruce | 47.015 | 8.720 | 1,200–1,400 m |
| Hoch-Ybrig – Weglosen | 47.030 | 8.810 | 1,050–1,300 m |
| Hochstuckli – upper slopes | 47.072 | 8.670 | 1,200–1,400 m |
| Haggenegg – Alpthal side | 47.040 | 8.693 | 1,100–1,400 m |
| Rigi north – above Küssnacht | 47.060 | 8.455 | beech, 600–1,000 m |
| Rigi – above Arth-Goldau | 47.045 | 8.525 | beech |
| Morschach forest slopes | 46.975 | 8.625 | beech |
| Gersau beech forests | 46.995 | 8.515 | beech |

**Reserve markers** (approximate; use real polygons from the data sources in §4):
- Rothenthurm moors: 47.100, 8.675
- Schwantenau: 47.145, 8.735
- Oberer Sihlsee: 47.100, 8.775

There are no ZH seed spots yet. The grid covers ZH, and users can add pins.

### 3.2 User pins
- Added by long-press or tap on the map, or by entering lat/lon.
- Stored in `localStorage` (wrapped in try/catch).
- Scored in-browser by the shared engine. Habitat comes from the nearest precomputed grid cell, or from a live point query if feasible.
- **Export/import** pins as JSON, so they can be shared with friends or added to `spots.json` via a PR.

### 3.3 Grid heatmap
- **Cells:** 1 km, in LV95 / EPSG:2056 aligned to round kilometres, over ZH + SZ. Keep only cells with **≥ 20 % forest cover**.
- **Expected size:** roughly 1,000–1,500 cells. Verify and log it.
- **Weather:** fetch on a **coarser grid** (~2–3 km, roughly the weather-model resolution) and assign each forest cell its nearest weather point. This keeps API calls low.
- **Output:** per species per day, as a compact array keyed by cell id, plus a cell geometry file built once.

---

## 4. Data sources

Claude Code must verify each endpoint and layer name before relying on it, and record the findings in `docs/DATA_SOURCES.md`. Attribution is required for most sources; show it in the About screen.

### 4.1 Weather (dynamic)
- **Open-Meteo:** free, no key, ~10,000 calls/day for non-commercial use.
  - Forecast API with `past_days` covers recent days plus the forecast.
  - Historical/archive API for backfill. Note that the archive lags a few days, so use `past_days` on the forecast endpoint to cover that gap.
  - Batch multiple coordinates per request where the API allows it.
  - Prefer a high-resolution Swiss-capable model, e.g. MeteoSwiss ICON-CH if Open-Meteo exposes it; otherwise use the default best-match. Record the choice.
  - **Daily variables:** precipitation sum, Tmin/Tmax/Tmean, relative humidity mean, ET0 (evapotranspiration).
  - **Hourly → daily:** soil moisture (0–7 cm, 7–28 cm) and soil temperature (0–7 cm).
- **Optional later:** MeteoSwiss open station data, to sanity-check precipitation.

### 4.2 Terrain and habitat (static, built once)

| Factor | Source (verify) | Use |
|---|---|---|
| Elevation, slope, aspect | swisstopo DEM (swissALTI3D / DHM25) or Open-Meteo elevation API for points | elevation band; north/south exposure |
| Forest cover and mask | swisstopo / BAFU forest layers via `api3.geo.admin.ch` identify, or ZH/SZ Waldareal | grid filtering |
| Conifer vs broadleaf mix | BAFU `ch.bafu.landesforstinventar-waldmischungsgrad` (LFI forest mix rate; WMS/WMTS on geo.admin.ch) | host-tree compatibility |
| Forest site type (best soil/pH proxy) | **ZH:** vegetation mapping of forests (Waldvegetationskarte), WMS `wms.zh.ch/WaldVKWMS`, plus the OGD ZH WFS. **SZ:** inspect `wfs.geo.sz.ch` / `map.geo.sz.ch` capabilities for a forest site layer (Waldstandorte); if none is open, fall back to geology | acidic vs calcareous; beech vs spruce-fir site |
| Geology (pH fallback) | swisstopo GeoCover (1:25k) or Geology 500 via `api3.geo.admin.ch` identify | map lithology → pH class (see §5.3) |
| Protected areas | Federal inventories (raised bogs / Hochmoore, fens, moorland landscapes; BAFU layers on geo.admin.ch); SZ nature reserves and plant protection areas (`wfs.geo.sz.ch`); ZH nature reserves (OGD ZH WFS) | "no picking" overlay and flag |

Store results in `public/data/static/habitat.json` (per cell and per spot) as small categorical fields:
`forest_pct`, `conifer_pct`, `site_type_code`, `ph_class` (`acidic` / `neutral` / `calcareous` / `unknown`), `elevation`, `aspect`, `slope`, `protected` (bool + name).

### 4.3 Canton rules (show in UI)
- **Schwyz:** max 2 kg per person per day (morels max 1 kg). No closed days since 2010. No picking in listed nature reserves. Organised group picking is banned.
- **Zürich:** no picking on the **1st–10th of each month**. Verify the current Zürich quantity limit and other rules from official canton sources, then store them in `data/rules.json`.
- **UI behaviour:** on ZH closed days, ZH spots and cells show a **"Closed today (ZH rule)"** badge. The score is still displayed but greyed out.

---

## 5. Scoring model

All parameters live in `data/species.json` and `packages/scoring/config.ts` so they can be tuned without code changes. The values below are **initial expert estimates** to be calibrated later.

### 5.1 Components (each 0–1)
1. **Season S:** a trapezoid curve over day-of-year per species, shifted by elevation. Autumn species fruit roughly 3–5 days earlier per 100 m higher; spring morels start later with elevation.
2. **Moisture M:**
   - Rain needs to have fallen in the right window before fruiting. Compute a lagged effective-precipitation score: precipitation convolved with a species lag kernel (e.g. weights peaking 7–14 days back), minus ET0.
   - Blend 60/40 with Open-Meteo soil moisture (7–28 cm) normalised to that location's 60-day range.
   - A single rainy day must not produce a high M. Require cumulative ~30–50 mm effective rain within the window for a full score.
3. **Temperature T:**
   - 7-day mean temperature against the species' optimal band (a smooth plateau with tails).
   - Small bonus for a **cooling trigger** (mean temperature falling by ≥3 °C over the last 5–10 days after warm weather), important for porcini.
4. **Frost factor F:** multiplier 0–1. Each night with Tmin < −1 °C in the last 7 days reduces it. Cold-tolerant species (winter chanterelle, honey fungus) are penalised less. Two hard frosts (< −3 °C) bring sensitive species close to 0.
5. **Drought memory D:** multiplier 0.6–1. Reduce it when the 60-day precipitation is far below normal (stressed mycelium; flushes are smaller and later). Use the Open-Meteo archive for a simple climatology, or a fixed regional normal.
6. **Habitat H (static):** a weighted match of host trees (`conifer_pct` vs species preference), `ph_class`, elevation band and aspect. North-facing slopes get a small bonus when D is low. Protected cells are flagged, not zeroed.

### 5.2 Metascore
```
dynamic   = (S^0.5) * (0.6*M + 0.4*T)          # season gates hard
species_score = round(100 * H * dynamic * F * D)
location_metascore = max over species_score
                     (or the user's selected species only)
```
- Also store each component, so the UI can explain every score.
- **Confidence:** high / medium / low, based on data completeness. For example, if `ph_class` is unknown or the weather point is far away, confidence is lower.
- **Colour scale:** 0–19 red, 20–39 orange, 40–59 yellow, 60–79 light green, 80–100 green. Always show the number too. Use a colour-blind-safe palette with sufficient contrast.

### 5.3 Lithology → pH class (initial mapping, extend as needed)
- **acidic:** flysch sandstones/shales, siliceous molasse sandstones, decalcified moraine, peat/moor margins, crystalline rocks
- **calcareous:** limestone, dolomite, marl-rich units, calcareous Nagelfluh, calcareous moraine
- **neutral / unknown:** everything else

When a forest site type is available, it overrides geology. For example, bilberry spruce-fir and acidic beech forests (e.g. Luzulo-Fagetum types) map to acidic.

### 5.4 Species parameters (initial)

| Species (English / German) | Season (main) | Hosts | pH | Elevation | Temp band (7-day mean) | Rain lag | Frost tolerance |
|---|---|---|---|---|---|---|---|
| Chanterelle / Eierschwamm (*Cantharellus cibarius*) | Jun–Oct | spruce, fir, beech, oak | acidic | 400–1,600 m | 10–20 °C | 7–14 d | low |
| Porcini / Steinpilz (*Boletus edulis*) | Jul–Oct | spruce, beech, fir | acidic–neutral | 500–1,800 m | 10–18 °C + cooling trigger | 10–14 d | low |
| Winter chanterelle / Trompetenpfifferling (*Craterellus tubaeformis*) | Sep–Dec | spruce, fir; moss, rotting wood | acidic, moist | 600–1,500 m | 4–14 °C | 7–14 d | high |
| Horn of plenty / Totentrompete (*Craterellus cornucopioides*) | Aug–Nov | beech (oak) | neutral–calcareous | 400–1,200 m | 8–16 °C | 10–14 d | medium |
| Bay bolete / Maronenröhrling (*Imleria badia*) | Aug–Nov | spruce, pine | acidic | 400–1,500 m | 8–16 °C | 7–12 d | medium |
| Hedgehog / Semmelstoppelpilz (*Hydnum repandum*) | Aug–Nov | beech, spruce | broad | 400–1,500 m | 6–16 °C | 7–14 d | medium-high |
| Honey fungus / Hallimasch (*Armillaria* spp.) | Sep–Nov | stumps, all forest | broad | 300–1,400 m | 6–15 °C | 5–10 d | high |
| Parasol (*Macrolepiota procera*) | Jul–Oct | forest edges, clearings, meadows | neutral–calcareous | 300–1,200 m | 12–20 °C | 7–10 d | low |
| Morel / Morchel (*Morchella* spp.) | Mar–May | ash, elm, riparian forest, gravel | calcareous | 300–1,000 m | soil 8–12 °C trigger | 5–10 d | low |

**Morels** score ~0 in autumn. The UI should explain that this is out of season rather than showing a confusing red.

**Habitat notes for H:**
- Parasol favours forest edges and clearings. Use the distance to the forest edge or the forest percentage of the cell (prefer 20–60 % forest cover), not dense forest.
- Honey fungus depends little on soil.

---

## 6. UI

**Mobile-first, works on desktop.** Five screens:

1. **Map (home)**
   - Species selector: all species / single species, with chips.
   - Toggle: grid heatmap / spots / both.
   - Date slider: −13 days → today. Optionally +3 forecast days, labelled clearly as a forecast.
   - Overlays: reserves (hatched red), canton borders.
   - Legend with the colour bands.
   - "Last updated" timestamp.
2. **Spot / cell detail** (bottom sheet on mobile)
   - Metascore badge, plus a per-species list with mini bars.
   - **14-day line chart:** one line per species (toggleable), with find-log markers.
   - "Why this score": component breakdown (S, M, T, F, D, H) in plain English, e.g. "38 mm rain 8–14 days ago ✓, 2 frost nights ✗".
   - Weather summary: last 14 days of rain bars plus Tmin/Tmax.
   - Rules and warnings: canton rules, reserve flag, ZH closed-day badge.
   - Buttons: "Log a visit", "Open in Google Maps" (coordinates link), "Open cantonal map" (map.geo.sz.ch / maps.zh.ch).
3. **Species**
   - Short habitat and season notes per species, with a typical look-alike warning.
   - Must say clearly: "This app does not identify mushrooms. Check every find at an official mushroom control (Pilzkontrolle)."
4. **Find log**
   - Fields: date, spot or pin, species, found / not found, optional quantity and note.
   - Stored in `localStorage`.
   - Export / import as CSV and JSON.
   - The score at the time of the visit is captured automatically, for later calibration.
5. **Settings / About**
   - Units, default species, data attribution, disclaimers, method summary, link to the repo.

**PWA requirements:**
- Installable, with icon and manifest.
- Works offline with the last downloaded data.
- Shows a stale-data banner if the data is more than 36 hours old.

---

## 7. Repo structure

```
/packages/scoring        # shared TS engine + unit tests
/pipeline                # daily job: fetch weather, score, write JSON, prune history
/pipeline/terrain        # one-off habitat build (TS or Python)
/web                     # Vite PWA
/data                    # spots.json, species.json, rules.json (source of truth, hand-edited)
/web/public/data         # generated: latest.json, history/YYYY-MM-DD.json, static/*
/docs                    # DATA_SOURCES.md, SCORING.md, CALIBRATION.md
/.github/workflows       # daily-scores.yml, build-terrain.yml (manual), deploy-pages.yml
```

**Data formats**
- Version the JSON schemas (`schemaVersion`) and validate them in CI (e.g. zod).
- Keep the grid output compact: per day, a `Uint8`-style array of scores per species, in cell-index order, gzip-friendly.
- Target **< 300 KB per daily file**.

---

## 8. Quality

- **Unit tests** for every scoring component, including edge cases: no rain, single storm, frost, out of season, missing habitat.
- **Golden test:** a recorded weather fixture from autumn 2026 (dry summer, rain around 10 Oct). Ibergeregg chanterelle/winter chanterelle scores should rise from low toward medium/high between ~20 and 26 Oct. Low-elevation dry Mittelland cells should stay lower.
- **Pipeline resilience:**
  - Retries with backoff.
  - Partial failure keeps the previous day's data and marks it stale.
  - Never commit an empty or invalid file.
- **API etiquette:** respect Open-Meteo limits. Log the call count per run.
- **Accessibility:** colour is never the only cue; keyboard navigation and sufficient contrast.

---

## 9. Build order (milestones)

1. **Scaffold:** monorepo, scoring engine with tests, `species.json` / `spots.json` / `rules.json`, Pages deploy of a basic map with spots.
2. **Weather + daily job:** Open-Meteo fetch for spots, scoring, `latest.json`, 14-day backfill, history charts.
3. **Habitat:** terrain/habitat build for spots (geology, forest mix, site type, DEM), "why this score" panel.
4. **Grid:** 1 km forest grid for ZH + SZ, coarse weather grid, heatmap with date slider, reserve overlay.
5. **User pins + find log:** in-browser scoring, export/import.
6. **PWA polish:** offline, install, stale banner, About/attribution, accessibility pass.

After each milestone, update the README with what works and what's next.

---

## 10. Open items for Claude Code to resolve and document

- Exact Open-Meteo endpoints, model and variable names; batch-coordinate limits.
- Whether Schwyz publishes an open forest site layer (Waldstandorte); if not, confirm the geology fallback.
- Exact layer IDs for protected areas (federal + ZH + SZ) and how to query them (WFS vs `api3.geo.admin.ch` identify).
- Current Zürich picking rules beyond the 1st–10th closed days.
- Grid cell count and run time of the daily job (must finish well under 10 minutes).

---

## 11. Acceptance criteria (v1)

- The public Pages URL loads on a phone, can be installed, and works offline with the last data.
- Daily job runs automatically. `latest.json` and 14 history days are present for all spots and grid cells.
- Each spot shows a metascore, per-species scores, a 14-day chart, and a plain-English explanation.
- The heatmap shows the selected species with a working date slider and reserve overlay.
- User pins can be added, are scored, and can be exported/imported. The find log works and exports CSV.
- ZH closed-day badge appears on the 1st–10th; disclaimers and attributions are visible.
