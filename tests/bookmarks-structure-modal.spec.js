const { test, expect } = require('./fixtures');
const { openBookmarksWithHealth } = require('./helpers/bookmarks-health');

/**
 * Pages and categories, managed from the Bookmarks view in a modal built
 * from Structure's own editors.
 */

const modal = (page) => page.locator('[data-structure-modal]');

/** Pages & categories, from the Collection menu in the view's header. */
async function openFromHeader(page) {
  await page.locator('.config-view--library .lvs-header-actions [data-bm-header-more]').click();
  await page.locator('.config-view--library [data-bm-header-menu] [data-bm-open-structure]').click();
}

test.describe('pages and categories modal', () => {
  test('Manage beside the rail\'s Pages opens it on Pages, with a count per page', async ({ page }) => {
    await openBookmarksWithHealth(page, undefined, { view: 'library' });
    await page.locator('#config-bm-rail [data-bm-manage="pages"]').click();
    await expect(modal(page)).toBeVisible();
    await expect(modal(page).locator('[data-pt-tab="pages"]')).toHaveAttribute('aria-selected', 'true');
    await expect(modal(page).locator('[data-page-row]').first()).toBeVisible();
    await expect(modal(page).locator('[data-page-row]').first().locator('.structure-num')).toContainText(/\d/);
  });

  test('Manage beside Categories opens it on Categories, and the tabs switch', async ({ page }) => {
    await openBookmarksWithHealth(page, undefined, { view: 'library' });
    await page.locator('#config-bm-rail [data-bm-manage="categories"]').click();
    await expect(modal(page).locator('[data-pt-tab="categories"]')).toHaveAttribute('aria-selected', 'true');
    await expect(modal(page).locator('[data-cat-row][data-cat-page]').first()).toBeVisible();
    await modal(page).locator('[data-pt-tab="pages"]').click();
    await expect(modal(page).locator('[data-page-row]').first()).toBeVisible();
  });

  test('renaming a page there saves it and the rail follows once it closes', async ({ page }) => {
    await openBookmarksWithHealth(page, undefined, { view: 'library' });
    const posted = [];
    page.on('request', (r) => { if (r.method() === 'POST' && /\/api\/pages$/.test(r.url())) posted.push(r.postDataJSON()); });
    await page.locator('#config-bm-rail [data-bm-manage="pages"]').click();
    const name = modal(page).locator('[data-page="name"]').first();
    await name.fill('Renamed page');
    await name.press('Tab');
    await expect.poll(() => posted.length).toBeGreaterThan(0);
    expect(posted[0][0].name).toBe('Renamed page');
    // The first Escape leaves the field it is in, the second closes the modal.
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await expect(modal(page)).toHaveCount(0);
    await expect(page.locator('#config-bm-rail')).toContainText('Renamed page');
  });

  test('Show its bookmarks, under a page row\'s ⋯, filters the list to it and closes the modal', async ({ page }) => {
    await openBookmarksWithHealth(page, undefined, { view: 'library' });
    await page.locator('#config-bm-rail [data-bm-manage="pages"]').click();
    const row = modal(page).locator('[data-page-row]').first();
    const pageId = await row.getAttribute('data-page-row');
    await row.hover();
    await row.locator('[data-structure-more]').click();
    await modal(page).locator('[data-structure-menu] [data-structure-proxy="show"]').click();
    await expect(modal(page)).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp(`#bookmarks/${pageId}`));
  });

  test('P and C open it from the list', async ({ page }) => {
    await openBookmarksWithHealth(page, undefined, { view: 'library' });
    await page.evaluate(() => document.activeElement?.blur?.());
    await page.keyboard.press('Shift+P');
    await expect(modal(page).locator('[data-pt-tab="pages"]')).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Shift+C');
    await expect(modal(page).locator('[data-pt-tab="categories"]')).toHaveAttribute('aria-selected', 'true');
  });

  test('a delete confirmation opens over it', async ({ page }) => {
    await openBookmarksWithHealth(page, undefined, { view: 'library' });
    await page.locator('#config-bm-rail [data-bm-manage="pages"]').click();
    // Adding saves before it repaints: wait for the new row, or the ⋯ opens on
    // the old last one (page 1 has no Delete) and the repaint drops the menu.
    const rows = modal(page).locator('[data-page-row]');
    const before = await rows.count();
    await modal(page).locator('[data-page-add]').click();
    await expect(rows).toHaveCount(before + 1);
    const id = await rows.last().getAttribute('data-page-row');
    await modal(page).locator(`[data-page-row="${id}"] [data-structure-more]`).click();
    await modal(page).locator('[data-structure-menu] [data-structure-proxy="delete"]').click();
    const confirm = page.locator('#config-confirm-modal, #app-modal.show').first();
    await expect(confirm).toBeVisible();
    // The confirmation is on top: its own button is what a click reaches.
    const button = confirm.locator('button').last();
    const box = await button.boundingBox();
    const hit = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('#config-confirm-modal, #app-modal') !== null,
      { x: box.x + box.width / 2, y: box.y + box.height / 2 });
    expect(hit).toBe(true);
  });
});

