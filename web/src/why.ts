import {
  explain,
  type Details,
  type HabitatFacts,
  type Species,
  type SpeciesResult,
} from '@mf/scoring';
import { esc } from './format.js';

const MARK = { good: '✓', fair: '~', poor: '✗' };
const WORD = { good: 'Good', fair: 'Fair', poor: 'Poor' };

/** The "Why this score" list: one line per component, with a symbol and a word so colour is never needed. */
export function whyHtml(
  s: Species,
  r: Pick<SpeciesResult, 'components'> & { details: unknown },
  facts: HabitatFacts,
): string {
  return explain(s, r.components, r.details as Details, facts)
    .map(
      (e) =>
        `<li class="why-item ${e.verdict}"><span class="why-mark" aria-hidden="true">${MARK[e.verdict]}</span><div><strong>${e.title}</strong> <span class="visually-hidden">${WORD[e.verdict]}.</span><span class="small">${WORD[e.verdict]}</span>${e.lines.map((l) => `<p>${esc(l)}</p>`).join('')}</div></li>`,
    )
    .join('');
}
