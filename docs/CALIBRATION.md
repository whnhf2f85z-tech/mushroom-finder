# Calibration

Planned for after Milestone 5 (find log). Each logged visit stores the score and components at the time of the visit. Once there are enough visits, compare found / not found with the scores per species and adjust `data/species.json` and `config.ts`.

## Data (since Milestone 5)

The find log (stored on each device) exports a CSV with one row per visit: where, when, which species, found or not, the score that day and, when available, its six components (S, M, T, F, D, H). To calibrate, collect the CSV exports from everyone, then compare found / not found against the score per species: e.g. the share of "found" per score band, and which component is low on visits that found nothing despite a high score.
