// @ts-check
const { test, expect } = require('@playwright/test');

async function resetOnboarding(page) {
    await page.evaluate(async () => {
        localStorage.removeItem('nextDashOnboardingSeenV2');
        localStorage.removeItem('nextDashOnboardingVersionV2');
        const response = await fetch('/api/settings');
        if (response.ok) {
            const settings = await response.json();
            settings.onboardingCompleted = false;
            await fetch('/api/settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(settings),
            });
        }
    });
}

test('onboarding skip at step 1 closes tour', async ({ page }) => {
    const pageErrors = [];
    page.on('pageerror', (e) => pageErrors.push(e.message));

    await page.goto('/');
    await resetOnboarding(page);
    await page.reload();
    await page.waitForSelector('.onboarding-card', { timeout: 15_000 });
    await expect(page.locator('.onboarding-progress')).toHaveText('1/9');

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
