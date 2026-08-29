const { test, expect } = require('./fixtures');
const { prepareDashboardInteraction } = require('./e2e-helpers');

/**
 * "Show quick-start card again" only cleared onboardingCompleted, while its own
 * confirmation dialog promised to replay "the welcome tour and tips". Those
 * live in discoverabilityState.seenTips, which the reset never touched — so the
 * Health and inbox tours, and every keyboard tip already shown, stayed gone.
 */

/**
 * What discoverabilityState looked like before a test emptied it, so afterEach
 * can put it back. Captured rather than assumed: the specs that ran earlier in
 * the suite have marked their own tips seen, and leaving the list empty means
 * every later spec meets a one-time modal it was not expecting.
 */
let stateBefore = null;

async function openBehaviorGeneral(page) {
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await prepareDashboardInteraction(page);
    stateBefore = await page.evaluate(() => window.DiscoverabilityState.exportState());
    await page.evaluate(() => window.dashboardInstance.config.openConfigView('behavior'));
    await page.waitForSelector('[data-behavior-tab="general"]', { timeout: 15_000 });
    await page.locator('[data-behavior-tab="general"]').click();
    await expect(page.locator('[data-behavior-action="reset-onboarding"]')).toBeVisible();
}

/** Click it and answer the confirmation the same way a user would. */
async function resetOnboarding(page) {
    await page.evaluate(() => {
        window.dashboardInstance.config.confirmAction = async () => true;
    });
    await page.locator('[data-behavior-action="reset-onboarding"]').click();
}

test.describe('replaying the tour also replays the tips', () => {
    // This is one of the few specs that deliberately writes global state to the
    // server: the whole point is that onboardingCompleted goes false and the
    // seen list empties. Left that way, every later spec in the run meets the
    // first-run onboarding and a fresh set of one-time modals. Put both back.
    test.afterEach(async ({ page }) => {
        await page.evaluate(async (previous) => {
            const d = window.dashboardInstance;
            if (!d?.settings) return;
            d.settings.onboardingCompleted = true;
            window.DiscoverabilityState?.init?.(previous || {});
            await d.saveSettings?.();
        }, stateBefore).catch(() => { /* the page may already be closed */ });
        stateBefore = null;
    });

    test('the reset clears every seen tip and the tip gap', async ({ page }) => {
        await openBehaviorGeneral(page);

        // The state a real session arrives in: both tours done, a keyboard tip
        // shown recently, so the next one is held back for days.
        await page.evaluate(() => {
            const s = window.DiscoverabilityState;
            s.markTipSeen('healthTutorialV1', { persist: false });
            s.markTipSeen('inboxTutorialV1', { persist: false });
            s.markTipSeen('tipSearch', { persist: false });
            s.setTipsNotBefore(Date.now() + 3 * 86400000, { persist: false });
        });
        expect(await page.evaluate(() => window.DiscoverabilityState.getSeenTips().length))
            .toBeGreaterThan(2);

        await resetOnboarding(page);

        await expect.poll(() => page.evaluate(
            () => window.DiscoverabilityState.getSeenTips()
        ), { timeout: 10_000 }).toEqual([]);
        expect(await page.evaluate(() => window.DiscoverabilityState.getTipsNotBefore())).toBe(0);
        expect(await page.evaluate(() => window.dashboardInstance.settings.onboardingCompleted))
            .toBe(false);
    });

    /*
     * The dialog promises the welcome tour, and the card is the tour. Clearing
     * onboardingCompleted alone did not bring it back: quick-start checks
     * `quickStart.dismissed`, which stayed true, so the reader was told the
     * tour would replay and nothing appeared. Worse, the two flags were then in
     * disagreement -- dismissed, but not completed -- which is the state that
     * silences every unprompted card, the What's new modal after an upgrade
     * included.
     */
    test('the card itself comes back, not just the flag', async ({ page }) => {
        await openBehaviorGeneral(page);
        await page.evaluate(async () => {
            const d = window.dashboardInstance;
            d.settings.quickStart = { ...(d.settings.quickStart || {}), dismissed: true, setupDone: true };
            d.settings.onboardingCompleted = true;
            await d.saveSettings?.();
        });

        await resetOnboarding(page);
        await expect.poll(() => page.evaluate(
            () => window.dashboardInstance.settings.quickStart?.dismissed
        ), { timeout: 10_000 }).toBe(false);

        // And on the next visit it is actually on screen.
        await page.goto('/');
        await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
        await expect(page.locator('.quickstart-card')).toBeVisible({ timeout: 15_000 });
    });

    test('it survives the round trip to the server', async ({ page }) => {
        await openBehaviorGeneral(page);
        await page.evaluate(() => {
            window.DiscoverabilityState.markTipSeen('healthTutorialV1', { persist: false });
        });
        await resetOnboarding(page);
        await expect.poll(() => page.evaluate(
            () => window.DiscoverabilityState.getSeenTips()
        ), { timeout: 10_000 }).toEqual([]);

        // Read it back from /api/settings rather than from memory: the whole
        // point is that the next session sees the tours again.
        const stored = await page.evaluate(async () => {
            const res = await fetch('/api/settings');
            const body = await res.json();
            return body.discoverabilityState?.seenTips ?? [];
        });
        expect(stored).toEqual([]);
    });

    // The one-time hints attached to individual settings are a different thing:
    // they are dismissed where they appear, not part of the dashboard's
    // onboarding, and bringing them all back would re-nag on every config panel.
    test('setting promos are left alone', async ({ page }) => {
        await openBehaviorGeneral(page);
        await page.evaluate(() => {
            window.DiscoverabilityState.markSettingPromoSeen('probePromo', { persist: false });
        });

        await resetOnboarding(page);

        await expect.poll(() => page.evaluate(
            () => window.DiscoverabilityState.getSeenTips()
        ), { timeout: 10_000 }).toEqual([]);
        expect(await page.evaluate(
            () => window.DiscoverabilityState.hasSeenSettingPromo('probePromo')
        )).toBe(true);
    });

    test('the hint says the tours come back, not just the card', async ({ page }) => {
        await openBehaviorGeneral(page);
        // The note in the button's own panel. Filtering on "quick-start card"
        // alone would also match the group note above it, which says the same
        // words about something else — and the panel now holds a second note,
        // for the per-tour replay row, so this takes the first rather than
        // both.
        const hint = page.locator('.config-panel')
            .filter({ has: page.locator('[data-behavior-action="reset-onboarding"]') })
            .locator('.config-panel-note')
            .first();
        await expect(hint).toContainText(/tours/i);
        await expect(hint).toContainText(/keyboard tips/i);
    });
});
