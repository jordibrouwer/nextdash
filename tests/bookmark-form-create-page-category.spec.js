// @ts-check
const { test, expect } = require('./fixtures');
const { dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

async function loadDashboard(page) {
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
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

/** The one field for where a bookmark goes, and the popover it opens. */
function place(page) {
    return page.locator('#bookmark-form-modal .bookmark-form-place-field');
}
function pop(page) {
    return page.locator('.bookmark-form-place-pop');
}
function createRow(page, kind) {
    return page.locator(`#bookmark-form-modal .bookmark-inline-create[data-create-kind="${kind}"]`);
}

/** The value the save reads: the hidden category select behind the field. */
async function chosenCategoryId(page) {
    return page.evaluate(() => {
        const sel = [...document.querySelectorAll('#bookmark-form-modal .bookmark-inline-select')]
            .filter((s) => !s.classList.contains('bookmark-inline-toggle-select'));
        return sel[sel.length - 1]?.value || '';
    });
}

async function openPlace(page) {
    await place(page).locator('.bookmark-form-place-value').click();
    await expect(pop(page)).toBeVisible();
}

/*
 * Page and category are one field.
 *
 * It opens the popover Move to… uses on the dashboard, and its first two rows
 * make somewhere new through the create row the two selects always had: a
 * name, Create, Cancel, and an error on the row itself.
 */
test.describe('bookmark form — page › category in one field', () => {
    test('opens the Move to… popover, with the two create rows first', async ({ page }) => {
        await loadDashboard(page);
        await openAddBookmark(page);
        await expect(place(page).locator('.bookmark-form-place-value')).toContainText('›');
        await openPlace(page);
        const first = await pop(page).locator('.move-popover-item').evaluateAll((els) =>
            els.slice(0, 2).map((el) => el.getAttribute('data-place-create')));
        expect(first).toEqual(['category', 'page']);
    });

    test('New category… creates it on the chosen page and selects it', async ({ page }) => {
        await loadDashboard(page);
        await openAddBookmark(page);
        const name = `E2E cat ${Date.now()}`;
        await openPlace(page);
        await pop(page).locator('[data-place-create="category"]').click();
        const row = createRow(page, 'category');
        await expect(row).toBeVisible();
        await row.locator('.bookmark-inline-create-input').fill(name);
        await row.locator('.bookmark-inline-create-ok').click();
        await expect(row).toBeHidden();
        await expect(place(page).locator('.bookmark-form-place-value')).toContainText(name);
        const pageId = await page.evaluate(() => Number(window.dashboardInstance?.currentPageId) || 1);
        const stored = await page.evaluate(async (pid) => (await (await fetch(`/api/categories?page=${pid}`)).json()), pageId);
        expect(stored.some((c) => c.name === name)).toBe(true);
        await deleteCategoryByName(page, pageId, name);
    });

    test('New page… creates the page, then asks for its first category', async ({ page }) => {
        await loadDashboard(page);
        await openAddBookmark(page);
        const pageName = `E2E page ${Date.now()}`;
        await openPlace(page);
        await pop(page).locator('[data-place-create="page"]').click();
        await createRow(page, 'page').locator('.bookmark-inline-create-input').fill(pageName);
        await createRow(page, 'page').locator('.bookmark-inline-create-ok').click();
        const catRow = createRow(page, 'category');
        await expect(catRow).toBeVisible();
        await catRow.locator('.bookmark-inline-create-input').fill('First');
        await catRow.locator('.bookmark-inline-create-ok').click();
        await expect(place(page).locator('.bookmark-form-place-value')).toContainText(`${pageName} › First`);
        await deletePageByName(page, pageName);
    });

    test('a duplicate name is refused on the row, which stays open', async ({ page }) => {
        await loadDashboard(page);
        await openAddBookmark(page);
        const existing = await page.evaluate(() => String((window.dashboardInstance?.categories || [])[0]?.name || ''));
        test.skip(!existing, 'page has no categories');
        await openPlace(page);
        await pop(page).locator('[data-place-create="category"]').click();
        const row = createRow(page, 'category');
        await row.locator('.bookmark-inline-create-input').fill(existing);
        await row.locator('.bookmark-inline-create-ok').click();
        await expect(row).toBeVisible();
        await expect(row.locator('.bookmark-inline-conflict')).toBeVisible();
    });

    test('Escape closes the popover, and then the create row, not the form', async ({ page }) => {
        await loadDashboard(page);
        await openAddBookmark(page);
        await openPlace(page);
        await page.keyboard.press('Escape');
        await expect(pop(page)).toHaveCount(0);
        await expect(page.locator('#bookmark-form-modal')).toHaveClass(/show/);
        await openPlace(page);
        await pop(page).locator('[data-place-create="category"]').click();
        await createRow(page, 'category').locator('.bookmark-inline-create-input').press('Escape');
        await expect(createRow(page, 'category')).toBeHidden();
        await expect(place(page).locator('.bookmark-form-place-value')).toBeVisible();
        await expect(page.locator('#bookmark-form-modal')).toHaveClass(/show/);
    });

    test('typing in the popover finds a category; arrows and Enter pick it', async ({ page }) => {
        await loadDashboard(page);
        await openAddBookmark(page);
        const target = await page.evaluate(() => {
            const cats = (window.dashboardInstance?.categories || []).filter((c) => !c.isSmartCollection);
            return cats.length ? { id: String(cats[cats.length - 1].id), name: String(cats[cats.length - 1].name) } : null;
        });
        test.skip(!target, 'page has no categories');
        await place(page).locator('.bookmark-form-place-value').focus();
        await page.keyboard.press('Enter');
        await expect(pop(page)).toBeVisible();
        await page.keyboard.type(target.name);
        await expect(pop(page).locator('.bookmark-form-place-option')).toHaveCount(1);
        await page.keyboard.press('ArrowDown');
        await page.keyboard.press('Enter');
        await expect(pop(page)).toHaveCount(0);
        expect(await chosenCategoryId(page)).toBe(target.id);
    });

    test('a click beside the popover closes it', async ({ page }) => {
        await loadDashboard(page);
        await openAddBookmark(page);
        await openPlace(page);
        await page.locator('#bookmark-form-modal [data-field="url"]').click();
        await expect(pop(page)).toHaveCount(0);
    });

    test('a bookmark saves into a category created from the field', async ({ page }) => {
        await loadDashboard(page);
        await page.waitForSelector('#dashboard-layout .bookmark-link', { timeout: 15_000 });
        await openAddBookmark(page);
        const form = page.locator('#bookmark-form-modal .bookmark-inline-form');
        const catName = `E2E save ${Date.now()}`;
        const url = `https://example.com/created-cat-${Date.now()}.test`;

        await openPlace(page);
        await pop(page).locator('[data-place-create="category"]').click();
        await createRow(page, 'category').locator('.bookmark-inline-create-input').fill(catName);
        await createRow(page, 'category').locator('.bookmark-inline-create-ok').click();
        await expect(place(page).locator('.bookmark-form-place-value')).toContainText(catName);
        const catId = await chosenCategoryId(page);

        await form.locator('input[type="url"]').fill(url);
        await form.locator('[data-field="name"]').fill('Created cat bookmark');
        await form.locator('.bookmark-inline-actions .bookmark-inline-save').click();
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
