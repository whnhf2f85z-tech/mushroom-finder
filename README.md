# Mushroom Finder (Zürich & Schwyz)

A mobile-first web app that estimates how likely you are to find some edible mushrooms right now at spots in the cantons of Zürich and Schwyz. Each spot gets a 0–100 score.

> **This app does not identify mushrooms.** Check every find at an official mushroom control (Pilzkontrolle).

**Live:** https://whnhf2f85z-tech.github.io/mushroom-finder/ · Full spec: [SPEC.md](SPEC.md)

## Status

**Milestone 1 (scaffold) – done**

- npm workspaces monorepo: `packages/scoring`, `web`, `pipeline` (placeholder).
- Scoring engine (season, moisture, temperature, frost, drought, habitat → metascore, confidence, colour bands), with unit tests and a synthetic autumn scenario. Method: [docs/SCORING.md](docs/SCORING.md).
- `data/species.json` (9 species), `data/spots.json` (14 Schwyz spots), `data/reserves.json` (3 approximate reserves), `data/rules.json` (ZH + SZ rules, from official canton pages). Validated with zod in the tests.
- Map on GitHub Pages: swisstopo base map, spots with details, reserves, canton borders, today's canton rules, legend.

**Next – Milestone 2:** Open-Meteo weather for the spots, daily GitHub Action that scores and writes `latest.json`, 14-day backfill, history charts, real golden test.

## Develop

Needs Node 20+.

```bash
npm install
npm run dev        # web app on http://localhost:5173/mushroom-finder/
npm test           # unit tests (also validates data/*.json)
npm run typecheck
npm run format
npm run build      # production build in web/dist
```

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
