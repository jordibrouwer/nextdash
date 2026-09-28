const { test, expect } = require('./fixtures');
const { openBookmarksWithHealth } = require('./helpers/bookmarks-health');

/**
 * Every way of opening a bookmark in the Bookmarks view counts, as an open
 * from the dashboard does: it reaches /api/track-open and the row's count.
 */

const drawer = (page) => page.locator('.lvs-drawer-host[data-lvs-drawer="library"] .lvs-drawer');

async function setup(page, settings = {}) {
  const opens = [];
  page.on('request', (r) => { if (/\/api\/track-open$/.test(r.url())) opens.push(r.postData()); });
  const ctx = await openBookmarksWithHealth(page, undefined, {
    view: 'library',
    prepare: () => { window.open = () => null; },
  });
  if (Object.keys(settings).length) {
    await page.evaluate((s) => Object.assign(window.dashboardInstance.settings, s), settings);
  }
  const b = ctx.bookmarks[1];
  const row = page.locator('#config-bm-list .config-bm-row', { has: page.locator('.config-bm-title', { hasText: b.name }) }).first();
  return { opens, row, b };
}

test.describe('bookmarks view: opens count', () => {
  test('the panel\'s Open', async ({ page }) => {
    const { opens, row } = await setup(page);
    await row.click();
    await drawer(page).locator('.config-bm-panel-head [data-bm-panel-action="open"]').click();
    await expect.poll(() => opens.length).toBe(1);
  });

  test('the address in the panel\'s head', async ({ page }) => {
    const { opens, row } = await setup(page);
    await row.click();
    const link = drawer(page).locator('.config-bm-panel-head .config-bm-panel-url');
    // A real link: only the tab it would open is kept from happening.
    await link.evaluate((a) => a.addEventListener('click', (e) => e.preventDefault()));
    await link.click();
    await expect.poll(() => opens.length).toBe(1);
  });

  test('Details → Address → Open in new tab', async ({ page }) => {
    const { opens, row } = await setup(page);
    await row.click();
    const address = drawer(page).locator('[data-bm-acc="address"]');
    await address.locator('summary').click();
    await address.locator('[data-bm-panel-action="open-new-tab"]').click();
    await expect.poll(() => opens.length).toBe(1);
  });

  test('the row menu\'s Open in new tab, and a double click', async ({ page }) => {
    const { opens, row } = await setup(page);
    await row.click({ button: 'right' });
    await page.locator('#config-bm-context-menu [data-action="open-new-tab"]').click();
    await expect.poll(() => opens.length).toBe(1);
    await row.dblclick();
    await expect.poll(() => opens.length).toBe(2);
  });

  test('Open in Work through', async ({ page }) => {
    const { opens } = await setup(page);
    await page.locator('.config-view--library .lvs-header-actions [data-bm-work-through]').click();
    await page.locator('[data-focus-pile="list"]').click();
    await page.locator('.health-focus-overlay .health-focus-open').click();
    await expect.poll(() => opens.length).toBe(1);
  });

  test('opening in the same tab counts too', async ({ page }) => {
    const { opens, row, b } = await setup(page, { openInNewTab: false });
    await page.route(`${b.url.replace(/\/$/, '')}**`, (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<p>away</p>' }));
    await row.click();
    await drawer(page).locator('.config-bm-panel-head [data-bm-panel-action="open"]').click();
    await expect.poll(() => opens.length).toBe(1);
  });
});
