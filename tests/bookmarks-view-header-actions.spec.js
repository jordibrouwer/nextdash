const { test, expect } = require('./fixtures');
const { openBookmarksWithHealth } = require('./helpers/bookmarks-health');

/**
 * The Bookmarks view's band carries Health's header: Work through as its
 * one button, everything else in one Collection menu, and ⓘ. The header
 * icon carries Health's badge.
 */

const band = (page) => page.locator('.config-view--library .lvs-header-actions');
const menu = (page) => band(page).locator('[data-bm-header-menu]');

/** Opens the header's Collection menu and clicks one of its items. */
async function fromMenu(page, sel) {
  await band(page).locator('[data-bm-header-more]').click();
  await menu(page).locator(sel).click();
}

test.describe('bookmarks view: the band\'s actions', () => {
  test('Work through, one Collection menu and ⓘ; the rest is in the menu', async ({ page }) => {
    await openBookmarksWithHealth(page, undefined, { view: 'library' });
    await expect(band(page).locator('[data-bm-work-through]')).toContainText('Work through');
    await expect(band(page).locator('[data-bm-header-more]')).toContainText('Collection');
    await expect(band(page).locator('[data-bm-help]')).toBeVisible();
    await expect(band(page).locator('button:visible')).toHaveCount(3);
    await band(page).locator('[data-bm-header-more]').click();
    for (const sel of ['[data-bm-open-health-modal]', '[data-bm-rot-report]', '[data-bm-open-structure]',
      '[data-bm-export]', '[data-bm-header-action="refresh"]', '[data-bm-header-action="settings"]']) {
      await expect(menu(page).locator(sel)).toBeVisible();
    }
  });

  test('Work through walks the list as the view has it', async ({ page }) => {
    await openBookmarksWithHealth(page, undefined, { view: 'library' });
    await page.locator('#config-bm-rail [data-bm-rail="health"][data-value="broken"]').click();
    await band(page).locator('[data-bm-work-through]').click();
    await expect(page.locator('.health-focus-overlay')).toBeVisible();
    // The Health view is not what opened: the address stays the Bookmarks view's.
    await expect(page).toHaveURL(/#bookmarks/);
  });

  test('Work through\'s buttons sit side by side on one row', async ({ page }) => {
    await openBookmarksWithHealth(page, undefined, { view: 'library' });
    await band(page).locator('[data-bm-work-through]').click();
    const buttons = page.locator('.health-focus-overlay .health-focus-actions button');
    await expect(buttons.first()).toBeVisible();
    expect(await buttons.count()).toBeGreaterThanOrEqual(5);
    const tops = await buttons.evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().top)));
    expect(new Set(tops).size).toBe(1);
  });

  test('under glass depth the card is glass, like every other modal', async ({ page }) => {
    await openBookmarksWithHealth(page, undefined, { view: 'library' });
    await page.evaluate(() => { document.body.dataset.depth = 'glass'; });
    await band(page).locator('[data-bm-work-through]').click();
    const card = page.locator('.health-focus-overlay .health-focus-card');
    await expect(card).toBeVisible();
    const look = await card.evaluate((el) => {
      const probe = document.createElement('div');
      probe.style.background = 'var(--background-modal)';
      document.body.appendChild(probe);
      const modal = getComputedStyle(probe).backgroundColor;
      probe.remove();
      const cs = getComputedStyle(el);
      return { bg: cs.backgroundColor, modal, filter: cs.backdropFilter || cs.webkitBackdropFilter };
    });
    expect(look.bg).toBe(look.modal);
    expect(look.filter).toContain('blur');
  });

  test('f starts it from the list', async ({ page }) => {
    await openBookmarksWithHealth(page, undefined, { view: 'library' });
    await page.evaluate(() => document.activeElement?.blur?.());
    await page.keyboard.press('f');
    await expect(page.locator('.health-focus-overlay')).toBeVisible();
  });

  test('Rot report, from the menu, and ⓘ open their explanations', async ({ page }) => {
    await openBookmarksWithHealth(page, undefined, { view: 'library' });
    await fromMenu(page, '[data-bm-rot-report]');
    await expect(page.locator('#app-modal.show')).toBeVisible();
    await expect(menu(page)).toBeHidden();
    await page.keyboard.press('Escape');
    await expect(page.locator('#app-modal.show')).toHaveCount(0);
    await band(page).locator('[data-bm-help]').click();
    await expect(page.locator('#app-modal.show')).toContainText(/Bookmarks/);
  });

  test('Export downloads the list as it stands', async ({ page }) => {
    await openBookmarksWithHealth(page, undefined, { view: 'library' });
    const download = page.waitForEvent('download');
    await fromMenu(page, '[data-bm-export]');
    expect((await download).suggestedFilename()).toMatch(/\.csv$/);
  });

  test('Refresh report in the menu asks for a fresh report', async ({ page }) => {
    await openBookmarksWithHealth(page, undefined, { view: 'library' });
    const refreshed = page.waitForRequest((r) => /\/api\/bookmark-health\?refresh=1/.test(r.url()));
    await fromMenu(page, '[data-bm-header-action="refresh"]');
    await refreshed;
  });

  test('the menu closes on Escape and on a click outside it', async ({ page }) => {
    await openBookmarksWithHealth(page, undefined, { view: 'library' });
    const more = band(page).locator('[data-bm-header-more]');
    await more.click();
    await expect(menu(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(menu(page)).toBeHidden();
    await expect(more).toHaveAttribute('aria-expanded', 'false');
    await more.click();
    await expect(menu(page)).toBeVisible();
    await page.locator('.config-view--library .lvs-header-text').click();
    await expect(menu(page)).toBeHidden();
  });
});

