// @ts-check
const { test, expect } = require('@playwright/test');
const { dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

async function loadDashboard(page) {
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
}

async function openAddBookmark(page) {
    await page.evaluate(() => {
        window.dashboardInstance.quickAddWidget?.open?.()
            ?? window.dashboardInstance.searchComponent.commandsComponent.newCommandHandler.openModal();
    });
    await expect(page.locator('#bookmark-form-modal')).toHaveClass(/show/);
}

async function deletePageByName(page, name) {
    await page.evaluate(async (targetName) => {
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        const res = await api('/api/pages');
        if (!res.ok) return;
        const list = await res.json();
        const keep = (list || []).filter((p) => String(p?.name || '') !== targetName);
        if (keep.length === (list || []).length) return;
        await api('/api/pages', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(keep),
        });
    }, name);
}

async function deleteCategoryByName(page, pageId, name) {
    await page.evaluate(async ({ targetPageId, targetName }) => {
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        const res = await api(`/api/categories?page=${targetPageId}`);
        if (!res.ok) return;
        const list = await res.json();
        const keep = (list || []).filter((c) => String(c?.name || '') !== targetName);
        if (keep.length === (list || []).length) return;
        await api(`/api/categories?page=${targetPageId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(keep),
        });
    }, { targetPageId: pageId, targetName: name });
}

/** Page select is the first non-toggle select in the form, category the last. */
function selects(page) {
    const form = page.locator('#bookmark-form-modal .bookmark-inline-form');
    const real = form.locator('.bookmark-inline-select:not(.bookmark-inline-toggle-select)');
    return { form, pageSelect: real.first(), catSelect: real.last() };
}

function createRow(page, kind) {
    return page.locator(`#bookmark-form-modal .bookmark-inline-create[data-create-kind="${kind}"]`);
}

test.describe('bookmark form — create page and category from the dropdowns', () => {
    test('both dropdowns offer a create entry at the top', async ({ page }) => {
        await loadDashboard(page);
        await openAddBookmark(page);
        const { pageSelect, catSelect } = selects(page);

        const firstPageOption = pageSelect.locator('option').first();
        await expect(firstPageOption).toHaveAttribute('value', '__new__');
        await expect(firstPageOption).toHaveClass(/bookmark-inline-new-option/);

        const firstCatOption = catSelect.locator('option').first();
        await expect(firstCatOption).toHaveAttribute('value', '__new__');
        await expect(firstCatOption).toHaveClass(/bookmark-inline-new-option/);
    });

    test('the form opens on a real page, not on the create entry', async ({ page }) => {
        await loadDashboard(page);
        await openAddBookmark(page);
        const { pageSelect } = selects(page);
        await expect(pageSelect).not.toHaveValue('__new__');
        await expect(createRow(page, 'page')).toBeHidden();
        await expect(createRow(page, 'category')).toBeHidden();
    });

    test('choosing "New category…" creates it and selects it on the current page', async ({ page }) => {
        await loadDashboard(page);
        await openAddBookmark(page);
        const { catSelect } = selects(page);
        const name = `E2E cat ${Date.now()}`;

        await catSelect.selectOption('__new__');
        const row = createRow(page, 'category');
        await expect(row).toBeVisible();
        await expect(catSelect).toBeHidden();

        await row.locator('.bookmark-inline-create-input').fill(name);
        await row.locator('.bookmark-inline-create-ok').click();

        await expect(row).toBeHidden();
        await expect(catSelect).toBeVisible();
        await expect(catSelect.locator('option', { hasText: name })).toHaveCount(1);
        // The new category is the selected one, ready for the bookmark being added.
        const selectedText = await catSelect.locator('option:checked').textContent();
        expect(selectedText).toBe(name);

        const pageId = await page.evaluate(() => Number(window.dashboardInstance?.currentPageId) || 1);
        await deleteCategoryByName(page, pageId, name);
    });

    test('a created category is persisted to the API for that page', async ({ page }) => {
        await loadDashboard(page);
        await openAddBookmark(page);
        const { catSelect } = selects(page);
        const name = `E2E persist ${Date.now()}`;

        await catSelect.selectOption('__new__');
        const row = createRow(page, 'category');
        await row.locator('.bookmark-inline-create-input').fill(name);
        await row.locator('.bookmark-inline-create-ok').click();
        await expect(row).toBeHidden();

        const pageId = await page.evaluate(() => Number(window.dashboardInstance?.currentPageId) || 1);
        const stored = await page.evaluate(async (pid) => {
            const res = await fetch(`/api/categories?page=${pid}`);
            return res.ok ? await res.json() : [];
        }, pageId);
        expect(stored.some((c) => c.name === name)).toBe(true);

        await deleteCategoryByName(page, pageId, name);
    });

    test('choosing "New page…" creates the page and selects it', async ({ page }) => {
        await loadDashboard(page);
        await openAddBookmark(page);
        const { pageSelect } = selects(page);
        const name = `E2E page ${Date.now()}`;

        await pageSelect.selectOption('__new__');
        const row = createRow(page, 'page');
        await expect(row).toBeVisible();
        await expect(pageSelect).toBeHidden();

        await row.locator('.bookmark-inline-create-input').fill(name);
        await row.locator('.bookmark-inline-create-ok').click();

        await expect(row).toBeHidden();
        await expect(pageSelect).toBeVisible();
        const selectedText = await pageSelect.locator('option:checked').textContent();
        expect(selectedText).toBe(name);

        const stored = await page.evaluate(async () => {
            const res = await fetch('/api/pages');
            return res.ok ? await res.json() : [];
        });
        expect(stored.some((p) => p.name === name)).toBe(true);

        await deletePageByName(page, name);
    });

    test('a category created after a new page lands on that new page', async ({ page }) => {
        await loadDashboard(page);
        await openAddBookmark(page);
        const { pageSelect, catSelect } = selects(page);
        const pageName = `E2E page ${Date.now()}`;
        const catName = `E2E oncat ${Date.now()}`;

        await pageSelect.selectOption('__new__');
        const pageRow = createRow(page, 'page');
        await pageRow.locator('.bookmark-inline-create-input').fill(pageName);
        await pageRow.locator('.bookmark-inline-create-ok').click();
        await expect(pageRow).toBeHidden();

        const newPageId = Number(await pageSelect.inputValue());
        expect(Number.isFinite(newPageId)).toBe(true);

        await catSelect.selectOption('__new__');
        const catRow = createRow(page, 'category');
        await catRow.locator('.bookmark-inline-create-input').fill(catName);
        await catRow.locator('.bookmark-inline-create-ok').click();
        await expect(catRow).toBeHidden();

        const stored = await page.evaluate(async (pid) => {
            const res = await fetch(`/api/categories?page=${pid}`);
            return res.ok ? await res.json() : [];
        }, newPageId);
        expect(stored.some((c) => c.name === catName)).toBe(true);

        await deletePageByName(page, pageName);
    });

    test('Cancel restores the previously selected value instead of leaving __new__', async ({ page }) => {
        await loadDashboard(page);
        await openAddBookmark(page);
        const { pageSelect } = selects(page);
        const before = await pageSelect.inputValue();

        await pageSelect.selectOption('__new__');
        const row = createRow(page, 'page');
        await expect(row).toBeVisible();
        await row.locator('.bookmark-inline-create-cancel').click();

        await expect(row).toBeHidden();
        await expect(pageSelect).toBeVisible();
        await expect(pageSelect).toHaveValue(before);
    });

    test('the select never carries __new__ while the create row is open', async ({ page }) => {
        await loadDashboard(page);
        await openAddBookmark(page);
        const { pageSelect, catSelect } = selects(page);
        const pageBefore = await pageSelect.inputValue();
        const catBefore = await catSelect.inputValue();

        // A save while the row is open must target a real page/category, so the
        // sentinel is swapped back out the moment the row appears.
        await pageSelect.selectOption('__new__');
        await expect(createRow(page, 'page')).toBeVisible();
        await expect(pageSelect).toHaveValue(pageBefore);

        await page.locator('#bookmark-form-modal .bookmark-inline-create[data-create-kind="page"] .bookmark-inline-create-cancel').click();

        await catSelect.selectOption('__new__');
        await expect(createRow(page, 'category')).toBeVisible();
        await expect(catSelect).toHaveValue(catBefore);
    });

    test('a duplicate name is refused with an inline error and the row stays open', async ({ page }) => {
        await loadDashboard(page);
        await openAddBookmark(page);
        const { catSelect } = selects(page);

        // Reuse an existing category's name so the create is a genuine duplicate.
        const existingName = await page.evaluate(() => {
            const cats = window.dashboardInstance?.categories || [];
            return cats.length ? String(cats[0].name || '') : '';
        });
        test.skip(!existingName, 'page has no categories to duplicate');

        await catSelect.selectOption('__new__');
        const row = createRow(page, 'category');
        await row.locator('.bookmark-inline-create-input').fill(existingName);
        await row.locator('.bookmark-inline-create-ok').click();

        await expect(row).toBeVisible();
        await expect(row.locator('.bookmark-inline-conflict')).toBeVisible();
    });

    test('Escape in the create input closes the row, not the whole modal', async ({ page }) => {
        await loadDashboard(page);
        await openAddBookmark(page);
        const { catSelect } = selects(page);

        await catSelect.selectOption('__new__');
        const row = createRow(page, 'category');
        await expect(row).toBeVisible();
        await row.locator('.bookmark-inline-create-input').press('Escape');

        await expect(row).toBeHidden();
        await expect(page.locator('#bookmark-form-modal')).toHaveClass(/show/);
    });

    test('a bookmark saves into a category created from the form', async ({ page }) => {
        await loadDashboard(page);
        await page.waitForSelector('#dashboard-layout .bookmark-link', { timeout: 15_000 });
        await openAddBookmark(page);

        const { form, catSelect } = selects(page);
        const catName = `E2E save ${Date.now()}`;
        const url = `https://example.com/created-cat-${Date.now()}.test`;

        await catSelect.selectOption('__new__');
        const row = createRow(page, 'category');
        await row.locator('.bookmark-inline-create-input').fill(catName);
        await row.locator('.bookmark-inline-create-ok').click();
        await expect(row).toBeHidden();
        const catId = await catSelect.inputValue();

        await form.locator('input[type="url"]').fill(url);
        await form.locator('.bookmark-inline-input').first().fill('Created cat bookmark');
        await form.locator('.bookmark-inline-actions > .bookmark-inline-save').click();
        await expect(page.locator('#bookmark-form-modal')).not.toHaveClass(/show/, { timeout: 10_000 });

        await expect(page.locator(
            `.category[data-category-id="${catId}"]:not([data-smart-collection="true"]) .bookmark-link[data-bookmark-url="${url}"]`
        )).toBeVisible({ timeout: 10_000 });

        const pageId = await page.evaluate(() => Number(window.dashboardInstance?.currentPageId) || 1);
        await page.evaluate(async ({ targetPageId, targetUrl }) => {
            const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
            const res = await api(`/api/bookmarks?page=${targetPageId}`);
            if (!res.ok) return;
            const list = await res.json();
            const bookmark = (list || []).find(
                (bm) => String(bm?.url || '').trim().toLowerCase() === targetUrl.toLowerCase()
            );
            if (!bookmark) return;
            await api('/api/bookmarks', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ page: targetPageId, bookmark }),
            });
        }, { targetPageId: pageId, targetUrl: url });
        await deleteCategoryByName(page, pageId, catName);
    });
});
