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

        // Open the collections tab, then click the real "+ Add collection"
        // button. Going through the button (not _openEdit directly) is what
        // guards the fix where the button passed the wrong manager, leaving the
        // suggestion pool empty. If that regresses, no dropdown appears below.
        await page.evaluate(() => window.configManager.ui.switchToTab('collections'));
        await page.waitForSelector('[data-tab-content="collections"].active', { timeout: 10_000 });
        await dismissConfigTourOverlays(page);
        // Seed after the tab switch so nothing reloads the store from under us.
        await seedTagPool(page, 'reading');
        await page.click('#add-collection-btn');
        await page.waitForSelector('#collections-edit-panel:not([hidden]) .col-rule-value', { timeout: 10_000 });

        // Make sure the rule targets the "tag" field we seeded.
        await page.selectOption('#collections-edit-panel .col-rule-field', 'tag');

        const valueInput = page.locator('#collections-edit-panel .col-rule-value').first();
        await valueInput.click();
        await valueInput.type('rea', { delay: 30 });

        // Dropdown appears with the seeded tag.
        const item = page.locator('.tag-ac-dropdown .tag-ac-item', { hasText: 'reading' });
        await expect(item).toBeVisible({ timeout: 5000 });

        // Accepting fills a single, comma-free value.
        await item.click();
        await expect(valueInput).toHaveValue('reading');
    });
});
