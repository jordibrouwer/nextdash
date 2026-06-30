// @ts-check
const { test, expect } = require('@playwright/test');

async function skipConfigTours(page) {
    await page.addInitScript(() => {
        try {
            localStorage.setItem('nextdash:config-general-tour-v1', '1');
            localStorage.setItem('nextdash:config-tags-tour-v1', '1');
            localStorage.setItem('nextdash:config-collections-tour-v1', '1');
        } catch {
            // ignore
        }
    });
}

async function waitForConfigReady(page) {
    await skipConfigTours(page);
    await page.goto('/config#general');
    await page.waitForFunction(() => typeof window.configManager?.persistence !== 'undefined');
    await page.waitForSelector('.general-layout', { timeout: 20_000 });
    await page.evaluate(() => {
        const cm = window.configManager;
        if (cm?.settingsData) {
            cm.settingsData.configGeneralTourCompleted = true;
            cm.settingsData.configTagsTourCompleted = true;
            cm.settingsData.configCollectionsTourCompleted = true;
        }
        window.ConfigGeneralTour?.teardownStaleDom?.();
        window.ConfigTagsTour?.teardownStaleDom?.();
        window.ConfigCollectionsTour?.teardownStaleDom?.();
        cm._configGeneralTourActive = false;
        cm._configTagsTourActive = false;
        cm._configCollectionsTourActive = false;
        cm.ui.switchToTab('general');
    });
    await page.waitForSelector('#columns-input', { timeout: 15_000 });
}

