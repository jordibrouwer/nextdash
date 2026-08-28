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

        for (const [language, label] of [['nl', 'Opnieuw'], ['de', 'Erneut versuchen'], ['fr', 'Réessayer']]) {
            const text = await page.evaluate(async ([lang]) => {
                await window.dashboardInstance.language.loadTranslations(lang);
                return window.dashboardInstance.notifications.tDashboard('retry', 'Retry');
            }, [language]);
            expect(text, `${language} label`).toBe(label);
        }
    });
});
