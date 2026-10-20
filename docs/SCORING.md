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
dynamic       = S^0.5 × (0.6 M + 0.4 T)
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
