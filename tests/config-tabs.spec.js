// @ts-check
const { test, expect } = require('@playwright/test');

async function waitForConfigReady(page) {
    await page.goto('/config#general');
    await page.waitForFunction(() => typeof window.configManager?.tabs !== 'undefined');
    await page.waitForFunction(() => typeof window.configManager?.onConfigFindersTabOpened === 'function');
    await page.waitForSelector('.general-layout', { timeout: 20_000 });
    await page.evaluate(() => window.configManager.ui.switchToTab('general'));
}

test.describe('config tabs (phase 3 lifecycle)', () => {
    test.beforeEach(async ({ page }) => {
        await page.setViewportSize({ width: 1280, height: 800 });
    });

    test('switching to finders tab reloads finders data', async ({ page }) => {
        await waitForConfigReady(page);
        await page.evaluate(() => window.configManager.ui.switchToTab('finders'));
        await page.waitForSelector('[data-tab-content="finders"].active', { timeout: 10_000 });

        const hasFinders = await page.evaluate(() => {
            const cm = window.configManager;
            return Array.isArray(cm.findersData) && typeof cm.reloadFindersTabData === 'function';
        });
        expect(hasFinders).toBe(true);
        await expect(page.locator('[data-tab-content="finders"]')).toHaveClass(/active/);
    });

    test('colors tab initializes editor via ensureColorsEditor', async ({ page }) => {
        await waitForConfigReady(page);
        await page.evaluate(() => window.configManager.ui.switchToTab('colors'));
        await page.waitForSelector('#theme-colors-editor', { timeout: 15_000 });

        const ready = await page.evaluate(async () => {
            await window.configManager.ensureColorsEditor();
            return Boolean(window.configManager.colorsEditor);
        });
        expect(ready).toBe(true);
    });

    test('guardColorsTabLeave allows navigation when colors editor is clean', async ({ page }) => {
        await waitForConfigReady(page);
        await page.evaluate(async () => {
            window.configManager.ui.switchToTab('colors');
            await window.configManager.ensureColorsEditor();
        });

        const allowed = await page.evaluate(async () => (
            window.configManager.guardColorsTabLeave('general')
        ));
        expect(allowed).toBe(true);
    });

    test('flushCategoriesPageBeforeSwitch returns true when categories list not hydrated', async ({ page }) => {
        await waitForConfigReady(page);
        await page.evaluate(() => window.configManager.ui.switchToTab('categories'));

        const flushed = await page.evaluate(async () => {
            const cm = window.configManager;
            cm.categoriesListHydrated = false;
            return cm.flushCategoriesPageBeforeSwitch();
        });
        expect(flushed).toBe(true);
    });
});
