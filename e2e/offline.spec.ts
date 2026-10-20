import { expect, test, type Page } from '@playwright/test';

test.describe.configure({ mode: 'serial' });

/** Number of entries in a named cache (0 if missing). */
const cacheSize = (page: Page, name: string) =>
  page.evaluate(
    async (n) => ((await caches.has(n)) ? (await (await caches.open(n)).keys()).length : 0),
    name,
  );

test('works offline on a phone: scores, squares, past days, pages and visit logging', async ({
  page,
  context,
}) => {
  // 1. Online: first visit, add a pin, let the service worker store everything.
  await page.goto('./');
  await expect(page.locator('#spot-list li')).toHaveCount(14);
  await page.waitForFunction(() => !!navigator.serviceWorker?.controller, null, {
    timeout: 30_000,
  });
  await page.locator('#pin-coords').click();
  await page.locator('#pin-name').fill('E2E pin');
  await page.locator('#pin-lat').fill('47.0752');
  await page.locator('#pin-lon').fill('8.6612');
  await page.locator('#pin-save').click();
  await expect(page.locator('#detail .meta-score')).toBeVisible({ timeout: 30_000 });
  await page.locator('#detail .close').click();

  await expect
    .poll(
      async () => [
        await cacheSize(page, 'mf-latest'),
        await cacheSize(page, 'mf-static'),
        await cacheSize(page, 'mf-grid-days'),
      ],
      {
        timeout: 90_000,
        intervals: [1000],
      },
    )
    .toEqual([1, 3, 17]); // latest.json · grid.json, reserves.geojson, habitat.json · 14 days + 3 forecast
  await expect.poll(() => cacheSize(page, 'mf-tiles'), { timeout: 30_000 }).toBeGreaterThan(5);

  // 2. Offline, new session (no in-memory or session data): reload.
  await page.evaluate(() => sessionStorage.clear());
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('#offline')).toBeVisible();
  await expect(page.locator('#offline')).toContainText("You're offline");
  await expect(page.locator('#spot-list li')).toHaveCount(14);
  const firstScore = await page.locator('#spot-list .score').first().textContent();
  expect(Number(firstScore)).toBeGreaterThan(0);
  await expect(page.locator('#cell-list li').first()).toBeVisible({ timeout: 20_000 });

  // A past day from the cache.
  await page.locator('#day').evaluate((el: HTMLInputElement) => {
    el.value = '3';
    el.dispatchEvent(new Event('input'));
  });
  await expect(page.locator('#day-label')).not.toContainText('Today');
  await expect(page.locator('#cell-list li').first()).toBeVisible();

  // Other pages work offline.
  await page.locator('.tabs a[data-page="species"]').click();
  await expect(page.locator('.species-card')).toHaveCount(9);
  await expect(page.locator('#page-species')).toContainText(
    'Check every find at an official mushroom control (Pilzkontrolle).',
  );
  await expect(page.locator('.species-card').filter({ hasText: 'Parasol' })).toContainText(
    'Amanita phalloides',
  );
  await page.locator('.tabs a[data-page="map"]').click();

  // 3. Log a visit offline at a spot (score from the cached data)…
  await page.locator('#spot-list button[data-id="oberiberg-ybrig"]').click();
  await page.locator('#detail [data-act="log"]').click();
  await page.locator('#visit-save').click();
  await expect(page.locator('#status')).toContainText('Visit saved');

  // …and at the pin, which can't be scored offline: saved as pending.
  await page.locator('#detail .close').click();
  await page.locator('#pin-list button[data-pin]').first().click();
  await expect(page.locator('#detail')).toContainText('could not be loaded', { timeout: 30_000 });
  await page.locator('#detail [data-act="log"]').click();
  await page.locator('#visit-save').click();
  await expect(page.locator('#status')).toContainText('its score will be added');
  const pending = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('mf.findlog.v1') ?? '[]'),
  );
  expect(
    pending.map((e: { place: { kind: string }; pending: boolean }) => [e.place.kind, e.pending]),
  ).toEqual([
    ['spot', false],
    ['pin', true],
  ]);
  await page.locator('#detail .close').click();
  await page.locator('.tabs a[data-page="log"]').click();
  await expect(page.locator('#log-list')).toContainText('score added when online');

  // 4. Back online: the pending score is filled in automatically.
  await context.setOffline(false);
  await expect
    .poll(
      () =>
        page.evaluate(() =>
          JSON.parse(localStorage.getItem('mf.findlog.v1') ?? '[]').map(
            (e: { pending: boolean; score: { value: number | null } }) => [
              e.pending,
              e.score.value !== null,
            ],
          ),
        ),
      { timeout: 60_000, intervals: [1000] },
    )
    .toEqual([
      [false, true],
      [false, true],
    ]);
  await expect(page.locator('#offline')).toBeHidden();
});
