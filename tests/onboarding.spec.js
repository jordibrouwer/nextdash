// @ts-check
const { test, expect } = require('@playwright/test');
const {
    openOnboarding,
    advanceOnboardingToStep,
    getOnboardingProgress,
} = require('./e2e-helpers');

test.describe('onboarding wizard', () => {
    test('skip at step 1 closes tour', async ({ page }) => {
        const pageErrors = [];
        page.on('pageerror', (e) => pageErrors.push(e.message));

        await openOnboarding(page);
        await expect(page.locator('.onboarding-progress')).toHaveText('1/8');

        await page.locator('.onboarding-skip').click();
        await expect(page.locator('.onboarding-card')).toHaveCount(0, { timeout: 5000 });
        await expect(page.locator('.onboarding-overlay')).toHaveCount(0);
        await expect.poll(() => page.evaluate(() => document.body.classList.contains('guided-flow-locked'))).toBe(false);

        await expect.poll(() => page.evaluate(() => ({
            showTips: document.body.getAttribute('data-show-tips'),
            delayMs: window.TipsPolicy?.getTipsStartDelayMs?.() ?? 0,
        }))).toEqual({
            showTips: 'false',
            delayMs: expect.any(Number),
        });
        const delayMs = await page.evaluate(() => window.TipsPolicy?.getTipsStartDelayMs?.() ?? 0);
        expect(delayMs).toBeGreaterThan(0);
        expect(delayMs).toBeLessThanOrEqual(60_000);

        expect(pageErrors).toEqual([]);
    });

    test('finish on last step closes tour', async ({ page }) => {
        const pageErrors = [];
        page.on('pageerror', (e) => pageErrors.push(e.message));

        await openOnboarding(page);
        const { total } = await getOnboardingProgress(page);
        expect(total).toBeGreaterThan(1);

        await advanceOnboardingToStep(page, total);
        await expect(page.locator('.onboarding-progress')).toHaveText(`${total}/${total}`);

        await page.locator('.onboarding-next').click();
        await expect(page.locator('.onboarding-card')).toHaveCount(0, { timeout: 5000 });
        await expect(page.locator('.onboarding-overlay')).toHaveCount(0);
        await expect.poll(() => page.evaluate(() => document.body.classList.contains('guided-flow-locked'))).toBe(false);
        await expect.poll(() => page.evaluate(() => window.dashboardInstance?.settings?.onboardingCompleted === true)).toBe(true);

        expect(pageErrors).toEqual([]);
    });
});
