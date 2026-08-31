// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * A failed load offers "Retry", not "dashboard.retry".
 *
 * language.t() answers with the key it was given when there is no string behind
 * it, so `t('dashboard.retry') || 'Retry'` never reached its fallback: the key
 * was truthy. With the string missing from all four locale files, every reader
 * who lost the server for a moment — a restart is enough — got a button labelled
 * with an identifier.
 */
test.describe('the retry button on a failed load', () => {
    test('is labelled in words, in every language', async ({ page }) => {
        await markWhatsNewSeen(page);
        await page.goto('/');
        await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
        await dismissOnboardingIfPresent(page);
        await dismissBlockingOverlays(page);

        // The server going away mid-session, which is what a restart looks like
        // from here and how the reader met this button.
        await page.route('**/api/bookmarks?page=*', (route) => route.abort());
        await page.evaluate(() => window.dashboardInstance.data.loadPageBookmarks(
            window.dashboardInstance.currentPageId, { forceFetch: true }));

        const action = page.locator('.app-notification-action');
        await expect(action).toBeVisible({ timeout: 15_000 });
        await expect(action).toHaveText('Retry');

        for (const [language, label] of [['nl', 'Opnieuw'], ['de', 'Erneut versuchen'], ['fr', 'Réessayer'], ['zh', '重试']]) {
            const text = await page.evaluate(async ([lang]) => {
                await window.dashboardInstance.language.loadTranslations(lang);
                return window.dashboardInstance.notifications.tDashboard('retry', 'Retry');
            }, [language]);
            expect(text, `${language} label`).toBe(label);
        }
    });
});

/*
Why it failed, and who is told.

"Failed to load bookmarks for this page." was the whole message, for a 500, for
a 401 after a token change and for a container that had not come back up yet.
And it was raised by loads nobody asked for — the heal after a render and the
revision poll — so a moment's interruption, a laptop waking, a tailnet
reconnecting, all read as a fault in the page.
*/
test.describe('a failed page load', () => {
    test('names the reason when the reader asked for it', async ({ page }) => {
        await markWhatsNewSeen(page);
        await page.goto('/');
        await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
        await dismissOnboardingIfPresent(page);
        await dismissBlockingOverlays(page);

        await page.route('**/api/bookmarks?page=*', (route) => route.fulfill({ status: 503, body: '' }));
        await page.evaluate(() => window.dashboardInstance.data.loadPageBookmarks(
            window.dashboardInstance.currentPageId, { forceFetch: true }));

        const toast = page.locator('.app-notification');
        await expect(toast).toBeVisible({ timeout: 15_000 });
        await expect(toast).toContainText('503');
    });

    test('says nothing when it was the background repairing itself', async ({ page }) => {
        await markWhatsNewSeen(page);
        await page.goto('/');
        await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
        await dismissOnboardingIfPresent(page);
        await dismissBlockingOverlays(page);

        // Clear anything already on screen first. The loud test above leaves its
        // own 503 toast up and the page carries across tests within a file, so
        // without this "says nothing" would be reading that one — and would
        // pass or fail on which test ran before it rather than on this load.
        await page.evaluate(() => window.AppNotification?.hide?.());
        await expect(page.locator('.app-notification.show')).toHaveCount(0);

        // The same failure the loud test uses, so the only difference is who
        // asked for the load.
        await page.route('**/api/bookmarks?page=*', (route) => route.fulfill({ status: 503, body: '' }));
        const result = await page.evaluate(() => window.dashboardInstance.data.loadPageBookmarks(
            window.dashboardInstance.currentPageId, { forceFetch: true, quiet: true }));

        expect(result).toBe(false);
        await page.waitForTimeout(1200);
        await expect(page.locator('.app-notification.show')).toHaveCount(0);
    });
});