test.describe('pages and categories modal: the rest of its actions', () => {
  const rowMenu = (row) => row.locator('[data-structure-more]');

  async function openWithSecondPage(page) {
    await openBookmarksWithHealth(page, undefined, { view: 'library' });
    await openFromHeader(page);
    await expect(modal(page)).toBeVisible();
    // One page more than there was: the data dir is shared, so "two" is not
    // something this test can count on.
    const before = await modal(page).locator('[data-page-row]').count();
    await modal(page).locator('[data-page-add]').click();
    await expect(modal(page).locator('[data-page-row]')).toHaveCount(before + 1);
  }

  test('the view header\'s Collection menu opens it', async ({ page }) => {
    await openBookmarksWithHealth(page, undefined, { view: 'library' });
    await page.locator('.config-view--library .lvs-header-actions [data-bm-header-more]').click();
    const item = page.locator('.config-view--library [data-bm-header-menu] [data-bm-open-structure]');
    await expect(item).toContainText('Pages & categories');
    await item.click();
    await expect(modal(page)).toBeVisible();
  });

  test('pages can be dragged into a new order', async ({ page }) => {
    await openWithSecondPage(page);
    const posted = [];
    page.on('request', (r) => { if (r.method() === 'POST' && /\/api\/pages$/.test(r.url())) posted.push(r.postDataJSON()); });
    const rows = modal(page).locator('[data-page-row]');
    const firstId = await rows.nth(0).getAttribute('data-page-row');
    const secondId = await rows.nth(1).getAttribute('data-page-row');
    await rows.nth(1).locator('[data-structure-grip]').dragTo(rows.nth(0), { targetPosition: { x: 20, y: 4 } });
    await expect.poll(() => posted.length).toBeGreaterThan(0);
    // Only the two dragged past each other: the data dir is shared, and
    // another test may have added a page of its own meanwhile.
    const order = posted[posted.length - 1].map((p) => String(p.id));
    expect(order.indexOf(secondId)).toBeLessThan(order.indexOf(firstId));
  });

  test('Move all bookmarks to… moves a page\'s bookmarks to another page', async ({ page }) => {
    await openWithSecondPage(page);
    const moves = [];
    await page.route('**/api/bookmarks/move', async (route) => {
      moves.push(route.request().postDataJSON());
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ moved: 1, skipped: [] }) });
    });
    // From the page the fixture's bookmarks are on, to the page just added.
    const from = await page.evaluate(() => String(window.dashboardInstance.allBookmarks[0].pageId));
    const target = await modal(page).locator('[data-page-row]').last().getAttribute('data-page-row');
    await rowMenu(modal(page).locator(`[data-page-row="${from}"]`)).click();
    const menu = modal(page).locator('[data-structure-menu]');
    await menu.locator('[data-structure-action="move-all"]').click();
    await menu.locator('[data-structure-target]').selectOption(target);
    await menu.locator('[data-structure-confirm]').click();
    await expect.poll(() => moves.length).toBe(1);
    expect(moves[0].toPage).toBe(Number(target));
    expect(moves[0].items.length).toBeGreaterThan(0);
  });

  // Category ids are per page. Moved without one, the rows kept their own
  // ids and showed under "Unknown category" on the target.
  test('Move all bookmarks to… brings their categories along', async ({ page }) => {
    await openWithSecondPage(page);
    const posted = [];
    await page.route('**/api/bookmarks/move', (route) => route.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify({ moved: [], skipped: [] }) }));
    await page.route('**/api/categories?page=*', async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      posted.push({ url: route.request().url(), body: route.request().postDataJSON() });
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });
    const from = await page.evaluate(() => String(window.dashboardInstance.allBookmarks[0].pageId));
    const cats = await page.evaluate((pid) => [...new Set(window.dashboardInstance.allBookmarks
      .filter((b) => String(b.pageId) === pid).map((b) => b.category).filter(Boolean))], from);
    test.skip(!cats.length, 'the page has no categorised bookmarks');
    const target = await modal(page).locator('[data-page-row]').last().getAttribute('data-page-row');
    await rowMenu(modal(page).locator(`[data-page-row="${from}"]`)).click();
    const menu = modal(page).locator('[data-structure-menu]');
    await menu.locator('[data-structure-action="move-all"]').click();
    await menu.locator('[data-structure-target]').selectOption(target);
    await menu.locator('[data-structure-confirm]').click();
    await expect.poll(() => posted.length, { timeout: 10_000 }).toBeGreaterThan(0);
    expect(posted.every((p) => p.url.includes(`page=${target}`))).toBe(true);
    // The POSTs are stubbed, so each one carries the categories made so far.
    await expect.poll(() => new Set(posted.flatMap((p) => p.body.map((c) => String(c.id)))).size,
      { timeout: 10_000 }).toBeGreaterThanOrEqual(cats.length);
    const made = [...new Set(posted.flatMap((p) => p.body.map((c) => String(c.id))))];
    expect(made).toEqual(expect.arrayContaining(cats));
  });

  test('Remove all empty pages deletes the ones without bookmarks, after asking', async ({ page }) => {
    await openWithSecondPage(page);
    const emptyId = await modal(page).locator('[data-page-row]').last().getAttribute('data-page-row');
    const deleted = [];
    page.on('request', (r) => { if (r.method() === 'DELETE' && /\/api\/pages\//.test(r.url())) deleted.push(r.url()); });
    await modal(page).locator('[data-structure-remove-empty]').click();
    await page.locator('#config-confirm-modal button, #app-modal.show button').filter({ hasText: /remove|delete|confirm/i }).last().click();
    await expect.poll(() => deleted.some((url) => url.includes(`/api/pages/${emptyId}`))).toBe(true);
  });

  test('Open on the dashboard goes to that page', async ({ page }) => {
    await openBookmarksWithHealth(page, undefined, { view: 'library' });
    await openFromHeader(page);
    const row = modal(page).locator('[data-page-row]').first();
    await rowMenu(row).click();
    await modal(page).locator('[data-structure-menu] [data-structure-action="open-dashboard"]').click();
    await expect(modal(page)).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => window.dashboardInstance.activeView)).toBe('bookmarks');
  });

  test('a category can be merged into another', async ({ page }) => {
    await openBookmarksWithHealth(page, undefined, { view: 'library' });
    const cats = await page.evaluate(() => {
      const d = window.dashboardInstance;
      const withCat = d.allBookmarks.filter((b) => b.category);
      return [...new Set(withCat.map((b) => b.category))];
    });
    test.skip(cats.length < 2, 'the fixture needs two categories with bookmarks');
    const patches = [];
    await page.route(/\/api\/bookmarks(\?.*)?$/, async (route) => {
      if (route.request().method() !== 'PATCH') return route.fallback();
      patches.push(JSON.parse(route.request().postData() || '{}'));
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'success', updated: 1, missing: [] }) });
    });
    await openFromHeader(page);
    await modal(page).locator('[data-pt-tab="categories"]').click();
    const row = modal(page).locator('[data-cat-row]').first();
    await expect(row).toBeVisible();
    await rowMenu(row).click();
    const menu = modal(page).locator('[data-structure-menu]');
    await menu.locator('[data-structure-action="merge"]').click();
    const options = await menu.locator('[data-structure-target] option').evaluateAll((os) => os.map((o) => o.value).filter(Boolean));
    await menu.locator('[data-structure-target]').selectOption(options[0]);
    await menu.locator('[data-structure-confirm]').click();
    await page.locator('#config-confirm-modal button, #app-modal.show button').filter({ hasText: /merge|confirm/i }).last().click();
    await expect.poll(() => patches.length).toBeGreaterThan(0);
    expect(patches[0].updates.every((u) => u.fields?.category === options[0])).toBe(true);
  });
});

