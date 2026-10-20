# Validation

Validation of the scoring model against existing data, before calibration with our own find log. Scripts: `validation/` (see `validation/README.md`). Proposed changes are listed per part and are only applied after approval. Changes 1–6 of Part A were approved and applied on 2026-10-20 (details in [SCORING.md](SCORING.md)); Part B uses the updated parameters.

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

**Observer bias:** people go out (and post photos) when the weather is pleasant, at weekends, and often _because_ it rained a week before. Weekday matching handles the weekend effect. For the rest, a **placebo** is scored the same way: three bracket fungi that sit on trees all year (tinder fungus _Fomes fomentarius_, red-belted conk _Fomitopsis pinicola_, artist's conk _Ganoderma applanatum_; up to 300 CH-precise records since 2021, March–November), so their record dates only reflect when observers are out. Each species is compared with the placebo records from its own months (morel: spring). Weather: Open-Meteo historical forecast (best match), 648 place-year windows, 5,890 weighted API calls.

![Weather part of the score on record dates vs control dates](validation/weather-case-control.png)

| Species            | Records | Percentile of W on record dates (95 % CI) | Placebo (bracket fungi, same months) | Difference |
| ------------------ | ------- | ----------------------------------------- | ------------------------------------ | ---------- |
| Chanterelle        | 57      | 0.59 (0.51–0.68)                          | 0.52 (0.47–0.56), n = 168            | +0.07      |
| Porcini            | 113     | 0.67 (0.61–0.72)                          | 0.51 (0.47–0.56), n = 168            | +0.16      |
| Winter chanterelle | 47      | 0.64 (0.56–0.72)                          | 0.52 (0.48–0.56), n = 168            | +0.12      |
| Horn of plenty     | 45      | 0.57 (0.47–0.66)                          | 0.53 (0.49–0.57), n = 168            | +0.04      |
| Bay bolete         | 62      | 0.61 (0.53–0.66)                          | 0.53 (0.50–0.58), n = 168            | +0.07      |
| Hedgehog           | 24      | 0.58 (0.47–0.68)                          | 0.53 (0.49–0.57), n = 168            | +0.05      |
| Honey fungus       | 239     | 0.50 (0.45–0.55)                          | 0.53 (0.50–0.58), n = 168            | −0.03      |
| Parasol            | 194     | 0.69 (0.66–0.73)                          | 0.51 (0.47–0.56), n = 168            | +0.17      |
| Morel              | 46      | 0.62 (0.52–0.71)                          | 0.60 (0.54–0.65), n = 95             | +0.02      |

_Placebo updated on 2026-10-20 with three bracket fungi instead of tinder fungus alone (n ≈ 23). The first, small placebo had suggested ~0.6 for all species._

- **Matches:** for porcini, parasol, winter chanterelle, bay bolete and chanterelle, record dates have clearly better weather scores than the control dates (CI above 0.5). For porcini and parasol it's mostly the moisture part (M percentile 0.66–0.67).
- **Observer bias is small in summer and autumn:** the larger placebo scores only 0.51–0.53, so most of the signal above is real. **Parasol (+0.17), porcini (+0.16) and winter chanterelle (+0.12)** clearly beat it; chanterelle and bay bolete (+0.07) somewhat; horn of plenty and hedgehog (+0.04–0.05) barely, with small samples.
- **Doesn't match:** **honey fungus** has no signal at all (0.50, n = 239, the largest sample), slightly below the placebo. Its weather response in the model (rain 5–10 days before, 6–15 °C) doesn't describe when it's recorded. **Morel** (0.62) is no better than the spring placebo (0.60): people go out on nice spring days, and that explains the morel signal.
- **Limits:** record dates are when someone _reported_ a mushroom, not when it fruited; a record says nothing about the days without one; Open-Meteo's weather at 3 km is not the forest floor. This test can show whether the model's weather response points the right way, not how strong it should be.

### Proposed parameter changes (1–6 approved and applied on 2026-10-20, 4 and 5 in a milder form; see SCORING.md)

| #   | Species            | Change                                                                                                                           | Evidence                                    | Confidence |
| --- | ------------------ | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- | ---------- |
| 1   | Parasol            | Season later: peakStart 07-25 → 08-10, peakEnd 10-05 → 10-25, end 11-01 → 11-20                                                  | Season test, 237 records, peak share 68 %   | Medium     |
| 2   | Parasol            | Tree-cover preference 20–60 % → 20–100 % (or weight 0.35 → 0.15): edges can't be seen at 1 km                                    | Habitat AUC 0.37, forest part 0.31 (n = 19) | Low–medium |
| 3   | Morel              | Season ~2 weeks later: peakStart 03-25 → 04-08, peakEnd 04-30 → 05-12, end 05-31 → 06-10; elevation shift +5 → +3 days per 100 m | Season test + SwissFungi (298 records)      | Medium     |
| 4   | Chanterelle        | Elevation shift start −4 → −1, end −2 → 0                                                                                        | Season test, 66 records, slope +0.3         | Low–medium |
| 5   | Winter chanterelle | Season start 08-20 → 08-01; elevation start shift −4 → −2                                                                        | SwissFungi shows records from August        | Low–medium |
| 6   | Bay bolete         | Conifer preference 50–100 % → 20–100 %                                                                                           | Habitat host part AUC 0.35 (n = 8)          | Low        |
| 7   | Honey fungus       | No change yet: look at it in Part B (longer rain lag, e.g. 10–20 days, or the cooling trigger)                                   | Weather test: no signal                     | –          |

**Data improvements:** request precise SwissFungi records from WSL (the larger placebo group is now in place).

## Part B – Past seasons (2026-10-20)

### Method

The app's engine with the current parameters recomputed every day from 1 June to 15 November for 2021–2025, and 2026 up to 18 October: the 14 spots and a fixed sample of 30 forest squares (15 ZH, 15 SZ, chosen at random with a fixed seed). Weather: Open-Meteo historical forecast (best match), 4,230 weighted calls, run on GitHub Actions (workflow "Validation (manual)"). The curve shown is the weekly mean of the map score (best of the default favourites).

This was compared with two independent sources:

1. **Documented good and poor periods** from news reports and mushroom-control statistics (table below). They describe Switzerland or the region as a whole and give dates only to within a week or two.
2. **Pilz-Ticker Schweiz** ([passion-pilze-sammeln.com](https://www.passion-pilze-sammeln.com/pilztickerarchiv_schweiz.html)): readers' dated reports, mostly from eastern and central Switzerland. `validation/fetch-ticker.ts` reads the 60 archive pages (robots.txt allows it, 1 s between pages) and keeps only the date of each report and whether it says "nothing / too dry" (keyword match, rough). 210 reports for 2021–2026, 26–43 per year.

### Documented periods

| Year | What was reported                                                                                                                                               | Sources                                                                                                                                                                                                                                                                                                                                                                                                               |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2021 | Strong flush late June – early July, then hardly anything until the end of September: a poor year                                                               | [Aargauer Zeitung, 13 Jan 2022](https://www.aargauerzeitung.ch/aargau/wyna-suhre/aargau-west-von-drogenpilzli-und-falschen-champignons-so-war-die-pilz-saison-2021-ld.2237720)                                                                                                                                                                                                                                        |
| 2022 | Hot, dry summer; boom from early September; record year (VAPKO: 27,812 controls, 39,354 kg; Zürich: 8,600 control slips)                                        | [SRF, 17 Sep 2022](https://www.srf.ch/news/schweiz/pilzboom-in-der-schweiz-wetterumschwung-laesst-pilze-nun-doch-spriessen), [watson](https://www.watson.ch/schweiz/daten/819199035-pilzsaison-schweiz-so-viele-toedlich-giftige-pilze-wurden-2022-gesammelt)                                                                                                                                                         |
| 2023 | Good porcini in July, hot and dry August, weak year overall (Zürich: ~3,600 control slips, less than half of 2022)                                              | [Kanton Zürich](https://www.zh.ch/de/news-uebersicht/mitteilungen/2024/gesundheit/lebensmittel/pilzkontrollen-im-kanton-zuerich-2023.html), [Tierwelt](https://www.tierwelt.ch/artikel/natur-umwelt/fazit-der-pilzsaison-dieses-jahr-war-ein-schlechtes-pilzjahr-496077)                                                                                                                                              |
| 2024 | Wet summer but a weak late summer; boom in October; productive year                                                                                             | [Dorfblitz](https://dorfblitz.ch/pilzjahr-2024/), [OnlineReports](https://onlinereports.ch/a/pilzsaison-2024-ein-drittel-des-sammelguts-war-giftig-23199)                                                                                                                                                                                                                                                             |
| 2025 | Schwyz region: good start, then it stopped (10 Sep 2025). Local controls mixed: Küsnacht ZH below average, Spreitenbach AG busy until November. Dates uncertain | [Bote der Urschweiz, 10 Sep 2025](https://www.bote.ch/nachrichten/schwyz/guter-start-in-die-pilzsaison-dann-war-schluss-art-1619861), [nau.ch Spreitenbach](https://www.nau.ch/ort/dietikon/pilzsaison-2025-mit-rekordzahlen-bei-kontrollen-67082355), [Pilze unter der Lupe (Küsnacht)](https://goldkueste24.ch/articles/357038-pilze-unter-der-lupe)                                                                |
| 2026 | Drought: summer season practically failed, Zürich forests empty in August; Pilz-Ticker reports a big flush around 6 September; rain again ~8–10 October         | [SRF, 6 Aug 2026](https://www.srf.ch/radio-srf-1/rare-eierschwaemmchen-hitze-bremst-pilzsaison-aus-es-ist-ganz-schitter), [20 Minuten, 14 Aug 2026](https://www.20min.ch/story/pilze-in-der-schweiz-trockenheit-laesst-waelder-fast-leer-zurueck-103615448), [Limmattaler Zeitung, 13 Aug 2026](https://www.limmattalerzeitung.ch/limmattal/zuerich/pilze-im-kanton-zuerich-trockenheit-bremst-die-saison-ld.4216559) |

No official per-season control statistics for Schwyz, or for Zürich after 2023, were found online.

![Weekly model score per year vs documented periods and Pilz-Ticker reports](validation/past-seasons.png)

![Model season strength per year](validation/past-seasons-summary.png)

### Results

- **Matches – dry spells:** the model reacts well to drought. 2022: low in late July and mid-August (23–32), then 83–94 from the start of September through mid-October, exactly the documented boom. 2026: 16–25 for most of August, 86 in the week of the 6 September flush, a drop in early October and a rise again after the rain of 8–10 October. 2023: the drop in late August (39) matches the hot, dry end of August.
- **Matches – year ranking (partly):** the model's season strength (mean score 15 Aug – 31 Oct at the spots) puts **2023 (63) and 2026 (57)** clearly lowest, as documented, and **2024 (83)** highest. The October 2024 boom is the model's highest stretch (93–95).
- **Matches – Pilz-Ticker:** weeks with a positive ticker report have a higher model score (mean 67, 83 weeks) than weeks without (62, 53 weeks) and weeks with only "nothing / too dry" reports (51, 9 weeks). The direction is right, but the ticker has only 1–6 reports per week, so it can't say how good a week was.
- **Doesn't match – wet summers:** the model is too optimistic when it rains regularly. **2021** (very wet summer) scores 80–89 from late July to September, when hardly anything was found; it ranks 2021 (77) level with the record year 2022 (78). Late summer **2024** (68–79, documented weak) and the September 2025 pause (78–94) show the same pattern. When it rains every week, the moisture part stays near its maximum and nothing pulls the score down.
- **Doesn't match – early August 2023:** documented hot and dry, the model is still at 85–89 because July was wet; it falls only in the last third of the month.
- **Honey fungus:** the ticker doesn't name species, so Part B can't test it on its own. Note only that the model gives it the highest late-season means of all species (52–73) with little difference between years, which fits the missing weather signal of Part A.
- **Spots vs squares:** the random squares follow the spots week by week, 0–20 points lower (spots were chosen for good habitat), so what is said above holds for the whole grid.
- **Limits:** documented periods are national or regional and roughly dated; good years also mean more people out picking; the ticker is small and mostly from eastern Switzerland; 2025 dates are uncertain.

### Proposed parameter changes (not applied)

| #   | Species      | Change                                                                                                                                                                                                                                   | Evidence                                                                        | Confidence |
| --- | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ---------- |
| 1   | All          | Make the moisture part less generous in long wet spells: measure soil moisture against a longer window (soilRangeDays 60 → 120, so a wet summer is no longer "the wettest in 60 days" every week) To be tested in Part C before deciding | 2021, late summer 2024 and Sep 2025 overrated; 2021 ranked like the record 2022 | Low–medium |
| 2   | All          | Optional, more experimental: a "recovery" term, i.e. a flush needs a wet spell after a drier one; continuous rain gives less than rain after a dry week                                                                                  | Same three periods, plus the strong booms after drought in 2022 and 2026        | Low        |
| 3   | Honey fungus | Test in Part C: rain lag 10–20 days instead of 5–10, and the cooling trigger as a requirement (it fruits after the first cold nights in autumn)                                                                                          | Part A: no weather signal; Part B: high every year                              | Low        |
| 4   | –            | No change to the drought response (D factor, rain cap): dry spells are reproduced well                                                                                                                                                   | 2022, 2023, 2026                                                                | Medium     |

Scripts: `validation/past-seasons.ts` (via the manual workflow, ~4,200 Open-Meteo calls), `validation/fetch-ticker.ts`, charts in `validation/plots.py`.
