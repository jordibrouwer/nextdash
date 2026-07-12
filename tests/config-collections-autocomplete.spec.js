// @ts-check
const { test, expect } = require('@playwright/test');
const { dismissConfigTourOverlays } = require('./e2e-helpers');

async function waitForConfigReady(page) {
    await page.goto('/config#general');
    await page.waitForFunction(() => typeof window.configManager?.tabs !== 'undefined');
    await page.waitForFunction(() => typeof window.configManager?.collections?.refresh === 'function');
    await page.waitForSelector('.general-layout', { timeout: 20_000 });
}

/** Seed a known tag into the config manager's bookmark pool so autocomplete has data. */
async function seedTagPool(page, tag) {
    await page.evaluate((t) => {
        const store = window.configManager.bookmarkStore;
        store.replaceAll([{ url: 'https://seed.example', name: 'Seed', tags: [t], category: '', shortcut: '', pageId: 1 }]);
    }, tag);
}

test.describe('collections rule value autocomplete', () => {
    test.beforeEach(async ({ page }) => {
        await page.setViewportSize({ width: 1280, height: 800 });
    });

    test('suggests an existing tag and accepts it as a single clean value', async ({ page }) => {
        await waitForConfigReady(page);
        await seedTagPool(page, 'reading');

        // Open the collections tab, then the "New collection" editor.
        await page.evaluate(() => window.configManager.ui.switchToTab('collections'));
        await page.waitForSelector('[data-tab-content="collections"].active', { timeout: 10_000 });
        await dismissConfigTourOverlays(page);
        await page.evaluate(() => {
            window.configManager.collections._openEdit(null, window.configManager);
        });
        await page.waitForSelector('#collections-edit-panel:not([hidden]) .col-rule-value', { timeout: 10_000 });

        const valueInput = page.locator('#collections-edit-panel .col-rule-value').first();
        await valueInput.click();
        await valueInput.type('rea');

        // Dropdown appears with the seeded tag.
        const item = page.locator('.tag-ac-dropdown .tag-ac-item', { hasText: 'reading' });
        await expect(item).toBeVisible({ timeout: 5000 });

        // Accepting fills a single, comma-free value.
        await item.click();
        await expect(valueInput).toHaveValue('reading');
    });
});
