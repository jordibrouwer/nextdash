// @ts-check
const { test, expect } = require('@playwright/test');
const {
    markWhatsNewSeen,
    dismissOnboardingIfPresent,
    dismissBlockingOverlays,
} = require('./e2e-helpers');

/**
 * Undo for structure changes.
 *
 * Bookmarks have had a trash and an undo toast for a while; pages and categories
 * had neither, which made them the most destructive thing in the app — a page
 * delete os.Removed bookmarks-N.json outright. Creating pages and categories
 * from the dashboard made both far easier to reach, so the delete side needed to
 * stop being one-way.
 *
 * The 8-second toast is the fast net here: it catches the "no, wrong one" that
 * follows a misclick by seconds.
 */

const undoButton = (page) => page.locator('.app-notification-action:visible').first();

/**
 * Confirm a delete prompt. Both are in-DOM rather than native dialogs, but they
 * are two different surfaces: config builds its own #config-confirm-modal, the
 * grid's category menu goes through AppModal.danger.
 */
async function confirmModal(page) {
    const configOk = page.locator('#config-confirm-modal [data-confirm="ok"]');
    const appOk = page.locator('#app-modal #modal-actions .modal-button').first();
    await expect(configOk.or(appOk).first()).toBeVisible();
    if (await configOk.count()) {
        await configOk.click();
        return;
    }
    await appOk.click();
}

/**
 * Clear any toast that is already showing.
 *
 * AppNotification has a single host and queues behind a busy one, so a leftover
 * "Category created." from seeding would swallow the delete toast this file is
 * about — the assertion would fail on a bug that only exists in the test.
 */
async function clearNotifications(page) {
    await page.evaluate(() => window.AppNotification?.hide?.());
    await expect(page.locator('.app-notification.show')).toHaveCount(0);
}

/** Open Config → Pages & tags on a given sub-tab. */
async function openPagesTags(page, tab) {
    await page.evaluate(async (subTab) => {
        const cfg = window.dashboardInstance.config;
        await cfg.openConfigView('pages-tags');
        cfg.ptTab = subTab;
        cfg.render();
    }, tab);
}

async function loadDashboard(page) {
    await page.setViewportSize({ width: 1400, height: 900 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
}

/** Create a page with bookmarks on it, so a delete has something to lose. */
async function seedPage(page, name, bookmarkNames) {
    return page.evaluate(async ({ pageName, rows }) => {
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        const listRes = await api('/api/pages');
        const pages = listRes.ok ? await listRes.json() : [];
        const id = pages.reduce((max, p) => Math.max(max, Number(p.id) || 0), 0) + 1;
        await api('/api/pages', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify([...pages, { id, name: pageName }]),
        });
        await api(`/api/bookmarks?page=${id}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(rows.map((n) => ({ name: n, url: `https://${n}.example.com`, category: '' }))),
        });
        const d = window.dashboardInstance;
        d.pages = [...pages, { id, name: pageName }];
        return id;
    }, { pageName: name, rows: bookmarkNames });
}

async function pageIds(page) {
    return page.evaluate(async () => {
        const res = await fetch('/api/pages');
        const list = res.ok ? await res.json() : [];
        return list.map((p) => Number(p.id));
    });
}

async function bookmarkNamesOn(page, pageId) {
    return page.evaluate(async (id) => {
        const res = await fetch(`/api/bookmarks?page=${id}`);
        const list = res.ok ? await res.json() : [];
        return list.map((b) => String(b.name || ''));
    }, pageId);
}