test('the Bookmarks icon in the header carries the count of problems', async ({ page }) => {
  await openBookmarksWithHealth(page, undefined, { view: 'library' });
  // The helper stubs the report after the page has loaded, so the start-up
  // badge fetch saw the real one: the refresh is run again against the stub,
  // rather than waited for from a poll that comes minutes later.
  await page.evaluate(() => window.dashboardInstance.updateHealthBadge());
  const library = page.locator('.library-link a .health-badge');
  await expect(library).toHaveText('1');
  await expect(library).toHaveText(await page.locator('.health-link a .health-badge').textContent());
  // On the icon's own corner, as Health's is on its.
  const [badge, anchor] = [await library.boundingBox(), await page.locator('.library-link a').boundingBox()];
  const cx = badge.x + badge.width / 2;
  const cy = badge.y + badge.height / 2;
  expect(Math.abs(cx - (anchor.x + anchor.width))).toBeLessThanOrEqual(badge.width);
  expect(Math.abs(cy - anchor.y)).toBeLessThanOrEqual(badge.height);
});

/*
 * The Health view's collection-wide tools, carried into the Collection menu
 * before that view goes: each offered while it has something to act on, and
 * each run by Health's own method, against the same endpoint.
 */
test.describe('bookmarks view: the Collection menu\'s checks', () => {
  test('Retest all and Open broken links are offered, with the broken count', async ({ page }) => {
    await openBookmarksWithHealth(page, undefined, { view: 'library' });
    await band(page).locator('[data-bm-header-more]').click();
    await expect(menu(page).locator('[data-bm-header-action="retest"]')).toBeVisible();
    await expect(menu(page).locator('[data-bm-header-action="open-broken"]')).toContainText('1');
    // Nothing in the fixture lacks a preview: nothing to offer for it.
    await expect(menu(page).locator('[data-bm-header-action="fetch-previews"]')).toHaveCount(0);
  });

  test('Retest all runs the retest over the whole collection', async ({ page }) => {
    const asked = [];
    await page.route('**/api/health/retest-all**', (route) => {
      asked.push(route.request().url());
      return route.fulfill({ json: { tested: 3 } });
    });
    await openBookmarksWithHealth(page, undefined, { view: 'library' });
    await fromMenu(page, '[data-bm-header-action="retest"]');
    await expect.poll(() => asked.length).toBe(1);
    expect(asked[0]).toContain('scope=all');
  });

  test('Open broken links asks first, then asks the server which to open', async ({ page }) => {
    const asked = [];
    await page.route('**/api/health/open-broken', (route) => {
      asked.push(route.request().postData());
      return route.fulfill({ json: { urls: [], totalBroken: 1 } });
    });
    await openBookmarksWithHealth(page, undefined, { view: 'library' });
    await fromMenu(page, '[data-bm-header-action="open-broken"]');
    await expect(page.locator('#app-modal.show')).toBeVisible();
    expect(asked).toEqual([]);
    await page.locator('#app-modal.show .modal-button').first().click();
    await expect.poll(() => asked.length).toBe(1);
  });

  test('Merge duplicates with several groups shows them in the list', async ({ page }) => {
    await openBookmarksWithHealth(page, undefined, { view: 'library' });
    await page.evaluate(() => {
      const health = window.dashboardInstance.config._bmHealthModule;
      const two = [{ bookmarks: [{}, {}] }, { bookmarks: [{}, {}] }];
      health.duplicateGroups = () => two;
    });
    await fromMenu(page, '[data-bm-header-action="merge"]');
    await expect.poll(() => page.evaluate(() => window.dashboardInstance.config.bmCleanupFilter)).toBe('duplicate');
  });
});
