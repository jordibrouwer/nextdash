// @ts-check
const { test, expect } = require('./fixtures');
const { dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * Alt+↑/↓ moves a bookmark within its category; Shift+Alt+←/→ moves it to the
 * category beside it.
 *
 * Both resolved the row's list with row.closest('[data-category-id]'). Every
 * bookmark row carries that attribute itself, and closest() tests the element
 * first — so the "list" was the row. Alt+↑/↓ then searched for rows inside a
 * single row, found none, and returned false every time: the shortcut did
 * nothing at all. The sideways move was worse than nothing, because an
 * unqualified [data-category-id] selector matches categories, lists and rows
 * alike, so "the category beside it" was usually the next row.
 */

async function openDashboard(page) {
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });
}

/** Put the keyboard cursor on a row of a manually-ordered category with siblings. */
async function focusMovableRow(page) {
    return page.evaluate(() => {
        const d = window.dashboardInstance;
        const kn = d.keyboardNavigation;
        kn.updateNavigableElements?.();
        const rows = kn.navigableElements || [];
        for (let i = 0; i < rows.length; i += 1) {
            const row = rows[i];
            const list = row.closest?.('.bookmarks-list[data-category-id]');
            if (!list || list.getAttribute('data-smart-collection') === 'true') continue;
            const siblings = [...list.querySelectorAll('.bookmark-link')];
            const at = siblings.indexOf(row);
            // Not the last one, so a downward move has somewhere to go.
            if (siblings.length < 2 || at < 0 || at >= siblings.length - 1) continue;
            const id = list.getAttribute('data-category-id') || '';
            const mode = window.DashboardCategorySort?.getCategorySortMode?.(d, { id }) || 'order';
            if (mode !== 'order') continue;
            kn.currentIndex = i;
            kn.highlightCurrentElement?.({ keyboardNav: true });
            // The key handler resolves the row through _resolveActionPopoverRow,
            // which reads the focused element -- so focus it, rather than only
            // setting the index.
            (row.querySelector('a') || row).focus?.();
            return {
                categoryId: id,
                url: row.getAttribute('data-bookmark-url'),
                order: siblings.map((r) => r.getAttribute('data-bookmark-url')),
            };
        }
        return null;
    });
}

test.describe('moving a bookmark with the keyboard', () => {
    test('Alt+ArrowDown moves the row down inside its category', async ({ page }) => {
        await openDashboard(page);
        const before = await focusMovableRow(page);
        test.skip(before === null, 'needs a manually-ordered category with two rows');

        await page.keyboard.press('Alt+ArrowDown');
        await page.waitForTimeout(900);

        // Read the category's own list by id. A bookmark can also be rendered
        // in a smart collection such as Today, so looking the row up by url
        // alone can land on the copy that was never being moved.
        const after = await page.evaluate((categoryId) => {
            const list = document.querySelector(
                `.bookmarks-list[data-category-id="${CSS.escape(categoryId)}"]:not([data-smart-collection="true"])`,
            );
            return [...(list?.querySelectorAll('.bookmark-link') || [])]
                .map((r) => r.getAttribute('data-bookmark-url'));
        }, before.categoryId);

        // The row it started above is now above it.
        const wasAt = before.order.indexOf(before.url);
        const nowAt = after.indexOf(before.url);
        expect(nowAt).toBe(wasAt + 1);
    });

    test('the list a row belongs to is the list, not the row itself', async ({ page }) => {
        await openDashboard(page);

        // The defect in one assertion: closest() has to reach the container,
        // because everything the move does is counted from it.
        const shape = await page.evaluate(() => {
            const row = document.querySelector('#dashboard-layout .bookmark-link[data-bookmark-url]');
            if (!row) return null;
            const list = row.closest('.bookmarks-list[data-category-id]');
            return {
                rowCarriesCategoryId: row.hasAttribute('data-category-id'),
                listIsNotTheRow: list !== null && list !== row,
                siblingsFound: list ? list.querySelectorAll('.bookmark-link').length : 0,
            };
        });
        expect(shape).not.toBeNull();
        expect(shape.listIsNotTheRow).toBe(true);
        expect(shape.siblingsFound).toBeGreaterThan(0);
    });
});

/**
 * The sort-locked hint is written onto the list element, which the incremental
 * render reuses. A one-shot "already bound" flag meant it was written once: the
 * tooltip kept naming the first sort mode a category was ever given, and
 * switching back to manual order left a tooltip saying dragging was impossible
 * over a list that dragged fine.
 */
test.describe('the sort-locked drag hint', () => {
    test('follows the sort mode instead of naming the first one', async ({ page }) => {
        await openDashboard(page);

        // Reading the title means no preview card may be coming for these rows.
        await page.evaluate(() => {
            const d = window.dashboardInstance;
            d.settings.linkPreviewMode = 'off';
            d.settings.showLinkPreviewCards = false;
        });

        const categoryId = await page.evaluate(() => {
            const el = document.querySelector(
                '#dashboard-layout .bookmarks-list[data-category-id]:not([data-smart-collection="true"])',
            );
            return el ? el.getAttribute('data-category-id') : null;
        });
        test.skip(categoryId === null, 'needs a real category');

        const setMode = async (mode) => page.evaluate(({ id, m }) => {
            const d = window.dashboardInstance;
            window.DashboardCategorySort.setCategorySortMode(d, id, m);
            d.renderDashboard();
        }, { id: categoryId, m: mode });

        const titleOf = () => page.evaluate((id) => document.querySelector(
            `.bookmarks-list[data-category-id="${CSS.escape(id)}"]:not([data-smart-collection="true"])`,
        )?.getAttribute('title') || '', categoryId);

        await setMode('az');
        await page.waitForTimeout(400);
        expect(await titleOf()).toMatch(/A–Z|A-Z/i);

        // The wording follows the new mode rather than sticking on the old one.
        await setMode('opened');
        await page.waitForTimeout(400);
        const recent = await titleOf();
        expect(recent).not.toMatch(/A–Z|A-Z/i);

        // And manual order leaves no hint at all, since dragging works there.
        await setMode('order');
        await page.waitForTimeout(400);
        expect(await titleOf()).toBe('');
    });
});
