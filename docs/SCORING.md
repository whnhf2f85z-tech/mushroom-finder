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

## Spots and habitat (Milestone 3)

Habitat comes from `static/habitat.json` (see DATA_SOURCES.md). Spots are scored at their pin's terrain-model elevation; weather is requested for that elevation. Every pin is now inside its band, so this replaces the band midpoint used in Milestone 2. Spots without a habitat entry still fall back to the band midpoint and the `habitat_hint` in `spots.json`.

**Pin check** (`npm run terrain -- --move-pins`): a pin passes if it is in forest (≥ 60 % tree cells within 50 m **and** ≥ 50 % within 150 m, so not a hedge or a forest edge), inside its elevation band, and not in a no-picking area. Otherwise it moves to the nearest 10 m cell within 1 km that passes, at least 20 m inside the band. 11 of 14 pins moved on 2026-10-20:

| Spot                            | Why                                                                            | Old pin       | New pin                     | Moved |
| ------------------------------- | ------------------------------------------------------------------------------ | ------------- | --------------------------- | ----- |
| Ibergeregg – Alpthal side       | not in forest (32 % within 50 m); at 1,528 m, band 1,100–1,400 m               | 47.022, 8.708 | 47.01929, 8.70945 (1,377 m) | 320 m |
| Oberiberg – Ybrig forests       | not in forest (0 %)                                                            | 47.035, 8.790 | 47.035, 8.79127 (1,253 m)   | 100 m |
| Unteriberg – Studen slopes      | not in forest (48 %); at 1,387 m, band 900–1,200 m                             | 47.058, 8.835 | 47.06201, 8.83474 (1,179 m) | 451 m |
| Wägital – Innerthal lake slopes | not in forest (0 %); at 890 m, band 900–1,200 m                                | 47.095, 8.925 | 47.09712, 8.93262 (1,021 m) | 622 m |
| Raten – Biberegg side           | not in forest (36 %); at 965 m, band 1,000–1,100 m                             | 47.115, 8.665 | 47.11407, 8.6636 (1,022 m)  | 141 m |
| Ibergeregg – upper spruce       | not in forest (40 %)                                                           | 47.015, 8.720 | 47.0154, 8.71962 (1,245 m)  | 50 m  |
| Hoch-Ybrig – Weglosen           | at 1,010 m, band 1,050–1,300 m; **in the Hoch-Ybrig plant protection reserve** | 47.030, 8.810 | 47.03749, 8.8087 (1,081 m)  | 837 m |
| Hochstuckli – upper slopes      | at 1,429 m, band 1,200–1,400 m                                                 | 47.072, 8.670 | 47.07197, 8.67133 (1,379 m) | 100 m |
| Haggenegg – Alpthal side        | not in forest (6 %); **in the Mythengebiet plant protection reserve**          | 47.040, 8.693 | 47.04061, 8.69324 (1,277 m) | 73 m  |
| Rigi north – above Küssnacht    | forest edge (48 % within 150 m); at 1,015 m, band 600–1,000 m                  | 47.060, 8.455 | 47.06015, 8.45424 (977 m)   | 63 m  |
| Rigi – above Arth-Goldau        | not in forest (0 %)                                                            | 47.045, 8.525 | 47.04763, 8.52534 (691 m)   | 291 m |

Not moved (already fine): Sattel – Hochstuckli, Morschach, Gersau.

**Second pass (2026-10-20):** pins now also stay out of every cantonal reserve, not only the no-picking ones.

| Spot                      | Why                                         | Old pin          | New pin                                                                           | Moved |
| ------------------------- | ------------------------------------------- | ---------------- | --------------------------------------------------------------------------------- | ----- |
| Ibergeregg – upper spruce | in the cantonal nature reserve "Ibergeregg" | 47.0154, 8.71962 | 47.01597, 8.71647 (1,233 m, 26w Ahorn-Eschenwald mit Buntreitgras, 77 % conifers) | 247 m |

**What the habitat build changed compared with the notes:** the site maps disagree with "acidic flysch" in several places. Ibergeregg – Alpthal (18M Karbonat-Tannen-Buchenwald), Hoch-Ybrig (18M), Unteriberg (60* Buntreitgras-Fichtenwald) and Wägital (18v Buntreitgras-Tannen-Buchenwald) are mapped as calcareous; Oberiberg, Sattel (46 Heidelbeer-Tannen-Fichtenwald) and Raten (19 Waldsimsen-Tannen-Buchenwald) as acidic. Acid-loving species (chanterelle, bay bolete) score lower on the calcareous ones than before. Ibergeregg – upper spruce was inside the cantonal nature reserve "Ibergeregg" and was moved out of it (second pass below).

