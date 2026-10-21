# Calibration

Planned for after Milestone 5 (find log). Each logged visit stores the score and components at the time of the visit. Once there are enough visits, compare found / not found with the scores per species and adjust `data/species.json` and `config.ts`.

## Data (since Milestone 5)

The find log (stored on each device) exports a CSV with one row per visit: where, when, which species, found or not, the score that day and, when available, its six components (S, M, T, F, D, H). To calibrate, collect the CSV exports from everyone, then compare found / not found against the score per species: e.g. the share of "found" per score band, and which component is low on visits that found nothing despite a high score.

## Candidates to test once find logs exist

- **Valley frost correction** (from [VALIDATION.md, Part D](VALIDATION.md#part-d--weather-stations-and-official-layers-2026-10-21)): Open-Meteo's night minimums are ~0.7 °C too warm overall and up to +2.5 °C at valley and lakeshore stations, so the frost factor F misses some frost nights there (5 measured vs 2 modelled at 13 stations from September). Candidate: lower tmin by ~1.5 °C for squares in valley bottoms or near lakes before computing F. Test it with autumn visits: do "not found" visits after cold nights cluster in valley squares? Not applied (decided 2026-10-21): the evidence is 13 stations and 5 frost nights.
