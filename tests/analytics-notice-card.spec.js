// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * The analytics invitation is a card in the bottom-left corner, not a row in the
 * bell: it comes once the what's-new window is out of the way, answers with
 * Turn on, What is recorded? or No thanks, backs off on a schedule when it is
 * left open (× or reading the detail), and stays away once analytics is on, the
 * question is answered or the operator locked telemetry off.
 */

const CARD = '.analytics-notice-card';

async function load(page) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0 && window.DashboardAnalyticsNotice, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.evaluate(() => {
        // A "No" or a snooze said in a test must not reach the shared ./data.
        window.dashboardInstance.saveSettings = ((save) => function (opts, ...rest) {
            if (opts?.keys?.length === 1 && (opts.keys[0] === 'discoverabilityState' || opts.keys[0] === 'quickStart')) return Promise.resolve(true);
            return save.call(this, opts, ...rest);
        })(window.dashboardInstance.saveSettings);
        document.querySelectorAll('.quickstart-card').forEach((el) => el.remove());
        const s = window.dashboardInstance.settings;
        s.analyticsOptIn = false;
        s.quickStart = { ...(s.quickStart || {}), analyticsChoiceMade: false, analyticsAskAfter: 0, analyticsSnoozes: 0 };
    });
}

/** Put the card on screen, as the end of the what's-new window does. */
async function showCard(page) {
    expect(await page.evaluate(() => window.DashboardAnalyticsNotice.render())).toBe(true);
    await expect(page.locator(CARD)).toBeVisible();
}

test.describe('the analytics card', () => {
    test('is a corner card with Turn on, What is recorded? and No thanks, and no row in the bell', async ({ page }) => {
        await load(page);
        await showCard(page);
        const card = page.locator(CARD);
        await expect(card.getByRole('button', { name: 'Turn on' })).toBeVisible();
        await expect(card.getByRole('button', { name: 'What is recorded?' })).toBeVisible();
        await expect(card.getByRole('button', { name: 'No thanks' })).toBeVisible();
        await page.evaluate(() => window.NotificationBell?.refreshAll?.());
        await page.evaluate(() => window.NotificationBell?.open?.());
        await expect(page.locator('.notification-bell-row[data-bell-id="analytics-notice"]')).toHaveCount(0);
    });

    test('being shown starts a cooldown, so a reload past it does not show it again', async ({ page }) => {
        await load(page);
        await showCard(page);
        const state = await page.evaluate(() => {
            const qs = window.dashboardInstance.settings.quickStart;
            return { after: qs.analyticsAskAfter, snoozes: qs.analyticsSnoozes || 0 };
        });
        // One day ahead (SHOWN_COOLDOWN_DAYS), and no step of the snooze schedule used.
        expect(state.after).toBeGreaterThan(Math.floor(Date.now() / 1000) + 23 * 3600);
        expect(state.snoozes).toBe(0);
        expect(await page.evaluate(() => window.DashboardAnalyticsNotice.shouldShow())).toBe(false);
    });

    test('× backs off for three days, then fourteen, then forty-five', async ({ page }) => {
        await load(page);
        const days = [3, 14, 45, 45];
        for (const expected of days) {
            await page.evaluate(() => {
                const qs = window.dashboardInstance.settings.quickStart;
                qs.analyticsAskAfter = 0;
            });
            await showCard(page);
            const before = Math.floor(Date.now() / 1000);
            await page.locator(`${CARD} [data-notice-dismiss]`).click();
            await expect(page.locator(CARD)).toHaveCount(0);
            const after = await page.evaluate(() => window.dashboardInstance.settings.quickStart.analyticsAskAfter);
            expect(after - before).toBeGreaterThanOrEqual(expected * 86400 - 5);
            expect(after - before).toBeLessThanOrEqual(expected * 86400 + 60);
        }
    });

    test('stays away once analytics is on, answered, or locked off by the operator', async ({ page }) => {
        await load(page);
        expect(await page.evaluate(() => {
            window.dashboardInstance.settings.analyticsOptIn = true;
            return window.DashboardAnalyticsNotice.shouldShow();
        })).toBe(false);
        expect(await page.evaluate(() => {
            const s = window.dashboardInstance.settings;
            s.analyticsOptIn = false;
            s.quickStart = { ...s.quickStart, analyticsChoiceMade: true };
            return window.DashboardAnalyticsNotice.shouldShow();
        })).toBe(false);
        expect(await page.evaluate(() => {
            const s = window.dashboardInstance.settings;
            s.quickStart = { ...s.quickStart, analyticsChoiceMade: false };
            const meta = document.createElement('meta');
            meta.name = 'nextdash-telemetry-locked';
            document.head.appendChild(meta);
            return window.DashboardAnalyticsNotice.shouldShow();
        })).toBe(false);
    });

    test('What is recorded? opens the explanation and snoozes the card', async ({ page }) => {
        await load(page);
        await showCard(page);
        await page.locator(CARD).getByRole('button', { name: 'What is recorded?' }).click();
        await expect(page.locator('.analytics-notice-modal-body')).toBeVisible();
        await expect(page.locator(CARD)).toHaveCount(0);
        // Reading is not an answer: the question is still open, only later.
        expect(await page.evaluate(() => window.dashboardInstance.settings.quickStart.analyticsChoiceMade)).toBe(false);
        expect(await page.evaluate(() => window.dashboardInstance.settings.quickStart.analyticsSnoozes)).toBe(1);
    });

    test('No thanks is a real decline: recorded, analytics stays off, never asked again', async ({ page }) => {
        await load(page);
        await showCard(page);
        await page.locator(CARD).getByRole('button', { name: 'No thanks' }).click();
        await expect(page.locator(CARD)).toHaveCount(0);
        expect(await page.evaluate(() => window.dashboardInstance.settings.quickStart.analyticsChoiceMade)).toBe(true);
        expect(await page.evaluate(() => window.dashboardInstance.settings.analyticsOptIn)).toBe(false);
        expect(await page.evaluate(() => window.DashboardAnalyticsNotice.shouldShow())).toBe(false);
    });
});