## Forest grid (Milestone 4)

- **Cells:** 1 km LV95 squares in ZH or SZ (by centre) with ≥ 20 % tree cover. Each cell's habitat comes from `static/grid.json`: tree cover, conifer share, mean elevation/slope/aspect of its forested part, pH from the site-type majority of 5 sample points (geology fallback), and protection.
- **Weather:** one point per 3 × 3 km block, at the mean elevation of its forest cells. A cell uses its block's weather with temperatures (air and soil) shifted by −0.65 °C per 100 m above the point. `weatherDistanceKm` is ≤ ~2.1 km, below the 3 km confidence limit, so it does not lower confidence.
- **Scores:** the same engine and parameters as the spots (`scoreSpecies`), per species, for the 14 days and the 3 forecast days. Stored as one byte per cell per species (base64) in `grid/YYYY-MM-DD.json`; 255 = no score. The map shows the best of the favourites, or one species.
- **Protection** is flagged, never zeroed (SPEC §5.1): a cell is "no picking" if one of its sample points is in a no-picking area, "protected" if in another protected area.
- **Partial failure:** if a weather point fails, its cells keep the previous day's scores and are counted in `staleCells`.
- **Not stored for cells:** the six components. Since Milestone 5 the square detail recalculates them in the browser (same engine, weather point and elevation shift) for the "why this score" panel; if newer weather changes the score, the panel says so.

## Parameter changes after validation Part A (2026-10-20)

