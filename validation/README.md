# Validation suite

Checks the scoring model against existing data. Results and charts: [docs/VALIDATION.md](../docs/VALIDATION.md).

Scoring always uses the app's own engine (`@mf/scoring`); Python is only used to draw the charts.

```bash
# once: chart tools in a local environment (not committed)
python3 -m venv validation/.venv && validation/.venv/bin/pip install matplotlib numpy

# Part A – occurrence data
npx tsx validation/fetch-occurrences.ts   # GBIF records → validation/data/occurrences.json
npx tsx validation/habitat-test.ts        # → validation/results/habitat.json
npx tsx validation/season-test.ts         # → validation/results/season.json
npx tsx validation/weather-test.ts        # ~6,000 Open-Meteo calls, ~1 h; resumable → validation/results/weather.json
validation/.venv/bin/python validation/plots.py   # → docs/validation/*.png

# Part B – past seasons
npx tsx validation/past-seasons.ts        # ~4,200 Open-Meteo calls → validation/results/past-seasons.json
                                          # (better: GitHub Actions → "Validation (manual)" → Run workflow)
npx tsx validation/fetch-ticker.ts        # Pilz-Ticker report dates → validation/results/ticker.json
validation/.venv/bin/python validation/plots.py
```

Downloads (GBIF pages, weather, elevations) are cached in `validation/cache/` (git-ignored). The weather test stays below Open-Meteo's per-minute limit; if the daily limit is reached it stops and can be re-run later, continuing from the cache.

Data: GBIF.org (SwissFungi CC BY 4.0; iNaturalist and Observation.org CC BY-NC 4.0; others CC BY 4.0 / CC0). Weather: Open-Meteo (CC BY 4.0). Elevation: swisstopo swissALTI3D.
