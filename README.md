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
- Golden test on real autumn-2026 weather. See [docs/SCORING.md](docs/SCORING.md) for the results and the one formula change.

**Next: Milestone 3 (habitat).** Terrain/habitat build for the spots (geology, forest mix, site type, DEM), moving pins into forest inside their band, and the "why this score" panel.

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
