// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * A label row between the bookmarks of a category: added from the category
 * menu, named inline, moved, deleted with an undo, kept across a reload, and
 * never a bookmark.
 */

async function openDashboard(page) {
    await page.setViewportSize({ width: 1400, height: 900 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });
}

let usedCategory = null;

/** A stored category in manual order with at least three rows on screen. */
async function pickCategory(page) {
    usedCategory = await page.evaluate(() => {
        const d = window.dashboardInstance;
        for (const cat of d.categories || []) {
            const list = document.querySelector(`.bookmarks-list[data-category-id="${CSS.escape(String(cat.id))}"]`);
            if (list && list.querySelectorAll('.bookmark-link').length >= 3
                && window.DashboardCategorySort.getCategorySortMode(d, { id: cat.id }) === 'order') {
                return String(cat.id);
            }
        }
        return null;
    });
    return usedCategory;
}

async function addLabel(page, id, name) {
    const title = page.locator(`.category[data-category-id="${id}"] .category-title`).first();
    await title.scrollIntoViewIfNeeded();
    await title.click({ button: 'right' });
    await page.locator('#category-context-menu [role="menuitem"]', { hasText: 'Add label' }).click();
    const input = page.locator('.category-divider-input');
    await expect(input).toBeFocused();
    await input.fill(name);
    await input.press('Enter');
}

