import { doyToText, shiftedSeason, type Species } from '@mf/scoring';
import { esc } from './format.js';

const DANGER = { deadly: 'Deadly', poisonous: 'Poisonous', inedible: 'Inedible' };
export const CONTROL_NOTE =
  'This app does not identify mushrooms. Check every find at an official mushroom control (Pilzkontrolle).';

/** One card per species: season, habitat, look-alikes (names and danger only) and safety notes. */
export function renderSpeciesPage(el: HTMLElement, species: Species[]): void {
  el.innerHTML = species
    .map((s) => {
      const [a, b, c, d] = shiftedSeason(s, 1000);
      return `<article class="species-card" aria-labelledby="sp-${s.id}">
        <h3 id="sp-${s.id}">${esc(s.name)} <span class="small">· ${esc(s.german)} · <i>${esc(s.latin)}</i></span></h3>
        <p class="small"><strong>Season</strong> at about 1,000 m: ${doyToText(a)} – ${doyToText(d)}, best ${doyToText(b)} – ${doyToText(c)}. Earlier higher up for autumn species; later higher up for morels.</p>
        <p class="small"><strong>Habitat:</strong> ${esc(s.notes)} Grows with: ${esc(s.hosts.join(', '))}. ${s.elevation.min}–${s.elevation.max} m.</p>
        <div class="lookalikes">
          <strong>Dangerous and inedible look-alikes</strong>
          <ul>${s.lookalikes
            .map(
              (l) =>
                `<li><span class="danger danger-${l.danger}">${DANGER[l.danger]}</span> ${esc(l.name)}${l.latin ? ` <i>(${esc(l.latin)})</i>` : ''}</li>`,
            )
            .join('')}</ul>
        </div>
        ${s.safety ? `<p class="warning-box small">${esc(s.safety)}</p>` : ''}
        <p class="small control-note"><strong>${esc(CONTROL_NOTE)}</strong></p>
      </article>`;
    })
    .join('');
}
