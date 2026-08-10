// @ts-check
const { test, expect } = require('@playwright/test');
const { prepareDashboardInteraction } = require('./e2e-helpers');

/**
 * The one-time Health tutorial — a short guided tour shown the first time the
 * Health view opens, unless the tip has already been marked seen.
 *
 * Most test files mark it seen via dismissBlockingOverlays() so it never gets
 * in the way of unrelated flows; this file is the one place that deliberately
 * leaves it unseen, to exercise the tour itself.
 */

async function openHealthWithoutMarkingTutorialSeen(page) {
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    // discoverabilityState is server-backed (see discoverability-state.js), so
    // it survives across tests that share the same Playwright web server and
    // data dir — an earlier test in this file finishing the tour for real
    // (Skip/Got it/Escape) leaves the tip marked seen for every test after it.
    // Force it back to unseen here rather than assuming a fresh state.
    await page.evaluate(() => {
        const d = window.dashboardInstance;
        if (d?.settings?.onboardingCompleted !== true && d) {
            d.settings.onboardingCompleted = true;
        }
        const state = window.DiscoverabilityState;
        if (state?.exportState) {
            const exported = state.exportState();
            exported.seenTips = (exported.seenTips || []).filter((id) => id !== 'healthTutorialV1');
            state.init?.(exported);
        }
    });
    await page.click('.health-link a.health-link-anchor');
    await page.waitForSelector('#dashboard-layout.health-layout', { timeout: 15_000 });
}

test.describe('health tutorial', () => {
    test('shows on first visit to Health, with six steps', async ({ page }) => {
        await openHealthWithoutMarkingTutorialSeen(page);

        const modal = page.locator('#app-modal.show .health-tutorial-modal');
        await expect(modal).toBeVisible();
        await expect(page.locator('.health-tutorial-progress')).toHaveText('Step 1 of 6');
        await expect(page.locator('.health-tutorial-dot')).toHaveCount(6);
        await expect(page.locator('.health-tutorial-dot.is-active')).toHaveCount(1);
    });

    test('does not show again once seen', async ({ page }) => {
        await openHealthWithoutMarkingTutorialSeen(page);
        await expect(page.locator('#app-modal.show .health-tutorial-modal')).toBeVisible();
        await page.locator('.modal-actions .modal-button', { hasText: 'Skip' }).click();
        await expect(page.locator('#app-modal.show')).toHaveCount(0);

        await page.evaluate(() => window.dashboardInstance.health.closeHealthView());
        await page.click('.health-link a.health-link-anchor');
        await page.waitForTimeout(500);
        await expect(page.locator('#app-modal.show .health-tutorial-modal')).toHaveCount(0);
    });

    test('Next walks through every step in order, Back returns', async ({ page }) => {
        await openHealthWithoutMarkingTutorialSeen(page);

        const titles = [];
        for (let i = 0; i < 6; i += 1) {
            titles.push((await page.locator('.health-tutorial-step-title').textContent())?.trim());
            if (i < 5) {
                await page.locator('.modal-actions .modal-button', { hasText: 'Next' }).click();
                await page.waitForTimeout(120);
            }
        }
        expect(titles).toEqual([
            'Health can do more than "is it up?"',
            'Turn on Monitor',
            'Tell it what "up" actually means',
            'Watch for the page changing shape entirely',
            'Tell it about the backup window',
            'Get told when it actually breaks',
        ]);
        await expect(page.locator('.health-tutorial-progress')).toHaveText('Step 6 of 6');

        // The confirm button reads differently on the last step, and the
        // secondary button becomes Back instead of Skip once stepping forward.
        await expect(page.locator('.modal-actions .modal-button').first()).toHaveText('Got it');
        await expect(page.locator('.modal-actions .modal-button').nth(1)).toHaveText('Back');

        await page.locator('.modal-actions .modal-button', { hasText: 'Back' }).click();
        await page.waitForTimeout(120);
        await expect(page.locator('.health-tutorial-progress')).toHaveText('Step 5 of 6');
    });

    test('finishing on the last step marks it seen too', async ({ page }) => {
        await openHealthWithoutMarkingTutorialSeen(page);
        for (let i = 0; i < 5; i += 1) {
            await page.locator('.modal-actions .modal-button', { hasText: 'Next' }).click();
            await page.waitForTimeout(100);
        }
        await page.locator('.modal-actions .modal-button', { hasText: 'Got it' }).click();
        await expect(page.locator('#app-modal.show')).toHaveCount(0);

        const seen = await page.evaluate(() => window.DiscoverabilityState?.hasSeenTip?.('healthTutorialV1'));
        expect(seen).toBe(true);
    });

    test('dismissing via Escape still marks it seen, not just an explicit button', async ({ page }) => {
        await openHealthWithoutMarkingTutorialSeen(page);
        await expect(page.locator('#app-modal.show .health-tutorial-modal')).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(page.locator('#app-modal.show')).toHaveCount(0);

        const seen = await page.evaluate(() => window.DiscoverabilityState?.hasSeenTip?.('healthTutorialV1'));
        expect(seen).toBe(true);
    });

    test('respects enableSessionTips: false', async ({ page }) => {
        await page.goto('/');
        await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
        await prepareDashboardInteraction(page);
        // prepareDashboardInteraction already marked the tip seen — reset it so
        // this test genuinely exercises the enableSessionTips guard rather than
        // passing for the wrong reason.
        await page.evaluate(() => {
            window.dashboardInstance.settings.enableSessionTips = false;
            const state = window.DiscoverabilityState;
            if (state?.exportState) {
                const exported = state.exportState();
                exported.seenTips = (exported.seenTips || []).filter((id) => id !== 'healthTutorialV1');
                state.init?.(exported);
            }
        });
        await page.click('.health-link a.health-link-anchor');
        await page.waitForSelector('#dashboard-layout.health-layout', { timeout: 15_000 });
        await page.waitForTimeout(500);
        await expect(page.locator('#app-modal.show .health-tutorial-modal')).toHaveCount(0);
    });
});
