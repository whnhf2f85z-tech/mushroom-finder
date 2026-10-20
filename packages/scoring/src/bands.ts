export interface ScoreBand {
  min: number;
  max: number;
  label: string;
  /** Fill colour. */
  color: string;
  /** Text colour with enough contrast on `color`. */
  text: string;
}

/**
 * Colour bands from SPEC §5.2. Red→green as specified; because red/green alone is not colour-blind safe,
 * the bands also differ in lightness and the UI always shows the number and the label.
 */
export const SCORE_BANDS: ScoreBand[] = [
  { min: 0, max: 19, label: 'Very low', color: '#b2182b', text: '#ffffff' },
  { min: 20, max: 39, label: 'Low', color: '#ef8a62', text: '#1a1a1a' },
  { min: 40, max: 59, label: 'Medium', color: '#fee08b', text: '#1a1a1a' },
  { min: 60, max: 79, label: 'Good', color: '#91cf60', text: '#1a1a1a' },
  { min: 80, max: 100, label: 'Very good', color: '#1a7837', text: '#ffffff' },
];

export function bandFor(score: number): ScoreBand {
  const s = Math.round(Math.min(100, Math.max(0, score)));
  return SCORE_BANDS.find((b) => s >= b.min && s <= b.max) ?? SCORE_BANDS[0]!;
}
