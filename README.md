# Mushroom Finder (Zürich & Schwyz)

A mobile-first web app that estimates how likely you are to find some edible mushrooms right now at spots in the cantons of Zürich and Schwyz. Each spot gets a 0–100 score.

> **This app does not identify mushrooms.** Check every find at an official mushroom control (Pilzkontrolle).

**Live:** https://whnhf2f85z-tech.github.io/mushroom-finder/ · Full spec: [SPEC.md](SPEC.md)

## Status

**Milestone 1 (scaffold): done.** Monorepo, scoring engine with tests, data files, map on GitHub Pages.

**Milestone 2 (weather + daily job): done**

- Daily GitHub Action (`.github/workflows/daily-scores.yml`, 03:30 UTC). It fetches Open-Meteo weather for the 14 spots, scores the 9 species for the last 14 days, today and 3 forecast days, writes `web/public/data/latest.json` and `history/YYYY-MM-DD.json` (30 kept), commits, and redeploys the site.
- Missing days in the 14-day window are filled automatically. `--backfill N` recomputes the last N days.
- Retries with backoff. A spot whose weather fails keeps its previous scores and is marked stale. If everything fails, nothing is written. Files are checked against a schema before they're written.
- Map: spots coloured by score with the number on each pin, species chips, and a day slider (13 days back to 3 days ahead, forecast labelled).
- Spot detail (bottom sheet on mobile): metascore, per-species bars, 14-day chart with toggles and forecast shading, rain and temperature charts, and a table view.
- Golden test on real autumn-2026 weather. **To do after 28 Oct 2026:** run `npm run record:golden`, then `npm test`. This replaces the 21–26 Oct forecast in the fixture with the observed weather; if a check then fails, the model needs a look, not the test. See [docs/SCORING.md](docs/SCORING.md) for the results and the one formula change.

**Milestone 3 (habitat): done**

- Weather model checked against 6 MeteoSwiss stations: Open-Meteo `best_match` stays (see [docs/DATA_SOURCES.md](docs/DATA_SOURCES.md)).
- Favourites: "My favourites" (stored on the device; default chanterelle, porcini, winter chanterelle, horn of plenty, hedgehog) drives the map pins and each spot's main score. The detail still shows every species.
- Habitat build (`npm run terrain`, or the manual GitHub workflow "Build habitat"): tree cover and conifer share (NFI), elevation/slope/aspect (swissALTI3D), Schwyz forest site types → soil pH, geology fallback, reserves. 11 pins moved into forest inside their band, away from no-picking areas (table in [docs/SCORING.md](docs/SCORING.md)).
- "Why this score" panel: plain-English reasons for each part of the score, for any species.

**Before Milestone 4**

- Ibergeregg – upper spruce moved out of the Ibergeregg nature reserve; spot notes rewritten from the official site maps.
- `npm run export:spots` writes `pilze-schwyz.kml` (same folders and styles as the original) and `spots.txt` from `data/spots.json`.
- Golden test uses Ibergeregg's real limestone habitat (see [docs/SCORING.md](docs/SCORING.md)).

**Milestone 4 (grid): done**

- 1 km forest grid over Zürich and Schwyz: 1,567 squares with ≥ 20 % tree cover (ZH 1,025, SZ 542), each with its own habitat (`npm run grid`, ~10 min, or the manual workflow "Build habitat and grid").
- Weather from 314 points (one per 3 × 3 km block), adjusted to each square's elevation; paced to respect Open-Meteo's limits.
- Heatmap with the day slider and species chips; Squares / Spots / Both toggle; numbers on the squares when zoomed in; "Best forest squares" list; square detail with a 14-day chart.
- Real reserve outlines: hatched red = no picking (SZ plant reserves and listed reserves, ZH nature protection zones), dashed orange = protected, check the rules (other reserves, ZH forest protection zones, federal moors).

**Milestone 5 (pins + find log): done**

- **My pins:** long-press (phone) or right-click (computer) the map, "Add pin on the map", or "Enter coordinates". Pins must be in ZH or SZ. They are stored on this device and scored in the browser with the same engine, at the pin's own elevation (swisstopo). Tree mix, soil and slope come from the nearest forest square within 1.5 km (otherwise unknown, lower confidence); protection from the reserve outlines. Pin detail = the spot detail, incl. "Why this score". Export/import as JSON (`mushroom-finder-pins`), e.g. to share with friends or to add a pin to `data/spots.json` by hand.
- **Squares:** "Why this score" via a live recalculation (same weather point and elevation shift as the daily job); shows the weather point (distance, elevation difference) and warns when the square is > 200 m above it.
- **Find log:** "Log a visit" in spot, square and pin details; favourites listed first. Date, species, found / not found, grams, note. The score for that day (and its six parts when available) is saved automatically for calibration. Visits appear as ▲ / ✕ on the 14-day charts. Export CSV or JSON, import JSON. Stored on this device only.
- Reserve outlines load in the background after the map.

**Next: Milestone 6 (PWA polish):** offline use (cache the app, `latest.json`, the grid files and `static/reserves.geojson`), install, stale-data banner, About/attribution, species screen, accessibility pass.

## Develop

Needs Node 20+.

```bash
npm install
npm run dev        # web app on http://localhost:5173/mushroom-finder/
npm test           # unit tests (also validates data/*.json)
npm run typecheck
npm run format
npm run build      # production build in web/dist
npm run daily      # fetch weather + score now (writes web/public/data); add -- --backfill 14 to recompute
npm run record:golden   # re-record the golden-test weather
npm run terrain    # rebuild static/habitat.json (add -- --move-pins to also check and move pins)
npm run grid       # rebuild the forest grid and the reserve overlay (~10 min)
npm run export:spots   # write pilze-schwyz.kml and spots.txt from data/spots.json
```

The daily job commits to `main` every morning, so run `git pull` before you start working.

Pushing to `main` runs the tests and deploys to GitHub Pages (`.github/workflows/deploy-pages.yml`).

## Layout

```
packages/scoring   shared TypeScript scoring engine + tests
pipeline           daily weather/scoring job (Milestone 2)
web                Vite + Leaflet web app
data               hand-edited source data (species, spots, reserves, rules)
docs               data sources, scoring method, calibration
```

## Data & attribution

Base map and canton borders © swisstopo. Canton rules from zh.ch and sz.ch. See [docs/DATA_SOURCES.md](docs/DATA_SOURCES.md).
