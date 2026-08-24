// @ts-check
const { test, expect } = require('@playwright/test');
const { dismissOnboardingIfPresent } = require('./e2e-helpers');

/**
 * A new version shows its release notes once, by itself.
 *
 * The machinery for it has been in place for a long time — the stub carries a
 * release token, the modal marks it seen on close, and the dashboard schedules
 * a prompt after onboarding — but nothing pinned the behaviour, and the manual
 * claimed the opposite ("release notes never open by themselves"). So this is
 * the contract, written down: an install that has read an older release gets
 * the modal on its next visit, once, and never again for that release.
 *
 * A browser meeting nextDash for the first time is deliberately exempt: quick
 * start runs that session, and a first-run tour interrupted by release notes
 * for a version the reader never used would be noise.
 */

const OLD_RELEASE = '2026.08-dashboard-release-v1.3.0';
const SEEN_KEY = 'nextdash:last-whats-new-dashboard-release';

/**
 * A browser that has used nextDash before, and last read an older release.
 *
 * Two loads, because both halves of the state matter. The first records the
 * older release — in localStorage *and* in the settings, which is where
 * DiscoverabilityState mirrors it and therefore what an upgraded install really
 * looks like — and finishes onboarding, which suppresses the prompt by design
 * while quick start is running. The second load is the visit under test.
 */
async function visitAfterUpgrade(page) {
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await page.evaluate((release) => {
        window.DiscoverabilityState?.setLastWhatsNewRelease?.(release);
    }, OLD_RELEASE);
    await dismissOnboardingIfPresent(page);
    // Written to the server, not only to this page: specs share a data
    // directory, so a run that left onboarding unfinished would start quick
    // start again on the next load.
    await page.evaluate(() => window.dashboardInstance.config.setBehavior('onboardingCompleted', true, ''));
    await page.waitForTimeout(600);

    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
}

test.describe('release notes on a new version', () => {
    test('open by themselves, once, and mark the release read', async ({ page }) => {
        await visitAfterUpgrade(page);

        const modal = page.locator('.whats-new-modal');
        await expect(modal).toBeVisible({ timeout: 20_000 });
        // The release it leads with is the one that just shipped.
        await expect(modal).toContainText(await page.evaluate(() =>
            String(window.NEXTDASH_WHATS_NEW_RELEASE).replace(/^.*-v/, 'v')));

        // Closing it is what records the release as read.
        await page.keyboard.press('Escape');
        await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), SEEN_KEY), { timeout: 10_000 })
            .toBe(await page.evaluate(() => window.NEXTDASH_WHATS_NEW_RELEASE));

        // And a later visit stays quiet: once is the whole promise. The pause is
        // for the analytics card, which is scheduled as the notes close and
        // would otherwise still be settling when the next load starts.
        await page.waitForTimeout(1500);
        await page.goto('/');
        await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
        await page.waitForTimeout(3000);
        // The shell stays in the DOM once it has been built, and the analytics
        // card may take the same modal afterwards — so the question is whether
        // the release notes themselves are on screen.
        expect(await page.evaluate(() =>
            Boolean(document.querySelector('.whats-new-modal')?.offsetParent))).toBe(false);
    });

    test('an install already on this release is never interrupted', async ({ page }) => {
        await page.goto('/');
        await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
        // Read, in both places the answer is kept.
        await page.evaluate((key) => {
            localStorage.setItem(key, window.NEXTDASH_WHATS_NEW_RELEASE);
            window.DiscoverabilityState?.setLastWhatsNewRelease?.(window.NEXTDASH_WHATS_NEW_RELEASE);
        }, SEEN_KEY);
        await dismissOnboardingIfPresent(page);

        await page.goto('/');
        await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
        await page.waitForTimeout(3000);
        // The shell stays in the DOM once it has been built, and the analytics
        // card may take the same modal afterwards — so the question is whether
        // the release notes themselves are on screen.
        expect(await page.evaluate(() =>
            Boolean(document.querySelector('.whats-new-modal')?.offsetParent))).toBe(false);
    });
});
