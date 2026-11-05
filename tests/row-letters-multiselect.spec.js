// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissBlockingOverlays, dismissOnboardingIfPresent, ensureBookmarksDashboardView } = require('./e2e-helpers');

/**
 * Letters with several rows ticked: m and d act on all of them, Ctrl/Cmd+Enter
 * opens them, Ctrl/Cmd+C copies their links, Esc clears. A letter with no bulk
 * form leaves the selection alone and says so.
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
    await expect.poll(() => page.evaluate(() => window.dashboardInstance.keyboardNavigation.currentIndex)).toBeGreaterThanOrEqual(0);
}

/** Tick three rows with the real key: x ticks the row and steps down. */
async function tickThree(page) {
    for (let i = 0; i < 3; i += 1) await page.keyboard.press('x');
    await expect.poll(() => page.evaluate(() => window.dashboardInstance.multiSelect.count())).toBe(3);
    // The cursor stays where x left it, on the next (unticked) row: the strip says
    // 3 selected, so m and d must mean the selection from there too.
}

test.beforeEach(async ({ page }) => {
    await load(page);
    await tickThree(page);
});

test('m opens the bulk move for the three ticked rows, not the row popover', async ({ page }) => {
    await page.evaluate(() => {
        window.__bulkMove = 0;
        window.dashboardInstance.multiSelect.openMovePopover = () => { window.__bulkMove += 1; };
    });
    await page.keyboard.press('m');
    await expect.poll(() => page.evaluate(() => window.__bulkMove), { timeout: 3000 }).toBe(1);
    await expect(page.locator('#move-popover')).toHaveCount(0);
});

test('d asks to delete three and deletes none until confirmed', async ({ page }) => {
    const count = () => page.evaluate(() => (window.dashboardInstance.allBookmarks || window.dashboardInstance.bookmarks || []).length);
    const before = await count();
    await page.keyboard.press('d');
    await expect(page.locator('.modal, #app-modal').filter({ hasText: /3/ }).first()).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#delete-popover')).toHaveCount(0);
    expect(await count()).toBe(before);
    await page.keyboard.press('Escape');
});

test('Ctrl+Enter opens all three in tabs', async ({ page }) => {
    await page.evaluate(() => {
        window.__opened = 0;
        window.dashboardInstance.openBookmarksInNewTabs = (list) => { window.__opened = list.length; };
    });
    await page.keyboard.press('Control+Enter');
    await expect.poll(() => page.evaluate(() => window.__opened), { timeout: 3000 }).toBe(3);
});

test('Ctrl+C copies the three links', async ({ page }) => {
    await page.evaluate(() => {
        window.__copied = 0;
        window.dashboardInstance.multiSelect.copySelectedLinks = () => { window.__copied += 1; };
    });
    await page.keyboard.press('Control+c');
    await expect.poll(() => page.evaluate(() => window.__copied), { timeout: 3000 }).toBe(1);
});

test('t has no bulk form: the selection stays and a message says so', async ({ page }) => {
    await page.evaluate(() => {
        window.__toasts = [];
        window.dashboardInstance.showNotification = (m) => { window.__toasts.push(String(m)); };
    });
    await page.keyboard.press('t');
    await expect.poll(() => page.evaluate(() => window.__toasts.some((m) => /bulk/i.test(m))), { timeout: 3000 }).toBe(true);
    expect(await page.evaluate(() => window.dashboardInstance.multiSelect.count())).toBe(3);
    await expect(page.locator('#tag-popover')).toHaveCount(0);
});

test('Esc clears the selection', async ({ page }) => {
    await page.keyboard.press('Escape');
    await expect.poll(() => page.evaluate(() => window.dashboardInstance.multiSelect.count())).toBe(0);
});

test('with one row ticked the letters still act on the row', async ({ page }) => {
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('x');
    await page.keyboard.press('ArrowUp');
    await expect.poll(() => page.evaluate(() => window.dashboardInstance.multiSelect.count())).toBe(1);
    await page.keyboard.press('t');
    await expect(page.locator('#tag-popover')).toBeVisible({ timeout: 3000 });
});
