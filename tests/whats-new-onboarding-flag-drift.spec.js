// @ts-check
const { test, expect } = require('./fixtures');

/**
 * The install that fell between the two onboarding flags.
 *
 * Two settings record the same fact — that onboarding is over.
 * `quickStart.dismissed` says the card was closed; `onboardingCompleted` is
 * what every unprompted card checks before it is allowed to appear. They can
 * disagree: a real install was found with the card dismissed and the flag still
 * false, and that install is silent in both directions. Quick start does not
 * run, because it is dismissed. And no unprompted card appears either, because
 * `canShowUnpromptedUi` refuses while `onboardingCompleted` is false.
 *
 * The visible loss is the What's new modal after an upgrade: the release check
 * says "there is something new here" on every single load, the prompt is even
 * scheduled — and then nothing asks, for the lifetime of the install. Nothing
 * in the interface sets the flag either, because the one thing that sets it is
 * dismissing a card that no longer appears.
 *
 * Dismissing the card *is* finishing onboarding, so the two are reconciled the
 * moment the disagreement is noticed.
 *
 * A file of its own: the other What's new specs share a data directory and read
 * each other's leftovers, and this one has to control both flags and the seen
 * release at once.
 */

const OLD_RELEASE = '2026.08-dashboard-release-v1.3.0';
const SEEN_KEY = 'nextdash:last-whats-new-dashboard-release';

test.describe.configure({ mode: 'serial' });

test.describe('onboarding flags that disagree', () => {
    test('an upgrade still shows its release notes, and the flags stop disagreeing', async ({ page }) => {
        await page.goto('/');
        await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });

        // The state the drift leaves behind, written where the app really keeps
        // it: the card dismissed, the flag not set, and an older release read.
        await page.evaluate(async ({ release, key }) => {
            const d = window.dashboardInstance;
            d.settings.quickStart = { ...(d.settings.quickStart || {}), dismissed: true, setupDone: true };
            d.settings.onboardingCompleted = false;
            await d.saveSettings?.();
            window.DiscoverabilityState?.setLastWhatsNewRelease?.(release);
            localStorage.setItem(key, release);
        }, { release: OLD_RELEASE, key: SEEN_KEY });
        await page.waitForTimeout(500);

        await page.goto('/');
        await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });

        await expect(page.locator('.whats-new-modal')).toBeVisible({ timeout: 15_000 });
        // And the disagreement is gone, so the next unprompted card is not
        // refused for a reason the reader cannot see or change.
        expect(await page.evaluate(() =>
            window.dashboardInstance?.settings?.onboardingCompleted)).toBe(true);
    });

    /*
     * The reconciliation must not become a way to skip quick start. A genuine
     * first run has neither flag set, and it still gets the card rather than
     * release notes for a version it has never used.
     */
    test('a first run is untouched: the card still comes, the notes do not', async ({ page }) => {
        await page.goto('/');
        await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
        await page.evaluate(async ({ key }) => {
            const d = window.dashboardInstance;
            d.settings.quickStart = { setupDone: false, dismissed: false, visitedConfig: false, seenCheatsheet: false };
            d.settings.onboardingCompleted = false;
            await d.saveSettings?.();
            localStorage.removeItem(key);
        }, { key: SEEN_KEY });
        await page.waitForTimeout(500);

        await page.goto('/');
        await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
        await page.waitForTimeout(2500);

        expect(await page.evaluate(() =>
            window.dashboardInstance?.settings?.onboardingCompleted)).toBe(false);
        expect(await page.evaluate(() =>
            Boolean(document.querySelector('.whats-new-modal')?.offsetParent))).toBe(false);
    });
});
