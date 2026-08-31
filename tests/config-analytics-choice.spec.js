// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * Setting analytics in config counts as answering the opt-in question.
 *
 * The opt-in card decides whether to reappear from quickStart.analyticsChoiceMade,
 * and only the card itself used to write it. So a user who deliberately answered
 * in config still read as "never chose", and got asked again — including someone
 * who had just turned analytics off.
 */
async function openConfig(page) {
    await page.setViewportSize({ width: 1400, height: 900 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => !!window.dashboardInstance?.config, null, { timeout: 20_000 });
}

/** Forget any previous answer so each test observes the config path alone. */
async function clearChoice(page) {
    await page.evaluate(async () => {
        const d = window.dashboardInstance;
        d.settings.quickStart = d.settings.quickStart || {};
        d.settings.quickStart.analyticsChoiceMade = false;
        d.settings.analyticsOptIn = false;
        await d.saveSettings();
    });
}

const choiceState = (page) => page.evaluate(() => ({
    made: window.dashboardInstance.settings.quickStart?.analyticsChoiceMade,
    // AnalyticsAskAfter is `omitempty` on the Go side, so a zero does not
    // survive the round trip and comes back undefined. Absent and zero mean the
    // same thing here — no snooze left to honour — which is how every reader of
    // this field already treats it: `Number(qs.analyticsAskAfter) || 0`.
    askAfter: Number(window.dashboardInstance.settings.quickStart?.analyticsAskAfter) || 0,
    optIn: window.dashboardInstance.settings.analyticsOptIn,
}));

test.describe('analytics opt-in choice recorded from config', () => {
    test('opting in records the choice', async ({ page }) => {
        await openConfig(page);
        await clearChoice(page);
        expect((await choiceState(page)).made).toBe(false);

        await page.evaluate(async () => {
            await window.dashboardInstance.config.setBehavior('analyticsOptIn', true, '');
        });

        const after = await choiceState(page);
        expect(after.optIn).toBe(true);
        expect(after.made).toBe(true);
        expect(after.askAfter).toBe(0);
    });

    test('declining records the choice, so the card does not ask again', async ({ page }) => {
        await openConfig(page);
        await clearChoice(page);

        await page.evaluate(async () => {
            await window.dashboardInstance.config.setBehavior('analyticsOptIn', false, '');
        });

        const after = await choiceState(page);
        expect(after.optIn).toBe(false);
        // The point of the fix: declining is an answer too.
        expect(after.made).toBe(true);
        expect(after.askAfter).toBe(0);
    });

    test('the recorded choice survives a reload', async ({ page }) => {
        await openConfig(page);
        await clearChoice(page);
        await page.evaluate(async () => {
            await window.dashboardInstance.config.setBehavior('analyticsOptIn', false, '');
        });

        await page.reload();
        await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
        await page.waitForFunction(() => !!window.dashboardInstance?.settings, null, { timeout: 20_000 });

        // Persisted server-side, not just set on the in-memory object.
        expect((await choiceState(page)).made).toBe(true);
    });

    test('changing another setting leaves the choice untouched', async ({ page }) => {
        await openConfig(page);
        await clearChoice(page);

        await page.evaluate(async () => {
            await window.dashboardInstance.config.setBehavior('dashboardTitle', 'unrelated', '');
        });

        // Only analyticsOptIn answers the analytics question.
        expect((await choiceState(page)).made).toBe(false);
    });
});
