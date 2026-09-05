// @ts-check
const { test, expect } = require('./fixtures');
const { dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

async function loadDashboard(page) {
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
}

async function deleteBookmarkByUrl(page, pageId, url) {
    await page.evaluate(async ({ targetPageId, targetUrl }) => {
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        const res = await api(`/api/bookmarks?page=${targetPageId}`);
        if (!res.ok) return;
        const list = await res.json();
        const bookmark = (list || []).find(
            (bm) => String(bm?.url || '').trim().toLowerCase() === String(targetUrl).trim().toLowerCase()
        );
        if (!bookmark) return;
        await api('/api/bookmarks', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ page: targetPageId, bookmark }),
        });
    }, { targetPageId: pageId, targetUrl: url });
}

async function openAddBookmark(page) {
    await page.evaluate(async () => {
        // Not `open?.() ?? fallback`: open() returns nothing on success, so ??
        // took the right-hand side every single time and the test only passed
        // when searchComponent happened to be there -- it is built from a
        // lazily fetched bundle, so on a slow runner it was null and this threw.
        const d = window.dashboardInstance;
        if (d.quickAddWidget?.open) {
            await d.quickAddWidget.open();
            return;
        }
        await window.SearchLoader?.ensureReady?.();
        d.searchComponent?.commandsComponent?.newCommandHandler?.openModal();
    });
    await expect(page.locator('#bookmark-form-modal')).toHaveClass(/show/);
}

test.describe('add bookmark — Create + New', () => {
    test('the footer offers a distinct Create + New button', async ({ page }) => {
        await loadDashboard(page);
        await openAddBookmark(page);
        const btn = page.locator('#bookmark-form-create-another');
        await expect(btn).toBeVisible();
        await expect(btn).toHaveClass(/bookmark-inline-create-another/);
    });

    test('Create + New saves, keeps the modal open, clears the form and keeps the page', async ({ page }) => {
        const posted = [];
        await page.route('**/api/bookmarks/add', async (route) => {
            posted.push(JSON.parse(route.request().postData() || '{}'));
            return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
        });
        await loadDashboard(page);
        await openAddBookmark(page);

        const form = page.locator('#bookmark-form-modal .bookmark-inline-form');
        await form.locator('input[type="url"]').fill('https://example.com');
        await form.locator('.bookmark-inline-input').first().fill('Example One');
        const pageBefore = await form.locator('.bookmark-inline-select').first().inputValue();

        await page.locator('#bookmark-form-create-another').click();

        // Modal stays open.
        await expect(page.locator('#bookmark-form-modal')).toHaveClass(/show/);
        // Fields cleared for the next entry.
        await expect(form.locator('input[type="url"]')).toHaveValue('');
        await expect(form.locator('.bookmark-inline-input').first()).toHaveValue('');
        // Page selection preserved.
        await expect(form.locator('.bookmark-inline-select').first()).toHaveValue(pageBefore);
        // The first bookmark was posted.
        await expect.poll(() => posted.length).toBe(1);

        // A second bookmark can be added right away.
        await form.locator('input[type="url"]').fill('https://example.org');
        await form.locator('.bookmark-inline-input').first().fill('Example Two');
        await page.locator('#bookmark-form-create-another').click();
        await expect.poll(() => posted.length).toBe(2);
        await expect(page.locator('#bookmark-form-modal')).toHaveClass(/show/);
    });

    test('Create + New repaints the bookmark grid while the modal stays open', async ({ page }) => {
        await loadDashboard(page);
        await page.waitForSelector('#dashboard-layout .bookmark-link', { timeout: 15_000 });
        await openAddBookmark(page);

        const uniqueUrl = `https://example.com/create-another-grid-${Date.now()}.test`;
        const uniqueName = `Create another grid ${Date.now()}`;
        const gridLink = page.locator(
            `#dashboard-layout .category:not([data-smart-collection="true"]) .bookmark-link[data-bookmark-url="${uniqueUrl}"]`
        );

        const form = page.locator('#bookmark-form-modal .bookmark-inline-form');
        await form.locator('input[type="url"]').fill(uniqueUrl);
        await form.locator('.bookmark-inline-input').first().fill(uniqueName);
        await page.locator('#bookmark-form-create-another').click();

        await expect(page.locator('#bookmark-form-modal')).toHaveClass(/show/);
        await expect(gridLink).toBeVisible({ timeout: 10_000 });
        await expect(gridLink).toContainText(uniqueName);

        const pageId = await page.evaluate(() => Number(window.dashboardInstance?.currentPageId) || 1);
        await deleteBookmarkByUrl(page, pageId, uniqueUrl);
    });

    test('Shift+B opens the add-bookmark modal on the dashboard', async ({ page }) => {
        await loadDashboard(page);
        await page.evaluate(() => document.activeElement?.blur());
        await page.keyboard.press('Shift+KeyB');
        await expect(page.locator('#bookmark-form-modal')).toHaveClass(/show/);
    });

    test('the plain Create button still closes the modal', async ({ page }) => {
        await page.route('**/api/bookmarks/add', async (route) =>
            route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
        await loadDashboard(page);
        await openAddBookmark(page);
        const form = page.locator('#bookmark-form-modal .bookmark-inline-form');
        await form.locator('input[type="url"]').fill('https://example.net');
        await form.locator('.bookmark-inline-input').first().fill('Closes');
        await form.locator('.bookmark-inline-actions > .bookmark-inline-save').click();
        await expect(page.locator('#bookmark-form-modal')).not.toHaveClass(/show/);
    });
});
