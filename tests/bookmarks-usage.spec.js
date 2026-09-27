const { test, expect } = require('./fixtures');
const { openBookmarksWithHealth } = require('./helpers/bookmarks-health');

/**
 * The panel's Usage tab: what the bookmark carries (added, edited, opened,
 * opens) set against the collection, and the recent opens as a chart.
 */

const DAY = 24 * 3600 * 1000;
const drawer = (page) => page.locator('.lvs-drawer-host[data-lvs-drawer="library"] .lvs-drawer');
const usage = (page) => drawer(page).locator('[data-bm-pane="usage"]');

async function openUsage(page, bookmark) {
  await page.locator('#config-bm-list .config-bm-row', { has: page.locator('.config-bm-title', { hasText: bookmark.name }) }).first().click();
  await drawer(page).locator('[data-bm-tab-panel="usage"]').click();
  await expect(usage(page)).toBeVisible();
}

test.describe('bookmark panel: Usage', () => {
  test('a bookmark in use shows its opens, its rank, when it was added, and its weeks', async ({ page }) => {
    const { bookmarks } = await openBookmarksWithHealth(page, undefined, {
      view: 'library',
      prepare: () => {
        const now = Date.now();
        const day = 24 * 3600 * 1000;
        window.dashboardInstance.allBookmarks.forEach((b, i) => {
          b.openCount = i === 0 ? 40 : i;
          b.createdAt = now - 70 * day;
          b.lastOpened = i === 0 ? now - 2 * day : 0;
        });
        window.dashboardInstance.allBookmarks[0].openLog = Array.from({ length: 12 }, (_, k) => now - k * 3 * day);
      },
    });
    await openUsage(page, bookmarks[0]);
    await expect(usage(page).locator('.config-bm-usage-tiles')).toContainText('40');
    await expect(usage(page)).toContainText('#1 of');
    await expect(usage(page)).toContainText('Added');
    await expect(usage(page).locator('.config-bm-usage-rank .is-me')).toHaveCount(1);
    await expect(usage(page).locator('svg.config-bm-usage-weeks rect')).toHaveCount(12);
    await expect(usage(page)).toContainText('Busiest day');
  });

  test('a bookmark with no recorded opens says the chart is still to fill', async ({ page }) => {
    const { bookmarks } = await openBookmarksWithHealth(page, undefined, { view: 'library' });
    await openUsage(page, bookmarks[1]);
    await expect(usage(page).locator('[data-bm-usage-history="empty"]')).toBeVisible();
  });

  test('a bookmark never opened offers the others never opened', async ({ page }) => {
    const { bookmarks } = await openBookmarksWithHealth(page, undefined, {
      view: 'library',
      prepare: () => {
        window.dashboardInstance.allBookmarks.forEach((b, i) => { b.openCount = i === 0 ? 3 : 0; b.lastOpened = i === 0 ? Date.now() : 0; });
      },
    });
    await openUsage(page, bookmarks[1]);
    await expect(usage(page)).toContainText('never opened');
    await usage(page).locator('[data-bm-usage-show="never"]').click();
    await expect(page).toHaveURL(/#bookmarks\?.*filter=never/);
  });
});

test('with nothing to show, each part of Usage says so', async ({ page }) => {
  const { bookmarks } = await openBookmarksWithHealth(page, undefined, {
    view: 'library',
    prepare: () => {
      window.dashboardInstance.allBookmarks.forEach((b) => {
        b.openCount = 0; b.lastOpened = 0; b.createdAt = 0; b.openLog = [];
      });
    },
  });
  await openUsage(page, bookmarks[1]);
  await expect(usage(page)).toContainText('not recorded');
  await expect(usage(page).locator('[data-bm-usage-rank="empty"]')).toBeVisible();
  await expect(usage(page).locator('[data-bm-usage-history="empty"]')).toBeVisible();
});

test('opening a bookmark records when, for the chart', async ({ page }) => {
  const { bookmarks } = await openBookmarksWithHealth(page, undefined, { view: 'library' });
  const target = bookmarks[2];
  // The row's own open (Enter), which is what reports the open to the server.
  await page.context().route(target.url.replace(/\/$/, '') + '**', (route) => route.fulfill({ status: 200, body: 'ok' }));
  const tracked = page.waitForRequest((r) => r.url().includes('/api/track-open'));
  await page.locator('#config-bm-list .config-bm-row', { has: page.locator('.config-bm-title', { hasText: target.name }) }).first().click();
  await page.evaluate(() => document.activeElement?.blur?.());
  await page.keyboard.press('Enter');
  await tracked;
  await expect.poll(async () => {
    const res = await page.request.get(`/api/bookmarks?page=${target.pageId}`);
    const list = await res.json();
    return (list.find((b) => b.url === target.url)?.openLog || []).length;
  }).toBeGreaterThan(0);
});