/** @param {import('@playwright/test').Page} page */
async function stripAllBookmarkTags(page) {
    await page.evaluate(async () => {
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        const pages = window.configManager?.pagesData || [{ id: 1 }];
        for (const p of pages) {
            const pageId = p.id;
            const response = await fetch(`/api/bookmarks?page=${pageId}`);
            if (!response.ok) {
                throw new Error(`fetch bookmarks failed for page ${pageId}: ${response.status}`);
            }
            const bookmarks = await response.json();
            const stripped = bookmarks.map((bookmark) => ({ ...bookmark, tags: [] }));
            const save = await api(`/api/bookmarks?page=${pageId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(stripped),
            });
            if (!save.ok) {
                throw new Error(`save bookmarks failed for page ${pageId}: ${save.status}`);
            }
        }
        await window.configManager?.tabs?.reloadTagsTabData?.();
    });
}

test.describe('config tab consistency (v2 empty states & v2b save UX)', () => {
    test.describe.configure({ mode: 'serial' });

    test.beforeEach(async ({ page }) => {
        await page.setViewportSize({ width: 1280, height: 800 });
        await waitForConfigReady(page);
    });

    test('tags empty state CTA switches to bookmarks tab', async ({ page }) => {
        await stripAllBookmarkTags(page);

        await page.evaluate(async () => {
            window.configManager.ui.switchToTab('tags');
            await window.configManager.reloadTagsTabData();
        });
        await page.waitForSelector('[data-tab-content="tags"].active', { timeout: 10_000 });

        await expect(page.locator('#tags-empty-state')).toBeVisible();
        await expect(page.locator('#tags-empty-cta')).toBeVisible();
        await expect(page.locator('#tags-body')).toBeHidden();

        await page.locator('#tags-empty-cta').click();

        await expect(page.locator('[data-tab-content="bookmarks"].active')).toBeVisible();
        await expect(page.locator('.tab-button[data-tab="bookmarks"]')).toHaveClass(/active/);
    });

    test('collections empty state CTA opens new collection editor', async ({ page }) => {
        await page.evaluate(() => {
            const cm = window.configManager;
            cm.settingsData.collections = [];
            cm.ui.switchToTab('collections');
            cm.collections.refresh(cm);
        });
        await page.waitForSelector('[data-tab-content="collections"].active', { timeout: 10_000 });

        await expect(page.locator('#collections-empty-state')).toBeVisible();
        await expect(page.locator('#collections-empty-cta')).toBeVisible();
        await expect(page.locator('#collections-list .collection-item')).toHaveCount(0);

        await page.locator('#collections-empty-cta').click();

        await expect(page.locator('#collections-edit-panel')).toBeVisible();
        await expect(page.locator('#col-edit-name')).toBeVisible();
        await expect(page.locator('#collections-empty-state')).toBeHidden();
    });

    test('save status line shows Saved then Unsaved; retires unsaved badge', async ({ page }) => {
        const status = page.locator('#save-status-indicator');
        const badge = page.locator('#unsaved-indicator');

        await expect(status).toBeVisible();
        await expect(status).toHaveText(/saved/i);
        await expect(status).not.toHaveClass(/is-unsaved/);
        await expect(badge).toBeHidden();

        const before = await page.evaluate(() => window.configManager.settingsData.columnsPerRow);
        const next = before >= 6 ? 2 : before + 1;

        await page.locator('#columns-input').fill(String(next));
        await page.locator('#columns-input').dispatchEvent('input');
        await page.locator('#columns-input').dispatchEvent('change');

        await expect.poll(() => page.evaluate(() => window.configManager.isDirty)).toBe(true);
        await expect(status).toHaveClass(/is-unsaved/);
        await expect(status).toHaveText(/unsaved/i);
        await expect(badge).toBeHidden();
    });

    test('sticky save bar syncs hint and body class when dirty and scrolled', async ({ page }) => {
        const before = await page.evaluate(() => window.configManager.settingsData.columnsPerRow);
        const next = before >= 6 ? 2 : before + 1;

        await page.locator('#columns-input').fill(String(next));
        await page.locator('#columns-input').dispatchEvent('input');
        await page.locator('#columns-input').dispatchEvent('change');
        await expect.poll(() => page.evaluate(() => window.configManager.isDirty)).toBe(true);

        await page.evaluate(() => window.scrollTo(0, 400));
        await expect.poll(() => page.evaluate(() => document.body.classList.contains('config-sticky-save-visible')))
            .toBe(true);
        await expect(page.locator('#config-save-sticky')).toHaveClass(/is-scroll-active/);
        await expect(page.locator('.config-save-sticky-hint')).toHaveText(/unsaved/i);
    });

    test('tab save mode pill reflects Requires Save, Auto-save, and Read-only', async ({ page }) => {
        const pill = page.locator('#config-tab-save-mode');

        await page.evaluate(() => window.configManager.ui.switchToTab('general'));
        await expect(pill).toBeVisible();
        await expect(pill).toHaveClass(/config-tab-save-mode--requires-save/);
        await expect(pill).toHaveText(/requires save/i);

        await page.evaluate(() => window.configManager.ui.switchToTab('tags'));
        await expect(pill).toHaveClass(/config-tab-save-mode--auto-save/);
        await expect(pill).toHaveText(/auto-save/i);

        await page.evaluate(() => window.configManager.ui.switchToTab('stats'));
        await expect(pill).toHaveClass(/config-tab-save-mode--read-only/);
        await expect(pill).toHaveText(/read-only/i);
    });
});

test.describe('config tab consistency v3 navigation', () => {
    test.beforeEach(async ({ page }) => {
        await page.setViewportSize({ width: 1280, height: 800 });
        await waitForConfigReady(page);
    });

    test('bookmarks breadcrumb includes page and category context', async ({ page }) => {
        await page.evaluate(async () => {
            const cm = window.configManager;
            await cm.ui.switchToTab('bookmarks');
            await cm.loadPageBookmarks(cm.currentPageId);
            cm.currentBookmarksCategoryFilter = 'development';
            const filter = document.getElementById('bookmarks-category-filter');
            if (filter) filter.value = 'development';
            cm.ui.refreshTabBreadcrumb('bookmarks');
        });

        const crumb = page.locator('#config-breadcrumb');
        await expect(crumb).toContainText(/bookmarks/i);
        await expect(crumb).toContainText(/main/i);
        await expect(crumb).toContainText(/development/i);
    });

    test('categories breadcrumb includes selected page name', async ({ page }) => {
        await page.evaluate(async () => {
            const cm = window.configManager;
            await cm.ui.switchToTab('categories');
            const pageId = cm.currentCategoriesPageId || cm.currentPageId || 1;
            await cm.loadPageCategories(pageId);
            cm.ui.refreshTabBreadcrumb('categories');
        });

        const crumb = page.locator('#config-breadcrumb');
        await expect(crumb).toContainText(/categories/i);
        await expect(crumb).toContainText(/main/i);
    });
});

test.describe('config tab consistency v3 phone block', () => {
    test('bookmarks hash on phone shows blocking card and keeps hash', async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        await skipConfigTours(page);
        await page.goto('/config#bookmarks');
        await page.waitForFunction(() => typeof window.configManager?.ui !== 'undefined');
        await page.waitForSelector('[data-tab-content="bookmarks"].active', { timeout: 20_000 });

        await expect(page).toHaveURL(/#bookmarks/);
        await expect(page.locator('#bookmarks-phone-block')).toBeVisible();
        await expect(page.locator('#bookmarks-tab-workspace')).toBeHidden();
        await expect(page.locator('.bookmarks-splitview')).toBeHidden();
    });

    test('unsupported phone hash still redirects to general', async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        await skipConfigTours(page);
        await page.goto('/config#pages');
        await page.waitForFunction(() => typeof window.configManager?.ui !== 'undefined');
        await page.waitForSelector('[data-tab-content="general"].active', { timeout: 20_000 });

        await expect(page).toHaveURL(/#general/);
    });
});

test.describe('config tab consistency v4 classic surfaces', () => {
    test.beforeEach(async ({ page }) => {
        await page.setViewportSize({ width: 1280, height: 800 });
        await waitForConfigReady(page);
    });

    test('pages tab wraps toolbar and list in config-tab-surface', async ({ page }) => {
        await page.evaluate(() => window.configManager.ui.switchToTab('pages'));
        const surface = page.locator('[data-tab-content="pages"] .config-tab-surface');
        await expect(surface).toBeVisible();
        await expect(surface.locator('.config-tab-toolbar--in-surface')).toBeVisible();
        await expect(surface.locator('#pages-list.simple-list')).toBeVisible();
    });

    test('classic layout applies surface shadow on pages card', async ({ page }) => {
        await page.evaluate(() => window.configManager.ui.switchToTab('pages'));
        const shadow = await page.locator('[data-tab-content="pages"] .config-tab-surface').evaluate((el) => {
            return window.getComputedStyle(el).boxShadow;
        });
        expect(shadow).not.toBe('none');
    });
});