test.describe('pages and categories modal: one screen', () => {
  test('it fits the screen, lists in two columns, and keeps its buttons under ⋯', async ({ page }) => {
    await openBookmarksWithHealth(page, undefined, { view: 'library' });
    await page.locator('#config-bm-rail [data-bm-manage="categories"]').click();
    const box = modal(page).locator('.config-structure-modal');
    await expect(box).toBeVisible();
    const m = await box.evaluate((el) => ({ over: el.scrollHeight > el.clientHeight + 1, bottom: el.getBoundingClientRect().bottom, inner: window.innerHeight }));
    expect(m.over).toBe(false);
    expect(m.bottom).toBeLessThanOrEqual(m.inner);
    const cols = await modal(page).locator('.config-crud-list--table').evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length);
    expect(cols).toBe(2);
    const row = modal(page).locator('[data-cat-row]').first();
    expect((await row.boundingBox()).height).toBeLessThanOrEqual(34);
    await expect(row.locator('[data-cat-duplicate]')).toBeHidden();
    await row.hover();
    await row.locator('[data-structure-more]').click();
    const menu = modal(page).locator('[data-structure-menu]');
    for (const proxy of ['show', 'duplicate', 'spread', 'delete']) {
      await expect(menu.locator(`[data-structure-proxy="${proxy}"]`)).toHaveCount(1);
    }
  });
});
