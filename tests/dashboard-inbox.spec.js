const { test, expect } = require('@playwright/test');
const { markWhatsNewSeen, dismissBlockingOverlays, dismissOnboardingIfPresent } = require('./e2e-helpers');

test.describe('dashboard inbox phase 1', () => {
    test.beforeEach(async ({ page }) => {
        await markWhatsNewSeen(page);
        await page.goto('/');
        await page.waitForSelector('#dashboard-layout', { timeout: 15_000 });
        await dismissOnboardingIfPresent(page);
        await dismissBlockingOverlays(page);
        await page.waitForFunction(() => window.dashboardInstance?.inbox != null, null, { timeout: 15_000 });
    });

    test('opens inbox via 0 key', async ({ page }) => {
        await page.evaluate(() => {
            window.dashboardInstance.settings.inboxEnabled = true;
        });

        await page.keyboard.press('0');
        await expect(page.locator('.inbox-layout')).toBeVisible();
        await expect.poll(() => page.evaluate(() => window.dashboardInstance?.activeView)).toBe('inbox');
    });

    test('escape closes inbox and returns to bookmarks', async ({ page }) => {
        await page.evaluate(() => {
            window.dashboardInstance.settings.inboxEnabled = true;
        });

        await page.locator('#page-nav-inbox-btn').click();
        await expect(page.locator('.inbox-layout')).toBeVisible();

        await page.keyboard.press('Escape');
        await expect(page.locator('.inbox-layout')).toHaveCount(0);
        await expect(page.locator('#dashboard-layout .category').first()).toBeVisible();
        await expect.poll(() => page.evaluate(() => window.dashboardInstance?.activeView)).toBe('bookmarks');
    });

    test('returns to same bookmark page from inbox via number key', async ({ page }) => {
        await page.evaluate(() => {
            window.dashboardInstance.settings.inboxEnabled = true;
        });

        await page.locator('#page-nav-inbox-btn').click();
        await expect(page.locator('.inbox-layout')).toBeVisible();

        await page.keyboard.press('1');
        await expect(page.locator('.inbox-layout')).toHaveCount(0);
        await expect(page.locator('#dashboard-layout .category').first()).toBeVisible();
        await expect.poll(() => page.evaluate(() => window.dashboardInstance?.activeView)).toBe('bookmarks');
    });

    test('paste choice modal offers bookmark and inbox', async ({ page }) => {
        await page.evaluate(() => {
            window.dashboardInstance.settings.inboxEnabled = true;
            window.dashboardInstance.settings.pasteDestination = 'ask';
        });

        await page.focus('body');
        await page.evaluate(() => {
            const event = new ClipboardEvent('paste', {
                bubbles: true,
                cancelable: true,
                clipboardData: new DataTransfer(),
            });
            event.clipboardData.setData('text/plain', 'https://example.com/inbox-paste-test');
            document.dispatchEvent(event);
        });

        const modal = page.locator('#paste-choice-modal.show');
        await expect(modal).toBeVisible({ timeout: 5000 });
        await modal.locator('[data-paste-choice="inbox"]').click();
        await expect(modal).toBeHidden();

        await page.waitForFunction(() => (
            Number(window.dashboardInstance?.inbox?.items?.length || 0) > 0
        ));

        await page.locator('#page-nav-inbox-btn').click();
        await expect(page.locator('.inbox-feed .inbox-item', { hasText: 'example.com/inbox-paste-test' })).toHaveCount(1, { timeout: 5000 });
    });
});
