// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { SpeciesFileSchema } from '@mf/scoring';
import speciesJson from '../../data/species.json';
import { renderSpeciesPage, updateFavButtons } from '../src/speciespage.js';

const species = SpeciesFileSchema.parse(speciesJson).species;

describe('species page favourites', () => {
  it('has one favourite button per species, showing its state, and reports taps', () => {
    const el = document.createElement('div');
    const onToggle = vi.fn();
    renderSpeciesPage(el, species, ['chanterelle'], onToggle);
    const buttons = el.querySelectorAll<HTMLButtonElement>('[data-fav-toggle]');
    expect(buttons.length).toBe(species.length);
    const ch = el.querySelector<HTMLButtonElement>('[data-fav-toggle="chanterelle"]')!;
    expect(ch.getAttribute('aria-pressed')).toBe('true');
    expect(ch.textContent).toMatch(/★ Favourite/);
    const por = el.querySelector<HTMLButtonElement>('[data-fav-toggle="porcini"]')!;
    expect(por.getAttribute('aria-pressed')).toBe('false');
    por.click();
    expect(onToggle).toHaveBeenCalledWith('porcini');
  });

  it('updates the buttons in place, keeping the cards', () => {
    const el = document.createElement('div');
    renderSpeciesPage(el, species, ['chanterelle'], () => {});
    const card = el.querySelector('article');
    updateFavButtons(el, species, ['porcini']);
    expect(el.querySelector('article')).toBe(card); // not re-rendered
    expect(el.querySelector('[data-fav-toggle="porcini"]')!.getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect(el.querySelector('[data-fav-toggle="chanterelle"]')!.getAttribute('aria-pressed')).toBe(
      'false',
    );
  });

  it('shows no buttons without a toggle handler', () => {
    const el = document.createElement('div');
    renderSpeciesPage(el, species);
    expect(el.querySelectorAll('[data-fav-toggle]').length).toBe(0);
  });
});
