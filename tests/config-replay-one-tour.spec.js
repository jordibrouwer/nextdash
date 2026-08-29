const { test, expect } = require('./fixtures');
const { prepareDashboardInteraction } = require('./e2e-helpers');

/*
 * One tour at a time.
 *
 * Six tours exist and five of them could be seen exactly once: Health, Inbox,
 * Fresh, Widgets and the column-spread hint each record a tip id the first time
 * they run and never offer themselves again. The only way back was "Show
 * quick-start card again", which empties the whole seen list and brings the
 * welcome card with it — far more than someone means by "show me that one
 * again".
 *
 * Each tour now has its own button. It clears that one id and says where the
 * tour will turn up, because none of them can start from here: they belong to a
 * view, and a tour that silently did nothing on click is the failure this was
 * meant to end.
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
}

test.describe('a single tour can be replayed', () => {
    test.afterEach(async ({ page }) => {
        await page.evaluate(async (previous) => {
            const d = window.dashboardInstance;
            if (!d?.settings) return;
            window.DiscoverabilityState?.init?.(previous || {});
            await d.saveSettings?.();
        }, stateBefore).catch(() => { /* the page may already be closed */ });
        stateBefore = null;
    });

    test('clears that tour alone, and leaves the others seen', async ({ page }) => {
        await openBehaviorGeneral(page);

        await page.evaluate(() => {
            const s = window.DiscoverabilityState;
            s.markTipSeen('healthTutorialV1', { persist: false });
            s.markTipSeen('inboxTutorialV1', { persist: false });
            s.markTipSeen('tipSearch', { persist: false });
        });

        // The panel redraws from the seen list, so the buttons know which
        // tours are replayable.
        await page.evaluate(() => window.dashboardInstance.config.render());
        const health = page.locator('[data-replay-tour="healthTutorialV1"]');
        await expect(health).toBeVisible({ timeout: 10_000 });
        await health.click();

        await expect.poll(() => page.evaluate(
            () => window.DiscoverabilityState.hasSeenTip('healthTutorialV1')
        ), { timeout: 10_000 }).toBe(false);

        // The others are untouched — that is the whole difference from the
        // reset button sitting above these.
        expect(await page.evaluate(() => window.DiscoverabilityState.hasSeenTip('inboxTutorialV1'))).toBe(true);
        expect(await page.evaluate(() => window.DiscoverabilityState.hasSeenTip('tipSearch'))).toBe(true);
    });

    test('a tour nobody has seen is not offered as a replay', async ({ page }) => {
        await openBehaviorGeneral(page);

        await page.evaluate(() => {
            window.DiscoverabilityState.init({ seenTips: ['healthTutorialV1'] });
            window.dashboardInstance.config.render();
        });

        // Seen: replayable. Unseen: shown, but not as a button that pretends to
        // put back something that was never taken away.
        await expect(page.locator('[data-replay-tour="healthTutorialV1"]')).toBeEnabled({ timeout: 10_000 });
        await expect(page.locator('[data-replay-tour="inboxTutorialV1"]')).toBeDisabled();
    });
});
