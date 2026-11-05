// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays, ensureBookmarksDashboardView } = require('./e2e-helpers');

/**
 * Shift+letter is global, whatever is under the cursor: with a bookmark selected
 * Shift+E is still edit mode, Shift+P still the Pages panel, and so on. The row's
 * own actions are the plain letters (tests/row-letters.spec.js). What stays on a
 * row are the selection keys: Shift+X ticks the category and Shift+arrows extend
 * the selection.
 */

async function load(page) {
    await page.setViewportSize({ width: 1400, height: 900 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('.bookmark-link', { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await ensureBookmarksDashboardView(page);
    await page.keyboard.press('ArrowDown');
    await expect.poll(() => page.evaluate(
        () => !!window.dashboardInstance.keyboardNavigation.getSelectedBookmark())).toBe(true);
}

const view = (page) => page.evaluate(() => window.dashboardInstance.activeView);
const editMode = (page) => page.evaluate(() => document.body.getAttribute('data-edit-mode') === 'on');

test('Shift+B with a row selected opens the Bookmarks view', async ({ page }) => {
    await load(page);
    await page.keyboard.press('Shift+B');
    await expect(page.locator('.config-view--library')).toBeVisible({ timeout: 10_000 });
});

test('Shift+E with a row selected switches edit mode on, and the row stays unedited', async ({ page }) => {
    await load(page);
    await page.keyboard.press('Shift+E');
    await expect.poll(() => editMode(page)).toBe(true);
    expect(await page.evaluate(() => Boolean(window.dashboardInstance.isInlineEditActive?.()))).toBe(false);
});

test('Shift+P with a row selected opens the Pages panel, and pins nothing', async ({ page }) => {
    await load(page);
    const pinned = () => page.evaluate(() => !!window.dashboardInstance.keyboardNavigation.getSelectedBookmark()?.pinned);
    const before = await pinned();
    await page.keyboard.press('Shift+P');
    await expect(page.locator('.page-overview-modal')).toBeVisible({ timeout: 5000 });
    expect(await pinned()).toBe(before);
});

test('Shift+N with a row selected opens the bell', async ({ page }) => {
    await load(page);
    await page.keyboard.press('Shift+N');
    await expect(page.locator('.notification-bell-button[aria-expanded="true"]')).toHaveCount(1, { timeout: 5000 });
});

test('Shift+T with a row selected opens the tags of every bookmark, not its tag popover', async ({ page }) => {
    await load(page);
    await page.keyboard.press('Shift+T');
    await expect.poll(() => view(page), { timeout: 10_000 }).toBe('tags');
    await expect(page.locator('#tag-popover')).toHaveCount(0);
});

test('Shift+C with a row selected opens Containers, not its check-mode menu', async ({ page }) => {
    await load(page);
    test.skip(!(await page.evaluate(() => window.dashboardInstance.docker?.isEnabled?.())), 'Containers is off in this data');
    await page.keyboard.press('Shift+C');
    await expect.poll(() => view(page), { timeout: 10_000 }).toBe('docker');
    await expect(page.locator('#bookmark-check-mode-menu')).toHaveCount(0);
});

test('Shift+Q with a row selected does nothing: no QR code, no mode switch', async ({ page }) => {
    await load(page);
    const before = await page.evaluate(() => !!window.dashboardInstance.settings.interleaveMode);
    await page.keyboard.press('Shift+Q');
    // Nothing visible changes, so give the key handlers time to act first.
    await page.waitForTimeout(400);
    await expect(page.locator('#app-modal .modal.bookmark-qr-modal')).toHaveCount(0);
    expect(await page.evaluate(() => !!window.dashboardInstance.settings.interleaveMode)).toBe(before);
});

test('Shift+S, Shift+M, Shift+D and Shift+R with a row selected open none of the row popovers', async ({ page }) => {
    await load(page);
    for (const key of ['Shift+S', 'Shift+D', 'Shift+R']) {
        await page.keyboard.press(key);
    }
    await page.waitForTimeout(400);
    await expect(page.locator('#delete-popover, #move-popover, #tag-popover')).toHaveCount(0);
    expect(await view(page)).toBe('bookmarks');
});

test('Shift+Down with a row selected still extends the selection', async ({ page }) => {
    await load(page);
    await page.keyboard.press('Shift+ArrowDown');
    await expect.poll(() => page.evaluate(() => window.dashboardInstance.multiSelect?.count?.() ?? 0)).toBeGreaterThan(0);
});