Approved by the owner after [VALIDATION.md, Part A](VALIDATION.md#part-a--occurrence-data-2026-10-20). Season dates apply at each species' reference elevation (1,000 m; morel 600 m) and move with elevation as before.

| #   | Species            | Change (before → after)                                                                                                                 | Evidence                                                                                                                                              | Confidence |
| --- | ------------------ | --------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| 1   | Parasol            | Season: peakStart 07-25 → **08-10**, peakEnd 10-05 → **10-25**, end 11-01 → **11-20**                                                   | 237 precise CH records: median date 2–4 weeks after the old peak midpoint at every elevation; only 68 % inside the old peak                           | Medium     |
| 2   | Parasol            | Tree-cover preference 20–60 % → **20–100 %** (1 km squares can't show forest edges)                                                     | Habitat test: records in denser squares, AUC 0.37 (forest part 0.31), n = 19 squares                                                                  | Low–medium |
| 3   | Morel              | Season: peakStart 03-25 → **04-08**, peakEnd 04-30 → **05-12**, end 05-31 → **06-10**; elevation shift +5 → **+3** days per 100 m       | 71 precise CH records (low-elevation median 20 Apr vs model 31 Mar; slope +2.5 days per 100 m) and 298 SwissFungi dates (peak mid-April to early May) | Medium     |
| 4   | Chanterelle        | Elevation shift halved: start −4 → **−2**, end −2 → **−1** days per 100 m                                                               | 66 precise CH records: no earlier fruiting higher up (slope +0.3)                                                                                     | Low–medium |
| 5   | Winter chanterelle | Season start 08-20 → **08-01**, full season (peakStart) 09-20 → **09-01**; elevation shift unchanged, so at 600 m about 17 Aug / 17 Sep | SwissFungi records from August; 12 % of CH records before the old start                                                                               | Low–medium |
| 6   | Bay bolete         | Conifer preference 50–100 % → **20–100 %**                                                                                              | Habitat test: record squares median 33 % conifers, host part AUC 0.35, n = 8                                                                          | Low        |

Not changed then: honey fungus (no signal in the weather test; changed after Part C, see below). The golden test still passes; the numbers below use these parameters.

## Parameter change after validation Part C (2026-10-20)

Approved by the owner after [VALIDATION.md, Part C](VALIDATION.md#part-c--variants-and-sanity-checks-2026-10-20).

| Species      | Change (before → after)                                            | Evidence                                                                                                                                                                                | Confidence |
| ------------ | ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| Honey fungus | Rain window 5–10 → **10–20 days** before; full rain 30 → **55 mm** | Weather on record dates minus placebo 0.55 → 0.70 (2021–24, n = 159); on the held-out years 2025–26 the record dates alone go from 0.37 to 0.56 (n = 80), after the placebo 0.31 → 0.44 | Medium     |

**About the 55 mm:** the protocol, written before the comparison, only had the window change (variant H1, 30 mm). The 55 mm form (H1b) was added afterwards, once the results were known: the longer window collects more rain, so H1 pushed honey fungus, already the highest-scoring species, even higher (mean mid-August to October at the spots in the poor year 2021: 63 → 72). 55 mm = 30 mm × 11/6 keeps the rain needed per day the same. H1b improves the weather match as much as H1 (0.695 vs 0.703) and keeps scores near the old level (2021: 68). Because it was chosen after seeing the results, its evidence is a little weaker than the protocol's.

Not changed after Part C: the moisture and temperature model (120-day soil range, wet-after-dry and the two temperature variants gave no clear improvement), and no cooling-trigger requirement for honey fungus. Honey fungus is not in the golden test; the golden numbers below are unchanged.

## Golden test (real data)

`pipeline/test/golden.test.ts` uses Open-Meteo weather recorded on 2026-10-20 (`npm run record:golden`) at the checked Ibergeregg – Alpthal pin (47.01929, 8.70945, 1,377 m). 21–26 Oct was still a forecast then. The weather: dry from late September, ~38 mm on 8 Oct and ~9 mm on 10 Oct.

**Habitat:** since Milestone 3 the test uses the spot's real habitat from the habitat build, not the old note "acidic flysch, spruce-fir". The site map says limestone fir-beech forest (18M Karbonat-Tannen-Buchenwald) with ~40 % conifers. Chanterelle (pH score 0.3 on limestone) and winter chanterelle (0.2) are acid-loving, so their habitat score H drops to 0.73 and 0.56.

| Ibergeregg – Alpthal (1,377 m, limestone)         | 10 Oct | 14 Oct | 17 Oct | 20 Oct | 22 Oct | 24 Oct | 26 Oct |
| ------------------------------------------------- | ------ | ------ | ------ | ------ | ------ | ------ | ------ |
| Chanterelle                                       | 22     | 32     | 50     | 40     | 37     | 19     | 10     |
| Winter chanterelle                                | 17     | 31     | 43     | 35     | 40     | 33     | 30     |
| Hedgehog (pH-tolerant)                            | 29     | 54     | 74     | 60     | 68     | 56     | 50     |
| _Weinland (grid cell, 356 m), winter chanterelle_ | 15     | 19     | 21     | 17     | 18     | 15     | 14     |

**Expectations, and what changed (Milestone 4 prep):**

- Chanterelle and winter chanterelle rise from **low (< 25) to medium (40–59)**, no longer to "good". The rain response is the same as before; limestone caps it. _Before:_ low → good (≥ 60), with the acidic hint.
- New check: **hedgehog**, which doesn't mind the soil, still goes from low to good (≥ 60) at the same spot. This shows the weather signal is intact.
- The delay check now applies to hedgehog too.
- Winter chanterelle outlasts chanterelle: on 26 Oct it's more than twice chanterelle's score, and chanterelle has fallen 30+ points from its peak.
- The "Weinland stays lower" check covers winter chanterelle and hedgehog, **not chanterelle**. Since Milestone 4, Weinland uses the habitat of its nearest forest grid cell (1.2 km away): a neutral ash forest (29(7) Zweiblatt-Eschenmischwald) at 356 m with 24 % conifers. Chanterelle peaks about equal at both (Weinland 48, Ibergeregg 50), because Ibergeregg's limestone holds it back about as much as Weinland's dryness. Winter chanterelle (peak 21 vs 44) and hedgehog (54 vs 75) stay clearly lower in the lowland.
- The spec's "rise between ~20 and 26 Oct" still comes earlier with the real weather (14–18 Oct; see Milestone 2).

## User pins (Milestone 5)

- Scored in the browser with `@mf/scoring` (same engine and parameters), weather fetched from Open-Meteo at the pin's coordinates and its swissALTI3D elevation (geo.admin `height` service). Same 61-day lookback as the daily job.
- Habitat: elevation is the pin's own; tree cover, conifer share, pH (site type/geology), slope and aspect come from the nearest forest grid cell if it is within 1.5 km; otherwise they are unknown, which lowers confidence. Protection: the reserve outlines at the pin itself.
- Pins must lie in ZH or SZ (geo.admin canton identify), so the canton rules apply.

## Find log (calibration data)

Each visit stores the score for that day at that place: published scores for spots and squares (`source: daily`; components for spots only on the current day, for squares from a live recalculation), live scores for pins (`source: live`), or nothing outside the 14 + 3-day window (`source: none`). CSV columns: `date, place_type, place_id, place_name, lat, lon, species_id, species, found, quantity_g, note, score_at_visit, score_source, S, M, T, F, D, H`. See docs/CALIBRATION.md.
