// @ts-check
const { test, expect } = require('@playwright/test');

test('onboarding step 9 finish closes tour', async ({ page }) => {
    await page.goto('/');
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
    await page.reload();
    await page.waitForSelector('.onboarding-card', { timeout: 15_000 });

    for (let i = 0; i < 8; i++) {
        await page.locator('.onboarding-next').click();
        await page.waitForTimeout(150);
    }

    await expect(page.locator('.onboarding-progress')).toHaveText('9/9');
    await page.locator('.onboarding-next').click();
    await expect(page.locator('.onboarding-card')).toHaveCount(0, { timeout: 5000 });
    await expect(page.locator('.onboarding-overlay')).toHaveCount(0);
});
