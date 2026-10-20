/** Simple page switching by URL hash (#map, #species, #log, #about), so the back button works. */
export type Page = 'map' | 'species' | 'log' | 'about';
const PAGES: Page[] = ['map', 'species', 'log', 'about'];

export function setupPages(onShow: (p: Page) => void): { show: (p: Page) => void } {
  const current = (): Page => {
    const h = location.hash.replace('#', '') as Page;
    return PAGES.includes(h) ? h : 'map';
  };
  const apply = (focus: boolean) => {
    const p = current();
    for (const id of PAGES) {
      const el = document.getElementById(id === 'map' ? 'page-map' : `page-${id}`);
      if (el) el.hidden = id !== p;
    }
    for (const a of document.querySelectorAll<HTMLAnchorElement>('.tabs a[data-page]')) {
      if (a.dataset.page === p) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    }
    onShow(p);
    // Move focus to the page heading for screen readers and keyboards (not on first load).
    if (focus && p !== 'map') {
      const h = document.querySelector<HTMLElement>(`#page-${p} h2`);
      if (h) {
        h.tabIndex = -1;
        h.focus();
      }
    }
  };
  window.addEventListener('hashchange', () => apply(true));
  apply(false);
  return {
    show: (p) => {
      if (current() === p) apply(true);
      else location.hash = p;
    },
  };
}
