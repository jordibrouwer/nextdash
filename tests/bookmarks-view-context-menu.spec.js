const { test, expect } = require('./fixtures');
const { openBookmarksWithHealth } = require('./helpers/bookmarks-health');

/**
 * The row menu in the Bookmarks view: fewer entries, each one worth its
 * place; the rest is in the side panel.
 */

const menu = (page) => page.locator('#config-bm-context-menu');

async function openMenu(page, name) {
  const row = page.locator('#config-bm-list .config-bm-row', { has: page.locator('.config-bm-title', { hasText: name }) }).first();
  await row.click({ button: 'right' });
  await expect(menu(page)).toBeVisible();
}

test.describe('bookmarks view: the row menu', () => {
  test('keeps what the view is worked with, and drops the rest', async ({ page }) => {
    const { bookmarks } = await openBookmarksWithHealth(page, undefined, { view: 'library' });
    await openMenu(page, bookmarks[1].name);
    const ids = await menu(page).locator('[data-action]').evaluateAll((els) => els.map((el) => el.getAttribute('data-action')));
    for (const gone of ['pin', 'dashboard', 'title', 'favicon', 'select', 'recheck', 'save-copy', 'archive']) expect(ids).not.toContain(gone);
    for (const kept of ['open-new-tab', 'copy-url', 'edit', 'check-mode', 'delete']) expect(ids).toContain(kept);
  });
});
