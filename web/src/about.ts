import { SCORE_BANDS } from '@mf/scoring';
import { CONTROL_NOTE } from './speciespage.js';
import {
  canInstall,
  install,
  isPersisted,
  isStandalone,
  onInstallChange,
  requestPersist,
} from './storage.js';

const REPO = 'https://github.com/whnhf2f85z-tech/mushroom-finder';

export function renderAbout(
  el: HTMLElement,
  opts: { onFavourites: () => void; built: string },
): void {
  el.innerHTML = `
    <p class="warning-box"><strong>${CONTROL_NOTE}</strong> Scores are estimates, not a promise, and never a sign that a mushroom is safe to eat.</p>

    <h3>What this app does</h3>
    <p>It estimates, every morning, how likely you are to find some edible mushrooms in the forests of Zürich and Schwyz: for 14 named spots, for 1,567 forest squares of 1 × 1 km, and for your own pins. It combines the recent and forecast weather, the season and the habitat (trees, soil, elevation, slope).</p>

    <h3>How to read the scores</h3>
    <ul class="legend">${SCORE_BANDS.map((b) => `<li><span class="swatch" style="background:${b.color};color:${b.text}">${b.min}–${b.max}</span>${b.label}</li>`).join('')}</ul>
    <ul class="small plain">
      <li><strong>My favourites</strong> (default): each place shows the best score among your favourite species. Pick one species with the chips above the map, or change your favourites in Settings below.</li>
      <li><strong>Day slider:</strong> the last 13 days, today and 3 forecast days (marked "Forecast").</li>
      <li><strong>Squares vs spots:</strong> squares use weather from a point up to ~2 km away; spots and pins use their own.</li>
      <li>Squares mainly reflect weather and season. For most species the habitat data barely distinguishes between forests, so use local knowledge for where to look.</li>
      <li>Tree-mix data is estimated from forest site maps and the conifer share; it may differ from the trees actually present.</li>
      <li><strong>Why this score:</strong> open a spot, square or pin to see the reasons (season, rain, temperature, frost, dry spell, habitat) and the 14-day chart.</li>
      <li><strong>Hatched red</strong> areas: no picking. <strong>Dashed orange</strong>: protected, check the rules. <strong>Grey</strong>: closed that day (Zürich: no picking on the 1st–10th).</li>
    </ul>

    <h3>Install the app</h3>
    <div id="install-box"></div>
    <ul class="small plain">
      <li><strong>iPhone / iPad (Safari):</strong> tap the Share button, then <em>Add to Home Screen</em>. Please do this: Safari can delete a website's data (your pins and find log) after 7 days without use, but not the data of an app added to the home screen.</li>
      <li><strong>Android (Chrome):</strong> tap the ⋮ menu, then <em>Install app</em> or <em>Add to Home screen</em>, or use the button above when it appears.</li>
      <li>Once installed, the app works offline with the last scores it downloaded: the map tiles you have already looked at, the 14 days of scores, the squares and the reserves.</li>
    </ul>

    <h3>Your data</h3>
    <p class="small">Your favourites, pins and find log are stored <strong>only on this device</strong>: no account, nothing is sent to us. Export them now and then (Find log → Export; My pins → Export pins) to keep a backup or move to another device.</p>
    <p class="small" id="persist-status">Checking storage…</p>

    <h3>Settings</h3>
    <div class="button-row">
      <button type="button" class="action-button secondary" id="about-favourites">Edit favourites</button>
    </div>
    <p class="small">Units: °C, mm of rain, metres, grams, kilometres.</p>

    <h3>Method</h3>
    <p class="small">Each species gets six parts, each from 0 to 1: <strong>season</strong> (shifted with elevation), <strong>rain and soil moisture</strong> (rain 1–2 weeks earlier, soil moisture), <strong>temperature</strong> (7-day mean against the species' range), <strong>frost</strong>, <strong>dry spell</strong> (last 60 days) and <strong>habitat</strong> (tree mix, soil pH, elevation, tree cover). Score = 100 × habitat × √season × moisture<sup>0.6</sup> × temperature<sup>0.4</sup> × frost × dry spell. All values are first estimates; your find log helps to calibrate them. Details: <a href="${REPO}/blob/main/docs/SCORING.md">SCORING.md</a>.</p>

    <h3>Rules</h3>
    <p class="small">Schwyz: max 2 kg per person per day (morels 1 kg), no organised group picking, no picking in plant protection areas and the listed reserves. Zürich: no picking on the 1st–10th of every month, max 1 kg per person per day, no picking in nature protection zones. Always follow the signs on site.</p>

    <h3>Data and credits</h3>
    <ul class="small plain">
      <li>Weather: <a href="https://open-meteo.com">Open-Meteo</a> (CC BY 4.0).</li>
      <li>Base map, canton borders, terrain model swissALTI3D, geology GeoCover: © <a href="https://www.swisstopo.admin.ch">swisstopo</a>.</li>
      <li>Forest mix rate (NFI) and federal moor inventories: <a href="https://www.bafu.admin.ch">BAFU / FOEN</a>.</li>
      <li>Forest site types and reserves: <a href="https://map.geo.sz.ch">Kanton Schwyz</a>; forest vegetation map and protection zones: <a href="https://maps.zh.ch">Kanton Zürich</a> (open government data).</li>
      <li>Host trees of each species: derived from aggregated partner-tree counts of <a href="https://www.wsl.ch/map_fungi">SwissFungi</a> (Swiss National Fungi Databank, WSL), divided by the tree shares of the Swiss National Forest Inventory. No explicit terms of use were found for these counts.</li>
      <li>Picking rules: zh.ch and sz.ch. Software: Leaflet, uPlot, zod, Vite.</li>
      <li>Source code: <a href="${REPO}">GitHub</a> · version ${opts.built}.</li>
    </ul>`;

  el.querySelector('#about-favourites')!.addEventListener('click', opts.onFavourites);

  const box = el.querySelector<HTMLElement>('#install-box')!;
  const renderInstall = () => {
    box.innerHTML = isStandalone()
      ? '<p class="small">✓ You are using the installed app.</p>'
      : canInstall()
        ? '<button type="button" class="action-button" id="install-btn">Install the app</button>'
        : '';
    box.querySelector('#install-btn')?.addEventListener('click', () => void install());
  };
  renderInstall();
  onInstallChange(renderInstall);

  const status = el.querySelector<HTMLElement>('#persist-status')!;
  const renderPersist = async () => {
    const p = await isPersisted();
    status.innerHTML =
      p === true
        ? '✓ This browser has agreed to keep this data (persistent storage).'
        : p === false
          ? 'This browser may clear this data when space runs low or after a long time without use. <button type="button" class="link-button" id="persist-btn">Ask it to keep my data</button>'
          : 'This browser does not say whether it keeps the data: export a backup now and then.';
    status.querySelector('#persist-btn')?.addEventListener('click', async () => {
      await requestPersist();
      void renderPersist();
    });
  };
  void renderPersist();
}
