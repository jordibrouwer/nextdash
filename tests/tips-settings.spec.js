// @ts-check
const { test, expect } = require('./fixtures');
const { dismissOnboardingIfPresent, dismissBlockingOverlays, markWhatsNewSeen } = require('./e2e-helpers');

/**
 * Config → Behavior → Onboarding: how often keyboard tips come, and whether a
 * section offers its tour on the first visit. Both are read where the thing is
 * decided, so the tests set the setting and ask that decision.
 */

async function open(page) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
}

test.describe('tips settings', () => {
    test('weekly spaces tips a week apart, daily a day', async ({ page }) => {
        await open(page);
        const allowed = (frequency, agoMs) => page.evaluate(({ frequency, agoMs }) => {
            window.dashboardInstance.settings.sessionTipsFrequency = frequency;
            const state = window.DiscoverabilityState;
            const exported = state.exportState();
            exported.tipsShownAt = [Date.now() - agoMs];
            exported.tipsNotBefore = 0;
            state.init(exported);
            return state.tipsAllowedNow();
        }, { frequency, agoMs });
        const DAY = 24 * 60 * 60 * 1000;
        expect(await allowed('daily', 2 * DAY)).toBe(true);
        expect(await allowed('daily', 0.5 * DAY)).toBe(false);
        expect(await allowed('weekly', 2 * DAY)).toBe(false);
        expect(await allowed('weekly', 8 * DAY)).toBe(true);
        // A browser that never chose is daily.
        expect(await allowed('', 2 * DAY)).toBe(true);
    });

    test('the Onboarding group carries the frequency and the tours switch', async ({ page }) => {
        await open(page);
        await page.evaluate(async () => {
            const c = window.dashboardInstance.config;
            c.behaviorTab = 'privacy';
            await c.openConfigView('behavior');
        });
        const group = page.locator('#config-section-panel');
        await expect(group.locator('[data-behavior-field="sessionTipsFrequency"]')).toBeVisible();
        await expect(group.locator('[data-behavior-field="enableSectionTours"]')).toBeVisible();
        await group.locator('[data-behavior-field="sessionTipsFrequency"]').selectOption('weekly');
        expect(await page.evaluate(() => window.dashboardInstance.settings.sessionTipsFrequency)).toBe('weekly');
    });

    for (const [name, on] of [['offers the tour on a first visit while the switch is on', true], ['keeps a first visit quiet once the switch is off', false]]) {
        test(`section tours: ${name}`, async ({ page }) => {
            // The fixture keeps every tour seen unless a spec asks for it.
            await page.addInitScript(() => { window.__e2eWantTours = ['monitoringTutorialV1']; });
            await open(page);
            await page.evaluate((enabled) => {
                const d = window.dashboardInstance;
                d.settings.enableSessionTips = true;
                d.settings.enableSectionTours = enabled;
                const state = window.DiscoverabilityState;
                state.forgetTip?.('monitoringTutorialV1', { persist: false });
                const exported = state.exportState();
                exported.seenTips = (exported.seenTips || []).filter((id) => id !== 'monitoringTutorialV1');
                state.init?.(exported);
            }, on);
            await page.evaluate(async () => { await window.dashboardInstance.config.openConfigView('monitoring'); });
            const tour = page.locator('#app-modal.show .monitoring-tutorial-modal');
            if (on) {
                await expect(tour).toBeVisible({ timeout: 15_000 });
            } else {
                // A fixed wait: the tour must stay away, so there is nothing to wait for.
                await page.waitForTimeout(900);
                await expect(tour).toHaveCount(0);
            }
        });
    }
});
