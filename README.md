# Mushroom Finder (Zürich & Schwyz)

A mobile-first web app that estimates how likely you are to find some edible mushrooms right now at spots in the cantons of Zürich and Schwyz. Each spot gets a 0–100 score.

> **This app does not identify mushrooms.** Check every find at an official mushroom control (Pilzkontrolle).

**Live:** https://whnhf2f85z-tech.github.io/mushroom-finder/ · Full spec: [SPEC.md](SPEC.md)

## User guide

> **This app does not identify mushrooms.** Check every find at an official mushroom control (Pilzkontrolle).

### Install it on your phone

- **iPhone / iPad:** open the link in **Safari**, tap the **Share** button (square with an arrow), then **Add to Home Screen**. Please do this: Safari can delete a website's data (your pins and find log) after 7 days without use, but it keeps the data of an app on the home screen.
- **Android:** open the link in **Chrome**, tap **⋮** (top right), then **Install app** (or **Add to Home screen**). You can also use the **Install the app** button on the About page when it appears.
- Once installed, it also works **offline** with the last scores it downloaded: the 14 days of scores, the forest squares, the reserves and the map areas you have already looked at.

### Read the scores

- Every place gets a score from **0 to 100**: 0–19 very low, 20–39 low, 40–59 medium, 60–79 good, 80–100 very good. The number is always shown; colour is only a help.
- **My favourites** (the default chip) shows the best score among your favourite species. Tap a species chip to see just that one, or **Edit favourites** to change the list.
- The **day slider** goes from 13 days ago to 3 days ahead ("Forecast").
- **Squares** are 1 × 1 km of forest; **spots** are the named places; **pins** are yours. Tap any of them for the details: all species, the 14-day chart, the weather and **Why this score**.
- **Hatched red:** no picking. **Dashed orange:** protected area, check the rules. **Grey:** closed that day (Zürich: 1st–10th of every month).
- Scores are estimates from weather, season and habitat. A high score is never a promise, and never a sign that a mushroom is safe to eat.

### Log your visits, export and import

- In a spot, square or pin, tap **Log a visit**: date, species (your favourites come first), found or not, grams, note. The score for that day is saved with it. It also works offline; the score is added when you're back online.
- **Find log** page → **Export CSV** (for a spreadsheet) or **Export JSON** (a full backup). **Import JSON** restores a backup or merges one from another device; visits you already have are skipped.
- Your favourites, pins and find log live **only on that device**. The Find log page shows when you last exported; export now and then.

### Share pins with a friend

1. On the map page, under **My pins**, tap **Export pins**. You get a file like `mushroom-finder-pins-2026-10-20.json`.
2. Send the file (message, e-mail, AirDrop).
3. Your friend opens the app, taps **Import pins** and picks the file. Pins they already have are skipped; the new ones are scored straight away.

To add a pin to the official spot list for everyone, send the exported file to the project owner (or open a pull request that adds it to `data/spots.json`).

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

**Milestone 6 (PWA): done**

- Installable app (manifest, icons, service worker). Offline: the app, the latest scores, the 14-day grid scores (+ forecast), `grid.json`, `reserves.geojson` and the map tiles already viewed. Offline banner; stale-data banner after 36 h.
- Pages: Map, Species (season, habitat, dangerous look-alikes by name only, safety notes), Find log, About (how to read scores, install, your data, settings, method, rules, credits).
- Find log: "Last exported" with a reminder after 14 days; persistent storage is requested on the first save; visits logged offline get their score later.

**Possible next steps:** calibration with the collected find logs (docs/CALIBRATION.md); a second check of the weather model after more rain events.

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
