// @ts-check
const { test, expect } = require('@playwright/test');

async function waitForConfigReady(page) {
    await page.goto('/config#general');
    await page.waitForFunction(() => typeof window.configManager?.bookmarksController !== 'undefined');
    await page.waitForFunction(() => typeof window.configManager?.renderConfig === 'function');
    await page.waitForSelector('.general-layout', { timeout: 20_000 });
    await page.evaluate(() => window.configManager.ui.switchToTab('general'));
}

test.describe('config domain glue (phase 4–6 controllers)', () => {
    test.beforeEach(async ({ page }) => {
        await page.setViewportSize({ width: 1280, height: 800 });
    });

    test('pages controller exposes visible pages list', async ({ page }) => {
        await waitForConfigReady(page);
        const pages = await page.evaluate(() => window.configManager.getVisiblePages());
        expect(Array.isArray(pages)).toBe(true);
        expect(pages.length).toBeGreaterThan(0);
        expect(pages[0]).toHaveProperty('id');
        expect(pages[0]).toHaveProperty('name');
    });

    test('finders controller validates duplicate shortcuts', async ({ page }) => {
        await waitForConfigReady(page);
        const error = await page.evaluate(() => {
            const cm = window.configManager;
            return cm.validateFindersData([
                { shortcut: 'a', name: 'One', searchUrl: 'https://a.test' },
                { shortcut: 'a', name: 'Two', searchUrl: 'https://b.test' },
            ]);
        });
        expect(error).toBeTruthy();
    });

    test('add finder keeps finders list visible', async ({ page }) => {
        await waitForConfigReady(page);
        await page.evaluate(() => window.configManager.ui.switchToTab('finders'));
        await page.waitForSelector('#finders-list', { timeout: 15_000 });

        const beforeCount = await page.locator('#finders-list .finder-item').count();

        await page.evaluate(async () => {
            await window.configManager.addFinder();
        });

        await expect.poll(async () => page.locator('#finders-list .finder-item').count())
            .toBe(beforeCount + 1);
        await expect(page.locator('#finders-list .finders-list-empty-hint')).toBeHidden();
        await expect(page.locator('#finders-list .finders-filter-empty-hint')).toBeHidden();
    });

    test('categories controller tracks last categories page id', async ({ page }) => {
        await waitForConfigReady(page);
        const ok = await page.evaluate(() => {
            const cm = window.configManager;
            cm.saveLastCategoriesPageId(1);
            return cm.getLastCategoriesPageId() === 1;
        });
        expect(ok).toBe(true);
    });

    test('themes controller updates preview badge without error', async ({ page }) => {
        await waitForConfigReady(page);
        await page.evaluate(() => window.configManager.ui.switchToTab('colors'));
        const ran = await page.evaluate(() => {
            try {
                window.configManager.updateThemePreviewBadge({ saving: false });
                return true;
            } catch {
                return false;
            }
        });
        expect(ran).toBe(true);
    });

    test('bookmarks controller exposes validation and page id helpers', async ({ page }) => {
        await waitForConfigReady(page);
        const ok = await page.evaluate(() => {
            const cm = window.configManager;
            const pageId = cm.getResolvedBookmarksPageId();
            const conflicts = cm.validateBookmarkConflicts({ showToast: false });
            return Number.isFinite(pageId) && pageId >= 1 && conflicts && typeof conflicts.hasConflicts === 'boolean';
        });
        expect(ok).toBe(true);
    });

    test('render controller refreshes config without error', async ({ page }) => {
        await waitForConfigReady(page);
        const ran = await page.evaluate(() => {
            try {
                window.configManager.renderConfig();
                return true;
            } catch {
                return false;
            }
        });
        expect(ran).toBe(true);
    });
});
