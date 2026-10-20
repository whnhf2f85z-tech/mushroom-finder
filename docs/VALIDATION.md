# Validation

Validation of the scoring model against existing data, before calibration with our own find log. Scripts: `validation/` (see `validation/README.md`). No model parameters were changed; proposed changes are listed per part and need approval.

## Part A – Occurrence data (2026-10-20)

### Data

Source: [GBIF](https://www.gbif.org) occurrence search API, the 9 species (Armillaria and Morchella as genera), queried on 2026-10-20.

| Dataset                                    | Licence        | Used for                                                                      |
| ------------------------------------------ | -------------- | ----------------------------------------------------------------------------- |
| Swiss National Fungi Databank (SwissFungi) | CC BY 4.0      | Season shape, coarse habitat check (positions generalised to 5 km, see below) |
| iNaturalist research-grade observations    | CC BY-NC 4.0   | All tests (most precise records)                                              |
| Observation.org                            | CC BY-NC 4.0   | All tests                                                                     |
| NABU naturgucker, and 2 small datasets     | CC BY 4.0, CC0 | All tests                                                                     |
| Global Spore Sampling Project              | CC BY 4.0      | **Excluded:** airborne fungal DNA, not fruiting bodies                        |

The non-commercial (NC) licences are fine for this non-commercial project. For a publication, a GBIF download with a DOI should be created and cited.

**Filters** (ZH + SZ, canton polygons from swissBOUNDARIES3D): present, valid coordinates, a single-day date, location accuracy ≤ 1 km, and duplicates removed (same species, same day, within ~100 m).

| Species            | In the ZH + SZ box | Outside ZH/SZ | No day date | Accuracy > 1 km | Duplicates / not fruiting body | **Kept (strict)** | of which accuracy unknown |
| ------------------ | ------------------ | ------------- | ----------- | --------------- | ------------------------------ | ----------------- | ------------------------- |
| Chanterelle        | 338                | 70            | 0           | 267             | 0                              | **1**             | 1                         |
| Porcini            | 420                | 98            | 0           | 318             | 0                              | **4**             | 2                         |
| Winter chanterelle | 287                | 72            | 0           | 206             | 0                              | **9**             | 7                         |
| Horn of plenty     | 290                | 37            | 1           | 246             | 1                              | **5**             | 3                         |
| Bay bolete         | 597                | 143           | 0           | 443             | 0                              | **11**            | 5                         |
| Hedgehog           | 476                | 103           | 0           | 368             | 0                              | **5**             | 3                         |
| Honey fungus       | 303                | 78            | 0           | 149             | 26                             | **50**            | 17                        |
| Parasol            | 271                | 97            | 0           | 153             | 1                              | **20**            | 4                         |
| Morel              | 370                | 62            | 0           | 298             | 0                              | **10**            | 2                         |

**The main limitation:** almost all records are SwissFungi, and SwissFungi publishes on GBIF "generalized to 5 km grid squares" (accuracy 3,535 m = half the diagonal). Its note says the elevation is the raw value, but the elevation field is empty in all 3,143 records. Only **115 precise records** remain in ZH + SZ, mostly iNaturalist. Precise SwissFungi data can be requested from WSL under a data agreement; that would make this validation much stronger.

So that the tests have some power, two supplements are used, always labelled:

- **CH, precise:** records from all of Switzerland with known accuracy ≤ 1 km (979, 836 since 2021), elevation from swissALTI3D. Used for the season and weather tests, which don't need our grid.
- **SwissFungi 5 km:** 2,428 records in ZH + SZ with exact dates but 5 km positions. Used for the season shape (all elevations pooled) and a coarse habitat check.

### Habitat test

For each species, the habitat score H (with drought factor 1) of the forest squares containing a record is compared with all forest squares (AUC: probability that a record square scores higher than a random forest square; 0.5 = no signal) and with a "target group" background: squares with a record of any of the 9 species, which partly corrects for where observers go.

![Habitat score of squares with records vs all forest squares](validation/habitat-auc.png)

| Species            | Squares with records | AUC vs all forest squares (95 % CI) | AUC vs target group | SwissFungi 5 km: squares, AUC |
| ------------------ | -------------------- | ----------------------------------- | ------------------- | ----------------------------- |
| Chanterelle        | 0                    | –                                   | –                   | 41, 0.61                      |
| Porcini            | 4                    | 0.53 (0.24–0.82)                    | 0.50                | 54, 0.50                      |
| Winter chanterelle | 6                    | 0.59 (0.34–0.78)                    | 0.62                | 40, 0.62                      |
| Horn of plenty     | 4                    | 0.85 (0.65–0.98)                    | 0.79                | 40, 0.58                      |
| Bay bolete         | 8                    | 0.41 (0.23–0.64)                    | 0.45                | 53, 0.57                      |
| Hedgehog           | 2                    | 0.65                                | 0.53                | 58, 0.50                      |
| Honey fungus       | 32                   | 0.52                                | 0.51                | 40, 0.53                      |
| Parasol            | 19                   | 0.37 (0.25–0.50)                    | 0.43                | 45, 0.50                      |
| Morel              | 5                    | 0.57 (0.43–0.71)                    | 0.47                | 48, 0.56                      |

- **Matches:** horn of plenty (beech, calcareous) scores higher where it was found (0.85, n = 4); winter chanterelle and chanterelle point the right way on the 5 km squares (0.62, 0.61).
- **Doesn't match:** parasol (0.37) – its records are in squares with _more_ tree cover than the model's 20–60 % preference (the forest-cover part alone: AUC 0.31). Bay bolete (0.41) – record squares have a median of 33 % conifers, the model wants 50–100 % (host part: AUC 0.35).
- **Not testable:** honey fungus (the model gives almost every square the same H, by design). Most other species have too few precise records for a conclusion: the confidence intervals include 0.5.
- On 5 km squares H is averaged over 25 squares, which washes out differences; AUCs near 0.5 there are expected and say little.

### Season test

Record dates against the model's season (start–end) and peak, by elevation. Strict ZH + SZ records: 82–100 % fall inside the season, but n = 1–50. The tables and charts use the CH-precise supplement.

![Record dates by elevation vs the model's season](validation/season-by-elevation.png)

| Species            | Records (CH, precise) | In model season | In model peak | Elevation shift: records vs model (days per 100 m) |
| ------------------ | --------------------- | --------------- | ------------- | -------------------------------------------------- |
| Chanterelle        | 66                    | 98 %            | 91 %          | +0.3 vs start −4 / end −2                          |
| Porcini            | 140                   | 99 %            | 79 %          | −2.3 vs start −4 / end −2                          |
| Winter chanterelle | 49                    | 88 %            | 78 %          | −3.2 vs start −4 / end −2                          |
| Horn of plenty     | 47                    | 94 %            | 83 %          | −6.3 vs start −4 / end −2                          |
| Bay bolete         | 69                    | 96 %            | 80 %          | −2.1 vs start −4 / end −2                          |
| Hedgehog           | 25                    | 100 %           | 84 %          | −2.4 vs start −4 / end −2                          |
| Honey fungus       | 276                   | 99 %            | 89 %          | −3.4 vs start −4 / end −2                          |
| Parasol            | 237                   | 96 %            | 68 %          | −2.3 vs start −4 / end −2                          |
| Morel              | 71                    | 97 %            | 70 %          | +2.5 vs start +5 / end +5                          |

![SwissFungi records by week vs the model season at 600 and 1,200 m](validation/season-swissfungi.png)

- **Matches:** almost all records fall inside the model's season; porcini, bay bolete, hedgehog and honey fungus follow the model's peak and its "earlier higher up" shift (about −2 to −3.5 days per 100 m, between the model's start and end shifts).
- **Doesn't match:**
  - **Parasol** peaks later than the model: records run from mid-August to the end of October at all elevations (median date 2–4 weeks after the model's peak midpoint); only 68 % fall in the peak.
  - **Morel:** at low elevations the records peak in mid-April to early May, the model's peak is late March to late April (about 2–3 weeks early). The elevation shift in the records (+2.5 days per 100 m) is about half the model's +5.
  - **Chanterelle:** no earlier fruiting higher up in the records (+0.3 vs −4/−2). SwissFungi also shows an early wave in June–July.
  - **Winter chanterelle:** SwissFungi records start in August; in the lowlands the model's season only starts in early September (12 % of CH records fall before it).
- **Limits:** observers are out more in September–October and at weekends, which shapes the date distribution; the elevation slopes are less affected. Seasons are wide, so "in season" is a lenient test; the peak and the slopes are the informative parts.

### Weather test (case-control)

For each CH-precise record since 2021 (836): the weather part of the score, W = M<sup>0.6</sup> × T<sup>0.4</sup> × F × D (no season, no habitat), on the record date vs. control dates at the same place (3 km weather block, the record's elevation), ±30 days in the same year, excluding ±5 days around the record, and only on the same kind of day (weekend vs weekday). Result per record: the percentile of the record date among its controls; 0.5 = no signal.

**Observer bias:** people go out (and post photos) when the weather is pleasant, at weekends, and often _because_ it rained a week before. Weekday matching handles the weekend effect. For the rest, a **placebo** is scored the same way: tinder fungus (_Fomes fomentarius_), which sits on trees all year, so its record dates only reflect when observers are out. Weather: Open-Meteo historical forecast (best match), 648 place-year windows, 5,890 weighted API calls.

![Weather part of the score on record dates vs control dates](validation/weather-case-control.png)

| Species            | Records | Percentile of W on record dates (95 % CI) | Placebo (tinder fungus, n ≈ 23) | Difference |
| ------------------ | ------- | ----------------------------------------- | ------------------------------- | ---------- |
| Chanterelle        | 57      | 0.59 (0.51–0.68)                          | 0.61 (0.49–0.74)                | −0.02      |
| Porcini            | 113     | 0.67 (0.61–0.72)                          | 0.61 (0.51–0.72)                | +0.06      |
| Winter chanterelle | 47      | 0.64 (0.55–0.72)                          | 0.53 (0.42–0.64)                | +0.12      |
| Horn of plenty     | 45      | 0.57 (0.47–0.66)                          | 0.59 (0.46–0.72)                | −0.02      |
| Bay bolete         | 62      | 0.61 (0.53–0.66)                          | 0.58 (0.47–0.71)                | +0.02      |
| Hedgehog           | 24      | 0.58 (0.47–0.68)                          | 0.59 (0.48–0.72)                | −0.01      |
| Honey fungus       | 239     | 0.50 (0.45–0.55)                          | 0.63 (0.53–0.74)                | −0.13      |
| Parasol            | 194     | 0.69 (0.66–0.73)                          | 0.61 (0.50–0.73)                | +0.07      |
| Morel              | 46      | 0.62 (0.52–0.71)                          | 0.54 (0.44–0.64)                | +0.07      |

- **Matches:** for porcini, parasol, winter chanterelle, morel, bay bolete and chanterelle, record dates have clearly better weather scores than the control dates (CI above 0.5). For porcini and parasol it's mostly the moisture part (M percentile 0.66–0.67).
- **But:** the placebo also scores ~0.6, so a good part of that signal is observer behaviour. After subtracting it, only **winter chanterelle (+0.12), parasol (+0.07), morel (+0.07) and porcini (+0.06)** keep a positive difference, and the placebo is so small (23 records) that none of these differences is statistically solid.
- **Doesn't match:** **honey fungus** has no signal at all (0.50, n = 239, the largest sample), even below the placebo. Its weather response in the model (rain 5–10 days before, 6–15 °C) doesn't describe when it's recorded.
- **Limits:** record dates are when someone _reported_ a mushroom, not when it fruited; a record says nothing about the days without one; Open-Meteo's weather at 3 km is not the forest floor; and the placebo is small. This test can show whether the model's weather response points the right way, not how strong it should be.

### Proposed parameter changes (not applied)

| #   | Species            | Change                                                                                                                           | Evidence                                    | Confidence |
| --- | ------------------ | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- | ---------- |
| 1   | Parasol            | Season later: peakStart 07-25 → 08-10, peakEnd 10-05 → 10-25, end 11-01 → 11-20                                                  | Season test, 237 records, peak share 68 %   | Medium     |
| 2   | Parasol            | Tree-cover preference 20–60 % → 20–100 % (or weight 0.35 → 0.15): edges can't be seen at 1 km                                    | Habitat AUC 0.37, forest part 0.31 (n = 19) | Low–medium |
| 3   | Morel              | Season ~2 weeks later: peakStart 03-25 → 04-08, peakEnd 04-30 → 05-12, end 05-31 → 06-10; elevation shift +5 → +3 days per 100 m | Season test + SwissFungi (298 records)      | Medium     |
| 4   | Chanterelle        | Elevation shift start −4 → −1, end −2 → 0                                                                                        | Season test, 66 records, slope +0.3         | Low–medium |
| 5   | Winter chanterelle | Season start 08-20 → 08-01; elevation start shift −4 → −2                                                                        | SwissFungi shows records from August        | Low–medium |
| 6   | Bay bolete         | Conifer preference 50–100 % → 20–100 %                                                                                           | Habitat host part AUC 0.35 (n = 8)          | Low        |
| 7   | Honey fungus       | No change yet: look at it in Part B (longer rain lag, e.g. 10–20 days, or the cooling trigger)                                   | Weather test: no signal                     | –          |

**Data improvements:** request precise SwissFungi records from WSL; use a larger placebo group (e.g. add _Fomitopsis pinicola_ and _Ganoderma applanatum_, also perennial) to measure observer bias better.
