// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * Tag review is offered as a quiet row in the bell (Clean up), not as a corner
 * card: it appears from ten proposals, "No" hides it until one more proposal
 * has come up, and there are no postponing buttons.
 */

const ROW = '.notification-bell-row[data-bell-id="tag-suggestions-notice"]';

async function load(page) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0 && window.NotificationBell && window.TagSuggestionsNotice, null, { timeout: 15_000 });
    await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.evaluate(() => {
        // A "No" said in a test must not reach the shared ./data.
        window.dashboardInstance.saveSettings = ((save) => function (opts, ...rest) {
            // schedulePersist() runs through the module's own closure, so only the
            // save can be held back: the shared ./data keeps no mark of a test.
            if (opts?.keys?.length === 1 && opts.keys[0] === 'discoverabilityState') return Promise.resolve(true);
            return save.call(this, opts, ...rest);
        })(window.dashboardInstance.saveSettings);
        window.dashboardInstance.settings.enableTagSuggestionNotice = true;
        // The engine itself is not under test: only what the row does with a count.
        window.__proposals = 12;
        window.TagSuggestions.suggest = () => Array.from({ length: window.__proposals }, (_, i) => ({ key: String(i) }));
    });
}

async function openBell(page) {
    await page.evaluate(() => window.NotificationBell.refreshAll());
    await page.evaluate(() => window.NotificationBell.open());
}

test.describe('tag review in the bell', () => {
    test('shows the count and a Start button, and nothing in the corner', async ({ page }) => {
        await load(page);
        await openBell(page);
        const row = page.locator(ROW);
        await expect(row).toBeVisible();
        await expect(row).toContainText('12 bookmarks could take a tag');
        await expect(page.locator('.tag-suggestions-notice-card')).toHaveCount(0);
        await expect(row.getByRole('button', { name: /Not today|Remind me/ })).toHaveCount(0);
        await expect(row.getByRole('button', { name: 'Start' })).toBeVisible();
    });

    test('stays quiet below ten and when the setting is off', async ({ page }) => {
        await load(page);
        expect(await page.evaluate(() => { window.__proposals = 9; return window.TagSuggestionsNotice.state(); })).toBeNull();
        expect(await page.evaluate(() => {
            window.__proposals = 12;
            window.dashboardInstance.settings.enableTagSuggestionNotice = false;
            return window.TagSuggestionsNotice.state();
        })).toBeNull();
    });

    test('No hides it, and one more proposal brings it back', async ({ page }) => {
        await load(page);
        await openBell(page);
        await page.locator(ROW).getByRole('button', { name: 'No', exact: true }).click();
        await expect(page.locator(ROW)).toHaveCount(0);

        await page.evaluate(() => { window.__proposals = 12; });
        await openBell(page);
        await expect(page.locator(ROW)).toHaveCount(0);

        await page.evaluate(() => { window.__proposals = 13; });
        await openBell(page);
        await expect(page.locator(ROW)).toBeVisible();
        await expect(page.locator(ROW)).toContainText('13 bookmarks');
    });

    test('Start opens the review tab in Config', async ({ page }) => {
        await load(page);
        await openBell(page);
        await page.locator(ROW).getByRole('button', { name: 'Start' }).click();
        await expect.poll(() => page.evaluate(() => (window.dashboardInstance.config.instance || window.dashboardInstance.config).bmTab), { timeout: 10_000 }).toBe('tag-suggestions');
    });
});
