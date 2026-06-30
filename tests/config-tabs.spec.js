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

    test('flushCategoriesPageBeforeSwitch does not wipe categories when DOM is empty but bookmarks reference them', async ({ page }) => {
        await waitForConfigReady(page);
        await page.evaluate(() => window.configManager.ui.switchToTab('categories'));

        const preserved = await page.evaluate(async () => {
            const cm = window.configManager;
            const pageId = Number(cm.currentCategoriesPageId) || 1;
            const seed = [
                { id: 'guard-work', name: 'Guard Work', icon: '' },
                { id: 'guard-personal', name: 'Guard Personal', icon: '' },
            ];
            await cm.data.saveCategoriesByPage(seed, pageId);
            await cm.loadPageCategories(pageId);

            const bookmarks = await cm.data.loadBookmarksByPage(pageId);
            const withCategory = bookmarks.length > 0
                ? bookmarks.map((bookmark, index) => (
                    index === 0
                        ? { ...bookmark, category: 'guard-work' }
                        : bookmark
                ))
                : [{ url: 'https://guard-category.example', category: 'guard-work' }];
            await cm.data.saveBookmarks(withCategory, pageId);

            cm.categoriesListHydrated = true;
            cm.categoriesData = [...seed];
            const list = document.getElementById('categories-list');
            if (list) {
                list.innerHTML = '<li class="categories-list-empty-hint" role="listitem">empty</li>';
            }

            const flushed = await cm.flushCategoriesPageBeforeSwitch();
            const after = await cm.data.loadCategoriesByPage(pageId);
            return {
                flushed,
                count: Array.isArray(after) ? after.length : 0,
                ids: (after || []).map((category) => category.id),
            };
        });

        expect(preserved.flushed).toBe(true);
        expect(preserved.count).toBe(2);
        expect(preserved.ids).toEqual(expect.arrayContaining(['guard-work', 'guard-personal']));
    });

    test('persistCategoriesStructureAndRefresh skips orphan bookmark cleanup when category save is guarded', async ({ page }) => {
        await waitForConfigReady(page);
        await page.evaluate(() => window.configManager.ui.switchToTab('categories'));

        const preserved = await page.evaluate(async () => {
            const cm = window.configManager;
            const pageId = Number(cm.currentCategoriesPageId) || 1;
            const seed = [{ id: 'persist-guard', name: 'Persist Guard', icon: '' }];
            await cm.data.saveCategoriesByPage(seed, pageId);

            const bookmarks = [{ url: 'https://persist-guard.example', category: 'persist-guard' }];
            await cm.data.saveBookmarks(bookmarks, pageId);

            cm.categoriesListHydrated = true;
            cm.categoriesData = [];
            const list = document.getElementById('categories-list');
            if (list) {
                list.innerHTML = '<li class="categories-list-empty-hint" role="listitem">empty</li>';
            }

            await cm.persistCategoriesStructureAndRefresh({ persistBookmarks: true, eventType: 'test-guard' });

            const categories = await cm.data.loadCategoriesByPage(pageId);
            const loadedBookmarks = await cm.data.loadBookmarksByPage(pageId);
            const targetBookmark = (loadedBookmarks || []).find(
                (bookmark) => String(bookmark?.url || '').includes('persist-guard.example')
            );
            return {
                categoryCount: Array.isArray(categories) ? categories.length : 0,
                bookmarkCategory: targetBookmark?.category || '',
            };
        });

        expect(preserved.categoryCount).toBe(1);
        expect(preserved.bookmarkCategory).toBe('persist-guard');
    });
});
