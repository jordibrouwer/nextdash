// @ts-check
const { test, expect } = require('./fixtures');
const { prepareDashboardInteraction } = require('./e2e-helpers');

/**
 * The views are Shift+letter, so bare letters stay free for the shortcut search.
 */
test.describe('Shift+letter views', () => {
    test('Shift+I opens the inbox, and 0 still does too', async ({ page }) => {
        await page.goto('/');
        await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
        await prepareDashboardInteraction(page);

        await page.keyboard.press('Shift+I');
        await expect.poll(() => page.evaluate(() => window.dashboardInstance?.activeView)).toBe('inbox');

        await page.keyboard.press('Escape');
        await expect.poll(() => page.evaluate(() => window.dashboardInstance?.activeView)).toBe('bookmarks');

        // '0' is superseded by Shift+I and no longer documented, but must keep
        // working for anyone who already has the habit.
        await page.keyboard.press('0');
        await expect.poll(() => page.evaluate(() => window.dashboardInstance?.activeView)).toBe('inbox');
    });

    test('bare h and i still open the shortcut search', async ({ page }) => {
        await page.goto('/');
        await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
        await prepareDashboardInteraction(page);

        // The whole reason these views are Shift+letter: bare letters reach a bookmark
        // by its shortcut letter. Taking 'h' or 'i' would make those bookmarks
        // unreachable.
        await page.keyboard.press('h');
        await expect(page.locator('#shortcut-search.show')).toBeVisible();
        expect(await page.evaluate(() => window.dashboardInstance.activeView)).toBe('bookmarks');

        await page.keyboard.press('Escape');
        await expect(page.locator('#shortcut-search.show')).toBeHidden();

        await page.keyboard.press('i');
        await expect(page.locator('#shortcut-search.show')).toBeVisible();
        expect(await page.evaluate(() => window.dashboardInstance.activeView)).toBe('bookmarks');
    });

    test('the cheat sheet teaches Shift+I and Shift+H, not 0', async ({ page }) => {
        await page.goto('/');
        await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
        await prepareDashboardInteraction(page);

        await page.keyboard.press('F1');
        const sheet = page.locator('.modal-overlay.show');
        await expect(sheet).toBeVisible();

        // The rendered label collapses the spaces around '+'.
        await expect(sheet).toContainText('Shift+I');
        await expect(sheet).toContainText('Shift+H');
        await expect(sheet).toContainText('1–9');
        // '0' still works but is on the way out; documenting it would teach a
        // shortcut that is going away.
        await expect(sheet).not.toContainText('0 = Inbox');

        // The Health view went; its section went with it.
        await expect(sheet.locator('summary.cheat-sheet-group-title', { hasText: /Health view/i })).toHaveCount(0);

        const inboxGroup = sheet.locator('.cheat-sheet-group').filter({
            has: page.locator('summary.cheat-sheet-group-title', { hasText: /Inbox view/i }),
        });
        await expect(inboxGroup).toContainText(/triage/i);
        await expect(inboxGroup).toContainText(/snooze/i);

        const triageGroup = sheet.locator('.cheat-sheet-group').filter({
            has: page.locator('summary.cheat-sheet-group-title', { hasText: /Inbox triage/i }),
        });
        await expect(triageGroup).toContainText(/mark as read|Keep and mark/i);
    });
});
