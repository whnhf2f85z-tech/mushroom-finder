# Scoring method

Code: `packages/scoring/src`. Global parameters: `packages/scoring/src/config.ts`. Species parameters: `data/species.json`. All values are first estimates, to be calibrated with the find log.

Weather input is a list of days, oldest first, ending on the day being scored (60+ days for full confidence).

| Component            | Range   | How                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| -------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **S** season         | 0–1     | Trapezoid over day of year (`start → peakStart → peakEnd → end`), moved by elevation relative to `referenceElevation`. Start and end move separately (`startDaysPer100m`, `endDaysPer100m`): autumn species start 4 days earlier per 100 m but end only 2 days earlier (frost ends the season dynamically through F). Morels start and end 5 days later per 100 m.                                                                                                                                                      |
| **M** moisture       | 0–1     | 60 % rain, 40 % soil. **Rain:** precipitation weighted by a lag kernel (1 inside the species' `rainLag` window, ramping to 0 over 4 days each side), each day capped at 20 mm (so one storm gives at most half the score), minus 30 % of ET0 in the same window. Smoothstep up to `fullRainMm` (30–45 mm). **Soil:** 7–28 cm soil moisture normalised to the location's 60-day range (absolute 0.15–0.40 m³/m³ if the range is flat), averaged with the same lag kernel so wet soil counts with the same delay as rain. |
| **T** temperature    | 0–1     | 7-day mean (air; soil 0–7 cm for morels) against the species band, cosine tail to 0 at `tail` °C outside. Plus `coolingBonus` (porcini 0.15) if the last 3 days are ≥ 3 °C cooler than a 3-day period 5–10 days ago that was ≥ 12 °C.                                                                                                                                                                                                                                                                                   |
| **F** frost          | 0–1 ×   | Last 7 nights: each Tmin < −1 °C and each < −3 °C multiplies by a tolerance-dependent factor (low: ×0.75 / ×0.25; high: ×0.95 / ×0.8).                                                                                                                                                                                                                                                                                                                                                                                  |
| **D** drought memory | 0.6–1 × | 60-day rain vs a fixed regional normal (annual ≈ 900 mm + 0.6 mm per metre of elevation). Ratio ≥ 0.8 → 1, ≤ 0.3 → 0.6, linear between.                                                                                                                                                                                                                                                                                                                                                                                 |
| **H** habitat        | 0–1     | Weighted geometric mean of host trees (conifer share vs preferred range), pH class, elevation range and forest cover (weights 0.35/0.25/0.25/0.15, per-species overrides). Unknown conifer share counts as 0.7; unknown forest cover is skipped. North-facing slopes (≥ 5°) get up to +0.1 when D is low. Protected areas are flagged, not zeroed.                                                                                                                                                                      |

```
dynamic       = S^0.5 × M^0.6 × T^0.4      (config: combine = 'geometric')
species_score = round(100 × H × dynamic × F × D)
metascore     = max over (selected) species
```

**Confidence:** one issue each for unknown pH, unknown conifer share, missing soil moisture, missing soil temperature (morels), under 60 days of weather, weather point > 3 km away. 0 → high, 1–2 → medium, 3+ → low.

**Colours:** 0–19 very low, 20–39 low, 40–59 medium, 60–79 good, 80–100 very good. Red→green as specified. Red/green alone isn't colour-blind safe, so the bands also differ in lightness and the number and label are always shown.

## Deviations from SPEC §5 (and why)

- **ET0:** the spec says rain _minus ET0_. Subtracting the full ET0 (≈ 3–4 mm/day in late summer) would cancel almost all rain over a 14-day window, so only 30 % is subtracted (shaded forest floor).
- **Single storm cap (20 mm/day):** this is how "a single rainy day must not produce a high M" is enforced.
- **Soil moisture uses the rain lag**, not just today's value. Otherwise M jumps the day it rains, before mushrooms can respond.
- **Separate start/end elevation shift**, so high-elevation chanterelles stay in season into late October (as the seed notes and golden test expect).
- **Moisture and temperature multiply (since Milestone 2).** SPEC §5.2 adds them (`0.6 M + 0.4 T`). With real autumn-2026 weather, that gave Ibergeregg ~53 ("medium") before any rain, because a perfect temperature alone earns 40 points. A weighted geometric mean (`M^0.6 × T^0.4`, same weights) makes dry soil pull the score down. When both are good, the result is almost the same. The spec formula is still there: set `combine: 'additive'` in `config.ts`.

## Spots (Milestone 2)

- Spots are scored at the **middle of their elevation band**, not at the pin (pins mark areas). Weather is requested for that elevation.
- Until the habitat build (Milestone 3), `spots.json` has a provisional `habitat_hint` taken from the notes: flysch → acidic (§5.3); spruce-fir → 85 % conifer, mixed → 60 %, beech → 20 %, beech and mixed → 35 %. Everything else is `unknown`, which lowers confidence.
- Milestone 3 TODO: once the forest mask and DEM exist, check each pin. If it's not in forest or is outside its band, move it to the nearest forest point inside the band (within ~1 km), update `spots.json`, and list the moves here.

## Golden test (real data)

`pipeline/test/golden.test.ts` uses Open-Meteo weather recorded on 2026-10-20 (`npm run record:golden`). 21–26 Oct was still a forecast then. The weather: dry from late September, ~36 mm on 8 Oct and ~10 mm on 10 Oct at Ibergeregg.

| Ibergeregg (1,250 m)            | 10 Oct | 14 Oct | 17 Oct | 20 Oct | 22 Oct | 24 Oct | 26 Oct |
| ------------------------------- | ------ | ------ | ------ | ------ | ------ | ------ | ------ |
| Chanterelle                     | 39     | 48     | 70     | 55     | 55     | 32     | 23     |
| Winter chanterelle              | 39     | 57     | 79     | 65     | 74     | 60     | 56     |
| _Weinland (420 m), chanterelle_ | 35     | 45     | 50     | 40     | 45     | 37     | 33     |

What the test checks: low (< 40) before the rain counts, good (≥ 60) in the flush, a delay instead of a jump on the day of the rain, winter chanterelle lasting into late October while chanterelle fades, and the dry, low Weinland staying lower during the flush (14–22 Oct).

**Difference from SPEC §8:** the spec expects the rise "between ~20 and 26 Oct". With the real weather and the species' 7–14-day rain delay, the rise comes **12–18 Oct** (one to two weeks after the 8 Oct rain). From 23 Oct, the forecast cools Ibergeregg to 3–5 °C and the chanterelle season ends, so chanterelle falls while winter chanterelle stays good. The forecast rain on 21 Oct (~30 mm) would only count from ~28 Oct.
