import { doyToText, shiftedSeason, type Species } from '@mf/scoring';
import { esc } from './format.js';

const DANGER = { deadly: 'Deadly', poisonous: 'Poisonous', inedible: 'Inedible' };
export const PHOTO_CAPTION = 'For orientation only. Never identify a mushroom from a photo.';
export const VAPKO_URL = 'https://www.vapko.ch';
export const CONTROL_NOTE =
  'This app does not identify mushrooms. Check every find at an official mushroom control (Pilzkontrolle).';

/** The favourite button of a species card. */
export const favButton = (id: string, name: string, on: boolean): string =>
  `<button type="button" class="chip fav-toggle" data-fav-toggle="${id}" aria-pressed="${on}" aria-label="${on ? `Remove ${esc(name)} from favourites` : `Add ${esc(name)} to favourites`}">${on ? '★ Favourite' : '☆ Add to favourites'}</button>`;

/**
 * One card per species: season, habitat, look-alikes (names and danger only) and safety notes, with a favourite
 * toggle. `onToggle` is called with the species id; the caller saves and re-renders.
 */
export function renderSpeciesPage(
  el: HTMLElement,
  species: Species[],
  favourites: string[] = [],
  onToggle?: (id: string) => void,
): void {
  el.innerHTML = species
    .map((s) => {
      const [a, b, c, d] = shiftedSeason(s, 1000);
      const ph = s.photo;
      const photo = ph
        ? `<figure class="species-photo">
            <img src="${import.meta.env.BASE_URL}${esc(ph.file)}" alt="Photo of ${esc(s.name)} (${esc(ph.shows)})" loading="lazy" width="640" />
            <figcaption><strong>${PHOTO_CAPTION}</strong>
              <span class="credit">Photo: ${esc(ph.author)}, <a href="${esc(ph.source)}" target="_blank" rel="noopener">Wikimedia Commons</a>, ${ph.licenseUrl ? `<a href="${esc(ph.licenseUrl)}" target="_blank" rel="noopener">${esc(ph.license)}</a>` : esc(ph.license)}${ph.shows !== s.latin ? ` (shows <i>${esc(ph.shows)}</i>)` : ''}.</span>
            </figcaption>
          </figure>`
        : '';
      return `<article class="species-card" aria-labelledby="sp-${s.id}">
        ${photo}
        <div class="species-head">
          <h3 id="sp-${s.id}">${esc(s.name)} <span class="small">· ${esc(s.german)} · <i>${esc(s.latin)}</i></span></h3>
          ${onToggle ? favButton(s.id, s.name, favourites.includes(s.id)) : ''}
        </div>
        <p class="small"><strong>Season</strong> at about 1,000 m: ${doyToText(a)} – ${doyToText(d)}, best ${doyToText(b)} – ${doyToText(c)}. Earlier higher up for autumn species; later higher up for morels.</p>
        <p class="small"><strong>Habitat:</strong> ${esc(s.notes)} Grows with: ${esc(s.hosts.join(', '))}. ${s.elevation.min}–${s.elevation.max} m.</p>
        <div class="lookalikes">
          <strong>Dangerous and inedible look-alikes</strong> <span class="small">(names only; more at <a href="${VAPKO_URL}" target="_blank" rel="noopener">VAPKO</a>, the Swiss association of mushroom controllers)</span>
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
  el.onclick = (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-fav-toggle]');
    if (b && onToggle) onToggle(b.dataset.favToggle!);
  };
}

/** Update the favourite buttons in place (no re-render, so photos and the scroll position stay). */
export function updateFavButtons(el: HTMLElement, species: Species[], favourites: string[]): void {
  for (const b of el.querySelectorAll<HTMLButtonElement>('[data-fav-toggle]')) {
    const s = species.find((x) => x.id === b.dataset.favToggle);
    if (s) b.outerHTML = favButton(s.id, s.name, favourites.includes(s.id));
  }
}
