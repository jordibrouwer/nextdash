// @ts-check
const { test, expect } = require('@playwright/test');

async function waitForConfigKeyboardTab(page) {
    await page.goto('/config#general');
    await page.waitForFunction(() => typeof window.configManager?.keyboard?.refresh === 'function');
    await page.waitForSelector('.general-layout', { timeout: 20_000 });
    await page.evaluate(() => window.configManager.ui.switchToTab('keyboard'));
    await page.waitForSelector('[data-tab-content="keyboard"].active', { timeout: 10_000 });
    await page.waitForSelector('#keyboard-bindings-container .keyboard-binding-row--fixed', { timeout: 15_000 });
}

test.describe('config keyboard tab', () => {
    test.beforeEach(async ({ page }) => {
        await page.setViewportSize({ width: 1280, height: 800 });
        await waitForConfigKeyboardTab(page);
    });

    test('lists fixed sections and rebindable shortcuts', async ({ page }) => {
        await expect(page.locator('.keyboard-section-header')).toHaveCount(8);
        await expect(page.locator('.keyboard-binding-row--fixed').count()).resolves.toBeGreaterThan(15);
        await expect(page.locator('.keyboard-binding-row:not(.keyboard-binding-row--fixed)')).not.toHaveCount(0);
        await expect(page.locator('.binding-edit-btn').first()).toBeVisible();
        await expect(page.locator('[data-tab-content="keyboard"] .config-tab-surface')).toBeVisible();
    });

    test('rebind shows conflict for another default key', async ({ page }) => {
        page.once('dialog', async (dialog) => {
            expect(dialog.message().toLowerCase()).toMatch(/default|inline|choose another/i);
            await dialog.accept();
        });

        const searchRow = page.locator('.keyboard-binding-row:not(.keyboard-binding-row--fixed)')
            .filter({ hasText: /regular search/i })
            .first();
        await searchRow.locator('.binding-edit-btn').click();
        await page.keyboard.press(';');
    });

    test('export keyboard preset downloads JSON', async ({ page }) => {
        const downloadPromise = page.waitForEvent('download');
        await page.getByRole('button', { name: /export keyboard preset/i }).click();
        const download = await downloadPromise;
        expect(download.suggestedFilename()).toMatch(/keyboard-preset\.json$/);
    });
});