test.describe('Page delete is recoverable', () => {
    test('Undo puts the page and its bookmarks back', async ({ page }) => {
        await loadDashboard(page);
        const pageId = await seedPage(page, 'Undo Probe', ['Gamma', 'Delta']);

        await openPagesTags(page, 'pages');
        const deleting = page.evaluate((id) => window.dashboardInstance.config.deletePage(id), pageId);
        await confirmModal(page);
        await deleting;

        await expect(undoButton(page)).toBeVisible();
        expect(await pageIds(page)).not.toContain(pageId);

        await undoButton(page).click();
        await expect(page.locator('.app-notification:visible').first()).toContainText(/restored|hersteld/i);

        expect(await pageIds(page)).toContain(pageId);
        expect((await bookmarkNamesOn(page, pageId)).sort()).toEqual(['Delta', 'Gamma']);
    });

    test('a page with no undo taken stays deleted', async ({ page }) => {
        await loadDashboard(page);
        const pageId = await seedPage(page, 'Stays Gone', ['Epsilon']);

        await openPagesTags(page, 'pages');
        const deleting = page.evaluate((id) => window.dashboardInstance.config.deletePage(id), pageId);
        await confirmModal(page);
        await deleting;
        await expect(undoButton(page)).toBeVisible();

        // Dismissing the toast must not restore anything — undo is the action,
        // not the default.
        await page.evaluate(() => document.querySelectorAll('.app-notification').forEach((n) => n.remove()));
        expect(await pageIds(page)).not.toContain(pageId);
    });
});

test.describe('Category delete is recoverable', () => {
    /** Add a category to the current page through the real write path. */
    async function seedCategory(page, name) {
        return page.evaluate(async (categoryName) => {
            const d = window.dashboardInstance;
            const pageId = Number(d.currentPageId) || 1;
            const created = await d.structureCreate.createCategoryFromForm(pageId, categoryName);
            await d.loadPageBookmarks(pageId, { skipInlineEditConfirm: true });
            return { pageId, id: created.id };
        }, name);
    }

    async function categoryIds(page, pageId) {
        return page.evaluate(async (id) => {
            const res = await fetch(`/api/categories?page=${id}`);
            const list = res.ok ? await res.json() : [];
            return list.map((c) => String(c.id));
        }, pageId);
    }

    test('Undo restores a category deleted from its header menu', async ({ page }) => {
        await loadDashboard(page);
        const { pageId, id } = await seedCategory(page, 'Undo Cat');
        expect(await categoryIds(page, pageId)).toContain(id);
        await clearNotifications(page);

        // Through the menu's own handler, not the store call underneath it, so
        // the toast this test is about is actually the one that fires.
        const deleting = page.evaluate(async (categoryId) => {
            const d = window.dashboardInstance;
            const category = (d.categories || []).find((c) => String(c.id) === categoryId);
            const titleEl = document.querySelector(`[data-category-id="${categoryId}"] .category-title`)
                || document.body;
            await d.categoryMenu.runAction('delete', titleEl, category);
        }, id);
        await confirmModal(page);
        await deleting;

        await expect(undoButton(page)).toBeVisible();
        expect(await categoryIds(page, pageId)).not.toContain(id);

        await undoButton(page).click();
        await expect(page.locator('.app-notification:visible').first()).toContainText(/restored|hersteld/i);
        expect(await categoryIds(page, pageId)).toContain(id);
    });

    test('Undo restores a category deleted from config', async ({ page }) => {
        await loadDashboard(page);
        const { pageId, id } = await seedCategory(page, 'Config Cat');
        await clearNotifications(page);

        await openPagesTags(page, 'categories');
        await expect(page.locator('[data-cat-delete]').first()).toBeVisible();

        await page.evaluate((categoryId) => {
            const cfg = window.dashboardInstance.config;
            const index = (cfg._categories || []).findIndex((c) => String(c.id) === categoryId);
            document.querySelector(`[data-cat-delete="${index}"]`)?.click();
        }, id);
        await confirmModal(page);

        await expect(undoButton(page)).toBeVisible();
        expect(await categoryIds(page, pageId)).not.toContain(id);

        await undoButton(page).click();
        expect(await categoryIds(page, pageId)).toContain(id);
    });
});

