const { test, expect } = require('./fixtures');
const { openBookmarksWithHealth } = require('./helpers/bookmarks-health');
const { captureRowWrites, mergedRow } = require('./config-bookmarks-helpers');

/**
 * Every row in the Bookmarks view says where it stands, as Health's rows do,
 * with its score at the end; bookmarks nobody checks say so too, and can be
 * put under checking in one go.
 */

const rows = (page) => page.locator('#config-bm-list .config-bm-row');
const rowFor = (page, name) => page.locator('#config-bm-list .config-bm-row', { has: page.locator('.config-bm-title', { hasText: name }) }).first();

// The fixture's bookmarks: the first periodic and broken, the second
// monitored, the rest with checking off; one of those on a home address.
async function open(page) {
  return openBookmarksWithHealth(page, undefined, {
    view: 'library',
    prepare: () => {
      const list = window.dashboardInstance.allBookmarks;
      list.forEach((b, i) => {
        b.checkStatus = i === 0;
        b.monitor = i === 1;
      });
      list[list.length - 1].url = 'http://192.168.1.20:8080/';
    },
  });
}

test.describe('bookmarks view: status colours and scores', () => {
  test('every row carries a status, and a bookmark with checking off reads as not checked', async ({ page }) => {
    const { bookmarks } = await open(page);
    await expect(rows(page).first()).toBeVisible();
    const missing = await rows(page).evaluateAll((els) => els.filter((el) => !el.getAttribute('data-lvs-status')).length);
    expect(missing).toBe(0);
    await expect(rowFor(page, bookmarks[0].name)).toHaveAttribute('data-lvs-status', 'bad');
    await expect(rowFor(page, bookmarks[1].name)).toHaveAttribute('data-lvs-status', 'info');
    await expect(rowFor(page, bookmarks[3].name)).toHaveAttribute('data-lvs-status', 'off');
  });

  test('the score closes every row', async ({ page }) => {
    const { bookmarks } = await open(page);
    const row = rowFor(page, bookmarks[0].name);
    await expect(row.locator('.config-bm-row-score')).toHaveText('25');
    const last = await row.evaluate((el) => el.lastElementChild?.classList.contains('config-bm-row-score'));
    expect(last).toBe(true);
    const withScore = await rows(page).evaluateAll((els) => els.filter((el) => el.querySelector('.config-bm-row-score')).length);
    expect(withScore).toBe(await rows(page).count());
  });

  test('Not checked is a view of its own in the rail', async ({ page }) => {
    const { bookmarks } = await open(page);
    await page.locator('#config-bm-rail [data-bm-rail="cleanup"][data-value="nocheck"]').click();
    await expect(rowFor(page, bookmarks[3].name)).toBeVisible();
    await expect(rowFor(page, bookmarks[0].name)).toHaveCount(0);
  });
});

test.describe('bookmarks view: turning on checking', () => {
  test('the toolbar counts the unchecked and the modal turns checking on for them, leaving home addresses out', async ({ page }) => {
    const { bookmarks } = await open(page);
    const unchecked = bookmarks.length - 2;
    const writes = await captureRowWrites(page);
    const button = page.locator('[data-bm-enable-checking]');
    await expect(button).toContainText(String(unchecked));
    await button.click();
    const modal = page.locator('[data-checking-modal]');
    await expect(modal).toBeVisible();
    await expect(modal.locator('[data-checking-mode="periodic"]')).toHaveAttribute('aria-pressed', 'true');
    // The home address is left out by default.
    await expect(modal.locator('[data-checking-apply]')).toContainText(String(unchecked - 1));
    const refreshed = page.waitForRequest((r) => /\/api\/bookmark-health\?refresh=1/.test(r.url()));
    await modal.locator('[data-checking-apply]').click();
    await expect(modal).toHaveCount(0);
    await expect.poll(() => mergedRow(writes, bookmarks[3].url)?.checkStatus).toBe(true);
    expect(mergedRow(writes, bookmarks[bookmarks.length - 1].url)?.checkStatus).toBeUndefined();
    expect(mergedRow(writes, bookmarks[0].url)).toBeNull();
    await refreshed;
  });

  test('Monitor, and the list as it stands, are choices too', async ({ page }) => {
    const { bookmarks } = await open(page);
    const writes = await captureRowWrites(page);
    await page.locator('#config-bm-search').fill(bookmarks[3].name);
    await expect(rows(page)).toHaveCount(1);
    await page.locator('[data-bm-enable-checking]').click();
    const modal = page.locator('[data-checking-modal]');
    await modal.locator('[data-checking-mode="monitor"]').click();
    await modal.locator('[data-checking-scope="shown"]').check();
    await expect(modal.locator('[data-checking-apply]')).toContainText('1');
    await modal.locator('[data-checking-now]').uncheck();
    await modal.locator('[data-checking-apply]').click();
    await expect.poll(() => mergedRow(writes, bookmarks[3].url)?.monitor).toBe(true);
    expect(mergedRow(writes, bookmarks[4].url)).toBeNull();
  });

  test('Escape closes it without changing anything', async ({ page }) => {
    await open(page);
    const writes = await captureRowWrites(page);
    await page.locator('[data-bm-enable-checking]').click();
    await expect(page.locator('[data-checking-modal]')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-checking-modal]')).toHaveCount(0);
    expect(writes).toHaveLength(0);
    expect(await page.evaluate(() => window.dashboardInstance.activeView)).toBe('library');
  });
});