test.describe('category dividers', () => {
    // One category in the shared data dir: the tests take turns and clean up.
    test.describe.configure({ mode: 'serial' });

    test.afterEach(async ({ page }) => {
        if (!usedCategory) return;
        await page.evaluate(async (cid) => {
            const d = window.dashboardInstance;
            const cat = d.categories.find((c) => String(c.id) === cid);
            if (cat) delete cat.dividers;
            window.DashboardCategorySort.setCategorySortMode(d, cid, 'order');
            await d.renderCore.saveCategoryOrder();
        }, usedCategory);
        await page.waitForTimeout(1200);
        usedCategory = null;
    });

    test('add, name, reload, move, delete and undo', async ({ page }) => {
        await openDashboard(page);
        const id = await pickCategory(page);
        test.skip(!id, 'no category with three rows in the seed');
        const rowsBefore = await page.locator(`.bookmarks-list[data-category-id="${id}"] .bookmark-link`).count();
        const bookmarksBefore = await page.evaluate(() => window.dashboardInstance.bookmarks.length);

        await addLabel(page, id, 'Beheer');
        const divider = page.locator(`.category-divider[data-category-id="${id}"]`);
        await expect(divider).toHaveCount(1);
        await expect(divider).toContainText('Beheer');

        // Not a bookmark: no new row, nothing in the bookmark list.
        expect(await page.locator(`.bookmarks-list[data-category-id="${id}"] .bookmark-link`).count()).toBe(rowsBefore);
        expect(await page.evaluate(() => window.dashboardInstance.bookmarks.length)).toBe(bookmarksBefore);

        // Saved with the category, so it is still there after a reload.
        await page.waitForTimeout(1500);
        await page.reload();
        await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });
        await expect(page.locator(`.category-divider[data-category-id="${id}"]`)).toContainText('Beheer');

        // A new label stands at the end; Alt+ArrowUp moves it one row up.
        const slot = () => page.evaluate((cid) => {
            const list = document.querySelector(`.bookmarks-list[data-category-id="${CSS.escape(cid)}"]`);
            let rows = 0;
            for (const c of list.children) {
                if (c.classList.contains('bookmark-link')) rows += 1;
                else if (c.classList.contains('category-divider')) return rows;
            }
            return -1;
        }, id);
        const before = await slot();
        await page.locator(`.category-divider[data-category-id="${id}"]`).focus();
        await page.keyboard.press('Alt+ArrowUp');
        expect(await slot()).toBe(before - 1);

        // Delete, then Undo.
        await page.keyboard.press('Delete');
        await expect(page.locator(`.category-divider[data-category-id="${id}"]`)).toHaveCount(0);
        await page.locator('#app-notification .app-notification-action, #app-notification button', { hasText: /undo/i }).first().click();
        await expect(page.locator(`.category-divider[data-category-id="${id}"]`)).toHaveCount(1);
    });

    test('a new label with no name goes again; Escape on a rename keeps the old name', async ({ page }) => {
        await openDashboard(page);
        const id = await pickCategory(page);
        test.skip(!id, 'no category with three rows in the seed');

        const title = page.locator(`.category[data-category-id="${id}"] .category-title`).first();
        await title.scrollIntoViewIfNeeded();
        await title.click({ button: 'right' });
        await page.locator('#category-context-menu [role="menuitem"]', { hasText: 'Add label' }).click();
        const input = page.locator('.category-divider-input');
        await input.fill('');
        await input.press('Enter');
        await expect(page.locator(`.category-divider[data-category-id="${id}"]`)).toHaveCount(0);

        await addLabel(page, id, 'Media');
        await page.locator('.category-divider-label').click();
        const rename = page.locator('.category-divider-input');
        await rename.fill('Other');
        await rename.press('Escape');
        await expect(page.locator(`.category-divider[data-category-id="${id}"]`)).toContainText('Media');
    });

    test('a row dragged across a label changes group', async ({ page }) => {
        await openDashboard(page);
        const id = await pickCategory(page);
        test.skip(!id, 'no category with three rows in the seed');
        await addLabel(page, id, 'Media');
        // The label stands at the end of the category; put a row below it the
        // way a drag does, then read the slot back.
        const slot = await page.evaluate((cid) => {
            const list = document.querySelector(`.bookmarks-list[data-category-id="${CSS.escape(cid)}"]`);
            const label = list.querySelector('.category-divider');
            const first = list.querySelector('.bookmark-link');
            label.after(first);
            window.DashboardCategoryDividers.syncFromDom(window.dashboardInstance);
            const cat = window.dashboardInstance.categories.find((c) => String(c.id) === cid);
            return cat.dividers[0].index;
        }, id);
        const rows = await page.locator(`.bookmarks-list[data-category-id="${id}"] .bookmark-link`).count();
        expect(slot).toBe(rows - 1);
    });

    test('a sorted category hides its labels and keeps them', async ({ page }) => {
        await openDashboard(page);
        const id = await pickCategory(page);
        test.skip(!id, 'no category with three rows in the seed');
        await addLabel(page, id, 'Beheer');
        await page.evaluate((cid) => {
            const d = window.dashboardInstance;
            window.DashboardCategorySort.setCategorySortMode(d, cid, 'az');
        }, id);
        await page.evaluate(() => window.dashboardInstance.initializeCategoryReorder());
        await expect(page.locator(`.category-divider[data-category-id="${id}"]`)).toHaveCount(0);
        const kept = await page.evaluate((cid) => window.dashboardInstance.categories.find((c) => String(c.id) === cid).dividers?.length, id);
        expect(kept).toBe(1);
    });

    test('a label stays with its group when a bookmark above it goes', async ({ page }) => {
        await openDashboard(page);
        const id = await pickCategory(page);
        test.skip(!id, 'no category with three rows in the seed');
        await addLabel(page, id, 'Media');
        // Put the label above the third row, then take the first row away the
        // way a delete does and draw again.
        const result = await page.evaluate((cid) => {
            const d = window.dashboardInstance;
            const list = document.querySelector(`.bookmarks-list[data-category-id="${CSS.escape(cid)}"]`);
            const rows = [...list.querySelectorAll('.bookmark-link')];
            list.querySelector('.category-divider').remove();
            list.insertBefore(Object.assign(document.createElement('div'), { className: 'category-divider' }), rows[2]);
            const marker = list.querySelector('.category-divider');
            marker.setAttribute('data-divider-id', d.categories.find((c) => String(c.id) === cid).dividers[0].id);
            marker.setAttribute('data-category-id', cid);
            window.DashboardCategoryDividers.syncFromDom(d);
            const want = rows[2].getAttribute('data-bookmark-url');
            rows[0].remove();
            window.DashboardCategoryDividers.decorate(d);
            const below = list.querySelector('.category-divider').nextElementSibling;
            return { want, got: below?.getAttribute('data-bookmark-url') };
        }, id);
        expect(result.got).toBe(result.want);
    });

    test('Add label lands above "+ N more", and a label over a hidden row is hidden', async ({ page }) => {
        await openDashboard(page);
        const id = await pickCategory(page);
        test.skip(!id, 'no category with three rows in the seed');
        await page.evaluate((cid) => {
            const d = window.dashboardInstance;
            d.settings.categoryItemLimit = 2;
            const list = document.querySelector(`.bookmarks-list[data-category-id="${CSS.escape(cid)}"]`);
            d.renderCore.applyCategoryItemLimit(list, d.categories.find((c) => String(c.id) === cid));
        }, id);
        await addLabel(page, id, 'Beheer');
        const list = page.locator(`.bookmarks-list[data-category-id="${id}"]`);
        const order = await list.evaluate((el) => [...el.children].map((c) => c.className.split(' ')[0]));
        expect(order[order.length - 1]).toBe('category-show-more');
        expect(order[order.length - 2]).toBe('category-divider');
        await page.evaluate(() => { window.dashboardInstance.settings.categoryItemLimit = 0; });
    });

    test('Lock layout takes the label menus away', async ({ page }) => {
        await openDashboard(page);
        const id = await pickCategory(page);
        test.skip(!id, 'no category with three rows in the seed');
        await page.evaluate(() => { window.dashboardInstance.settings.lockLayout = true; });
        const title = page.locator(`.category[data-category-id="${id}"] .category-title`).first();
        await title.scrollIntoViewIfNeeded();
        await title.click({ button: 'right' });
        await expect(page.locator('#category-context-menu [role="menuitem"]').first()).toBeVisible();
        await expect(page.locator('#category-context-menu [role="menuitem"]', { hasText: 'Add label' })).toHaveCount(0);
        await page.keyboard.press('Escape');
        await page.evaluate(() => { window.dashboardInstance.settings.lockLayout = false; });
    });

    test('a spread category draws the label across every column', async ({ page }) => {
        await openDashboard(page);
        const id = await pickCategory(page);
        test.skip(!id, 'no category with three rows in the seed');
        await addLabel(page, id, 'Beheer');
        const span = await page.evaluate((cid) => {
            const cat = document.querySelector(`.category[data-category-id="${CSS.escape(cid)}"]`);
            cat.classList.add('category--wide');
            const el = cat.querySelector('.category-divider');
            const col = getComputedStyle(el).gridColumnStart + '/' + getComputedStyle(el).gridColumnEnd;
            cat.classList.remove('category--wide');
            return col;
        }, id);
        expect(span).toBe('1/-1');
    });
});
