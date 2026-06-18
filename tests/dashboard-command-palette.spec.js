// @ts-check
const { test, expect } = require('@playwright/test');

async function dismissOnboardingIfPresent(page) {
    const card = page.locator('.onboarding-card');
    if (await card.count()) {
        await page.locator('.onboarding-skip').click();
        await expect(card).toHaveCount(0, { timeout: 5000 });
    }
}

async function dismissBlockingOverlays(page) {
    const whatsNew = page.locator('#app-modal.show');
    if (await whatsNew.count()) {
        await page.keyboard.press('Escape');
        await expect(whatsNew).toHaveCount(0, { timeout: 3000 });
    }
    const searchPromo = page.locator('.dashboard-search-promo');
    if (await searchPromo.count()) {
        await searchPromo.locator('button').first().click();
        await expect(searchPromo).toHaveCount(0, { timeout: 3000 });
    }
}

test.describe('dashboard command palette', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/');
        await page.waitForSelector('.bookmark-link', { timeout: 15_000 });
        await dismissOnboardingIfPresent(page);
        await dismissBlockingOverlays(page);
    });

    test(':buttons add toggles add button on Enter', async ({ page }) => {
        const visibleBefore = await page.locator('#quick-add-toolbar-btn').isVisible();

        await page.keyboard.press(':');
        await page.keyboard.type('buttons add', { delay: 20 });
        await expect(page.locator('#shortcut-search.show')).toBeVisible({ timeout: 3000 });
        await page.keyboard.press('Enter');

        await expect.poll(async () => page.locator('#quick-add-toolbar-btn').isVisible()).not.toBe(visibleBefore);
    });

    test('Enter after command completion executes on next press', async ({ page }) => {
        const visibleBefore = await page.locator('#quick-add-toolbar-btn').isVisible();

        await page.keyboard.press(':');
        await page.keyboard.type('button', { delay: 20 });
        await expect(page.locator('#shortcut-search.show')).toBeVisible({ timeout: 3000 });
        await page.keyboard.press('Enter');
        await page.keyboard.press('Enter');

        await expect.poll(async () => page.locator('#quick-add-toolbar-btn').isVisible()).not.toBe(visibleBefore);
    });

    test('Enter works when match row has focus', async ({ page }) => {
        const visibleBefore = await page.locator('#quick-add-toolbar-btn').isVisible();

        await page.keyboard.press(':');
        await page.keyboard.type('buttons add', { delay: 20 });
        await page.locator('.search-match.command-entry').first().focus();
        await page.keyboard.press('Enter');

        await expect.poll(async () => page.locator('#quick-add-toolbar-btn').isVisible()).not.toBe(visibleBefore);
    });

    test(':tips off disables tips on Enter', async ({ page }) => {
        await page.keyboard.press(':');
        await page.keyboard.type('tips off', { delay: 20 });
        await expect(page.locator('#shortcut-search.show')).toBeVisible({ timeout: 3000 });
        await page.keyboard.press('Enter');

        await expect.poll(async () => page.evaluate(() => (
            window.dashboardInstance?.settings?.showTips === false
        ))).toBe(true);
    });
});
