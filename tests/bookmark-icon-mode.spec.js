const { test, expect } = require('./fixtures');
const { openBookmarksWithHealth } = require('./helpers/bookmarks-health');

/**
 * A bookmark's icon has the three choices a container's has, in the Bookmarks
 * view's ⋯ menu: an app icon from the sets, the letter, or automatic. The
 * letter is stored as `iconMode: 'letter'`; automatic is no icon and no mode.
 */

const drawer = (page) => page.locator('.lvs-drawer-host[data-lvs-drawer="library"] .lvs-drawer');

async function pick(page, name) {
  await page.locator('#config-bm-list .config-bm-row', { has: page.locator('.config-bm-title', { hasText: name }) }).first().click();
}

async function openMenu(page) {
  await drawer(page).locator('[data-bm-more-toggle]').click();
  await expect(drawer(page).locator('[data-bm-more-menu]')).toBeVisible();
}

/** The bookmark as the server keeps it, found by its address. */
function stored(page, pageId, url) {
  return page.evaluate(async ({ pageId, url }) => {
    const list = await (await fetch(`/api/bookmarks?page=${pageId}`)).json();
    return list.find((b) => b.url === url) || null;
  }, { pageId, url });
}

test.describe('bookmark icon: letter or automatic', () => {
  test('use letter is kept, marked, and automatic takes it back', async ({ page }) => {
    const { bookmarks } = await openBookmarksWithHealth(page, undefined, {
      view: 'library',
      // An icon of its own would win over both; start from none.
      prepare: () => { window.dashboardInstance.allBookmarks[1].icon = ''; },
    });
    const target = await page.evaluate(() => {
      const b = window.dashboardInstance.allBookmarks[1];
      return { pageId: b.pageId, url: b.url };
    });
    await pick(page, bookmarks[1].name);

    await openMenu(page);
    await expect(drawer(page).locator('[data-bm-panel-action="icon-auto"]')).toHaveAttribute('aria-checked', 'true');
    await drawer(page).locator('[data-bm-panel-action="icon-letter"]').click();
    await expect.poll(async () => (await stored(page, target.pageId, target.url))?.iconMode).toBe('letter');

    // The menu says which one is in force, after the panel was redrawn.
    await openMenu(page);
    await expect(drawer(page).locator('[data-bm-panel-action="icon-letter"]')).toHaveAttribute('aria-checked', 'true');
    await expect(drawer(page).locator('[data-bm-panel-action="icon-auto"]')).toHaveAttribute('aria-checked', 'false');

    await drawer(page).locator('[data-bm-panel-action="icon-auto"]').click();
    await expect.poll(async () => (await stored(page, target.pageId, target.url))?.iconMode ?? '').toBe('');
  });

  test('choose app icon opens the picker', async ({ page }) => {
    const { bookmarks } = await openBookmarksWithHealth(page, undefined, { view: 'library' });
    await pick(page, bookmarks[1].name);

    await openMenu(page);
    await drawer(page).locator('[data-bm-panel-action="icon-choose"]').click();
    await expect(page.locator('.icon-set-picker')).toBeVisible({ timeout: 10_000 });
  });
});
