const { test, expect } = require('./fixtures');
const { openBookmarksWithHealth } = require('./helpers/bookmarks-health');

/**
 * Pages and categories, managed from the Bookmarks view in a modal built
 * from Structure's own editors.
 */

const modal = (page) => page.locator('[data-structure-modal]');

test.describe('pages and categories modal', () => {
  test('Manage beside the rail\'s Pages opens it on Pages, with a count per page', async ({ page }) => {
    await openBookmarksWithHealth(page, undefined, { view: 'library' });
    await page.locator('#config-bm-rail [data-bm-manage="pages"]').click();
    await expect(modal(page)).toBeVisible();
    await expect(modal(page).locator('[data-pt-tab="pages"]')).toHaveAttribute('aria-selected', 'true');
    await expect(modal(page).locator('[data-page-row]').first()).toBeVisible();
    await expect(modal(page).locator('[data-page-row]').first().locator('.config-tag-count')).toContainText(/\d/);
  });

  test('Manage beside Categories opens it on Categories, and the tabs switch', async ({ page }) => {
    await openBookmarksWithHealth(page, undefined, { view: 'library' });
    await page.locator('#config-bm-rail [data-bm-manage="categories"]').click();
    await expect(modal(page).locator('[data-pt-tab="categories"]')).toHaveAttribute('aria-selected', 'true');
    await expect(modal(page).locator('[data-cat-page]')).toBeVisible();
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

  test('Show on a page row filters the list to it and closes the modal', async ({ page }) => {
    await openBookmarksWithHealth(page, undefined, { view: 'library' });
    await page.locator('#config-bm-rail [data-bm-manage="pages"]').click();
    const row = modal(page).locator('[data-page-row]').first();
    const pageId = await row.getAttribute('data-page-row');
    await row.locator('[data-structure-show]').click();
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
    await modal(page).locator('[data-page-add]').click();
    const last = modal(page).locator('[data-page-row]').last();
    await last.locator('[data-page-delete]').click();
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
