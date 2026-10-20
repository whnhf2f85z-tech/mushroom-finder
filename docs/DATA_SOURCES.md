# Data sources

Findings from checking each source. Status: ✅ verified and used · 🔜 to verify in a later milestone.

## Verified (Milestone 1, 2026-10-20)

| Source                | What                             | How                                                                                                                                                                                                                     | Notes                                                                                                                                                     |
| --------------------- | -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| swisstopo WMTS        | Base map (grey national map)     | `https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.pixelkarte-grau/default/current/3857/{z}/{x}/{y}.jpeg`                                                                                                                    | Free, attribution "© swisstopo". Web Mercator tiles work directly in Leaflet.                                                                             |
| swisstopo WMTS        | Canton borders overlay           | `.../ch.swisstopo.swissboundaries3d-kanton-flaeche.fill/default/current/3857/{z}/{x}/{y}.png`                                                                                                                           | Same terms.                                                                                                                                               |
| geo.admin.ch identify | Which canton a point is in       | `https://api3.geo.admin.ch/rest/services/api/MapServer/identify?geometryType=esriGeometryPoint&geometry=LON,LAT&sr=4326&layers=all:ch.swisstopo.swissboundaries3d-kanton-flaeche.fill&tolerance=0&returnGeometry=false` | Attribute `ak` = canton code. Used to check the seed spots: "Raten – Biberegg side" at 47.115, 8.660 is in **ZG**; moved to 47.115, 8.665 (SZ, ~1,005 m). |
| geo.admin.ch height   | Point elevation                  | `/rest/services/height`                                                                                                                                                                                                 | Accepts only LV95/LV03 (`sr=2056`/`21781`), not WGS84. Use Open-Meteo for WGS84 points, or convert.                                                       |
| Open-Meteo elevation  | Point elevation (WGS84, batched) | `https://api.open-meteo.com/v1/elevation?latitude=a,b&longitude=c,d`                                                                                                                                                    | Copernicus DEM 90 m. Several pins lie above/below their stated elevation band (pins mark areas).                                                          |
| Kanton Zürich         | Picking rules                    | [zh.ch – Pilze sicher geniessen (2025)](https://www.zh.ch/de/news-uebersicht/mitteilungen/2025/gesundheit/lebensmittel/pilze-sicher-geniessen.html)                                                                     | No picking 1st–10th of each month; max 1 kg per person per day. Group-picking rule and legal basis not stated there → open question.                      |
| Kanton Schwyz         | Picking rules                    | [sz.ch – Pilz- und Beerensammeln](https://www.sz.ch/umweltdepartement/amt-fuer-wald-und-natur/natur-und-landschaft/artenschutz/pilz-und-beerensammeln.html/8756-8758-8802-9447-9454-9459-10665-10668)                   | 2 kg/person/day, morels 1 kg; no closed days since 2010; organised events banned; list of no-picking reserves (stored in `data/rules.json`).              |

## Weather (Milestone 2, verified 2026-10-20)

| What                                   | Endpoint                                                                                  | Notes                                                                                                                                                                                                                                                                        |
| -------------------------------------- | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Recent past + forecast                 | `https://api.open-meteo.com/v1/forecast` with `past_days=2&forecast_days=4`               | Used for the last 2 days, today and 3 forecast days. Asking for `past_days=92` returns only ~67 days of real values (the rest is `null`), so it can't cover the 60-day lookback plus 14 history days.                                                                        |
| Older past (backfill, 60-day lookback) | `https://historical-forecast-api.open-meteo.com/v1/forecast` with `start_date`/`end_date` | Same models as the forecast API, complete daily and hourly data (incl. soil) up to today. Chosen over the ERA5 archive (`archive-api.open-meteo.com/v1/archive`) so past and recent days come from the same model chain. The archive also had data up to today when checked. |
| Requests                               | `POST`, form-encoded, comma-separated `latitude`, `longitude`, `elevation`                | Multiple locations per request work (14 and 100 tested). ~1,000 locations × 96 days in one request hit the per-minute limit (HTTP 429). The pipeline uses batches of 50.                                                                                                     |
| Elevation                              | `elevation=` per location                                                                 | Open-Meteo downscales temperature to this elevation. Spots use the middle of their elevation band.                                                                                                                                                                           |
| Time zone                              | `timezone=Europe/Zurich`                                                                  | Daily values and hourly timestamps are local days.                                                                                                                                                                                                                           |

**Model: `best_match`.** Open-Meteo exposes MeteoSwiss ICON-CH (`meteoswiss_icon_ch1`, 33 h forecast; `meteoswiss_icon_ch2`, 5 days), but **neither returns soil moisture or soil temperature**, which the moisture score and the morel temperature need. `best_match` returns all variables. Its rain is close to `icon_seamless`/`icon_d2`. It can differ a lot from ICON-CH2: on 8 Oct 2026 at Ibergeregg, 36 mm (best_match) vs 17 mm (ICON-CH2). See the station check below: best_match is the closer one.

**Variables**

- Daily: `precipitation_sum`, `temperature_2m_min`, `temperature_2m_max`, `temperature_2m_mean`, `relative_humidity_2m_mean`, `et0_fao_evapotranspiration`.
- Hourly → daily mean (needs ≥ 20 of 24 hours): `soil_moisture_0_to_7cm`, `soil_moisture_7_to_28cm`, `soil_temperature_0_to_7cm`. These names work with `best_match`. The ICON layer names (`soil_moisture_9_to_27cm`, `soil_temperature_6cm`) also exist but aren't used.

**Limits (free, non-commercial):** 600 calls/min, 5,000/hour, 10,000/day, 300,000/month ([open-meteo.com/en/pricing](https://open-meteo.com/en/pricing)). Calls are weighted: ×(variables / 10) and ×(days / 14) per location. The daily run for 14 spots ≈ **87 weighted calls**, ~15–25 s. The pipeline logs the estimate on every run. The API answered "503 service overloaded" twice on 2026-10-20; the retries handled it.

**Licence:** Open-Meteo data is CC BY 4.0. Attribution is on the map and in the About section.

## Weather model check against MeteoSwiss stations (2026-10-20)

**Source:** MeteoSwiss open data (OGD) on `data.geo.admin.ch`, free with attribution "Source: MeteoSwiss". STAC collections:

- `ch.meteoschweiz.ogd-smn`: automatic weather stations
- `ch.meteoschweiz.ogd-smn-precip`: automatic rain gauges
- `ch.meteoschweiz.ogd-nime`: manual daily rain gauges

Files: `https://data.geo.admin.ch/ch.meteoschweiz.<collection>/<abbr>/<collection>_<abbr>_{h,d}_recent.csv` (`;`-separated, Latin-1, timestamps in UTC). Station lists with coordinates: `<collection>_meta_stations.csv`. Parameters: `rre150h0` hourly rain, `rre150d0` daily rain (06–06 UTC), `tre200h0` hourly temperature. Hourly files of the manual network return HTTP 403 (they only have daily values).

**Method:** for 1–19 Oct 2026, hourly station rain was summed per local (CEST) day, the same day boundary as Open-Meteo. The manual gauges use their daily 06–06 UTC values, so single days can be shifted, but the period totals are comparable. Open-Meteo was queried at each station's coordinates and height (historical forecast API, daily `precipitation_sum`, `temperature_2m_mean`).

| Station (network, distance)                        | Measured | best_match | ICON-CH1 | ICON-CH2 | 8 Oct measured / best / CH1 / CH2 |
| -------------------------------------------------- | -------- | ---------- | -------- | -------- | --------------------------------- |
| Oberiberg OBI (gauge, 5.6 km from Ibergeregg)      | 51.1 mm  | 52.2       | 41.1     | 37.3     | 21.9 / 33.0 / 23.0 / 20.5         |
| Einsiedeln EIN (station)                           | 52.7 mm  | 55.8       | 29.1     | 41.0     | 25.5 / 29.1 / 12.6 / 12.2         |
| Alpthal APT (manual, 4.3 km)                       | 69.3 mm  | 72.3       | 38.9     | 36.4     | 41.5 / 40.4 / 23.2 / 12.4         |
| Rossberg ROG (gauge, 3.6 km from Arth-Goldau spot) | 89.0 mm  | 78.2       | 46.8     | 54.0     | 50.2 / 49.7 / 24.5 / 19.3         |
| Gersau GES (station)                               | 64.0 mm  | 58.6       | 38.5     | 22.7     | 36.7 / 40.2 / 20.4 / 11.9         |
| Küssnacht KAR (manual)                             | 54.0 mm  | 54.7       | 36.6     | 45.1     | 31.4 / 40.4 / 17.3 / 20.2         |

Mean absolute daily error (mm/day): best_match is lowest at 5 of 6 stations (0.85–1.83). ICON-CH2 is lowest only at Oberiberg (0.79 vs 1.83).

Temperature, daily mean (EIN, GES): ICON-CH1 has the smallest error (0.22–0.33 °C), ICON-CH2 0.46–0.49 °C, best_match 0.59–0.61 °C (about +0.6 °C warm).

**Decision: keep `best_match` for all variables.** ICON-CH is not clearly closer:

- It misses a third to two thirds of the rain in this period, including the 8 Oct storm the scores depend on.
- Its temperature advantage (~0.3 °C) is small next to the species' temperature bands (tails of 4–6 °C).
- ICON-CH1 only forecasts 33 h ahead.

Caveat: this is 19 days at 6 stations. Repeat the check after a few more rain events.

## To verify (later milestones)

- 🔜 BAFU forest mix `ch.bafu.landesforstinventar-waldmischungsgrad`, forest mask, swissALTI3D (M3–M4).
- 🔜 ZH Waldvegetationskarte WMS/WFS, SZ forest site layer on `wfs.geo.sz.ch`, GeoCover geology (M3).
- 🔜 Protected-area layers: federal moor inventories, SZ and ZH nature reserves (M4).
