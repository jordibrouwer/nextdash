// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * A category can show its bookmarks as tiles. Rows stay the default.
 *
 * Chosen from the category's own menu, kept on the category, and drawn by CSS
 * from the same bookmark DOM a row has.
 */
async function openDashboard(page) {
    await page.setViewportSize({ width: 1400, height: 900 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('.category-title', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });
}

/** The id of a stored category with at least two bookmarks. */
const pickCategory = (page) => page.evaluate(() => {
    const el = [...document.querySelectorAll('#dashboard-layout .category[data-category-id]')]
        .find((c) => !c.hasAttribute('data-smart-collection') && !c.hasAttribute('data-virtual-category')
            && !c.classList.contains('dashboard-widget') && c.querySelectorAll('.bookmark-link').length >= 2);
    return el ? el.getAttribute('data-category-id') : null;
});

const block = (page, id) => page.locator(`#dashboard-layout .category[data-category-id="${id}"]`);

/** Picks the entry and waits for the save it causes, so the next test starts from what this one left. */
async function choose(page, id, label) {
    await block(page, id).locator('.category-title').first().click({ button: 'right' });
    const saved = page.waitForResponse((r) => r.url().includes('/api/categories') && r.request().method() === 'POST');
    await page.locator('#category-context-menu').getByText(label, { exact: true }).click();
    await saved;
}

test.describe('category tiles', () => {
    test('a category goes to tiles from its menu, keeps them, and goes back to rows', async ({ page }) => {
        await openDashboard(page);
        const id = await pickCategory(page);
        expect(id).not.toBeNull();

        // Rows by default: no attribute, a list.
        await expect(block(page, id)).not.toHaveAttribute('data-view', 'tiles');

        await choose(page, id, 'Show as tiles');
        await expect(block(page, id)).toHaveAttribute('data-view', 'tiles');
        const shape = await block(page, id).evaluate((el) => {
            const list = el.querySelector('.bookmarks-list');
            const first = list.querySelector('.bookmark-link');
            return {
                list: getComputedStyle(list).display,
                tile: getComputedStyle(first).flexDirection,
                columns: getComputedStyle(list).gridTemplateColumns.split(' ').length,
            };
        });
        expect(shape.list).toBe('grid');
        expect(shape.tile).toBe('column');
        expect(shape.columns).toBeGreaterThanOrEqual(2);

        // Kept: the same after a reload.
        await page.reload();
        await page.waitForSelector('.category-title', { timeout: 20_000 });
        await expect(block(page, id)).toHaveAttribute('data-view', 'tiles');

        await choose(page, id, 'Show as rows');
        await expect(block(page, id)).not.toHaveAttribute('data-view', 'tiles');
    });

    test('a tile being edited takes the whole row, not one cell', async ({ page }) => {
        await openDashboard(page);
        const id = await pickCategory(page);
        await choose(page, id, 'Show as tiles');
        const edit = await block(page, id).evaluate((el) => {
            const tile = el.querySelector('.bookmarks-list > .bookmark-link');
            tile.classList.add('bookmark-inline-editing');
            const cs = getComputedStyle(tile);
            return { display: cs.display, start: cs.gridColumnStart, end: cs.gridColumnEnd };
        });
        expect(edit.display).toBe('block');
        expect(edit.start).toBe('1');
        expect(edit.end).toBe('-1');
        await choose(page, id, 'Show as rows');
    });

    test('other categories stay rows', async ({ page }) => {
        await openDashboard(page);
        const id = await pickCategory(page);
        await choose(page, id, 'Show as tiles');
        await expect(block(page, id)).toHaveAttribute('data-view', 'tiles');
        const others = await page.evaluate((chosen) => [...document.querySelectorAll('#dashboard-layout .category[data-category-id]')]
            .filter((c) => c.getAttribute('data-category-id') !== chosen && c.getAttribute('data-view') === 'tiles').length, id);
        expect(others).toBe(0);
        // Leave the page as it was found: the data directory is shared.
        await choose(page, id, 'Show as rows');
    });

    test('a smart collection has no tile entry', async ({ page }) => {
        await openDashboard(page);
        const smart = page.locator('#dashboard-layout .category[data-smart-collection="true"] .category-title').first();
        if (await smart.count() === 0) test.skip(true, 'no smart collection on this page');
        await smart.click({ button: 'right' });
        // Whatever the title offers on a right click, tiles are not in it.
        await page.waitForTimeout(300);
        await expect(page.getByText('Show as tiles', { exact: true })).toHaveCount(0);
    });
});

test.describe('category tiles on a touch screen', () => {
    test.use({ hasTouch: true, isMobile: true });

    test('the drag handle stays reachable, since touch only drags from it', async ({ page }) => {
        await page.setViewportSize({ width: 900, height: 900 });
        await markWhatsNewSeen(page);
        await page.goto('/');
        await page.waitForSelector('.category-title', { timeout: 20_000 });
        const coarse = await page.evaluate(() => matchMedia('(pointer: coarse)').matches);
        test.skip(!coarse, 'this browser does not report a coarse pointer');
        const shown = await page.evaluate(() => {
            const el = document.querySelector('#dashboard-layout .category[data-category-id]:not([data-smart-collection])');
            el.setAttribute('data-view', 'tiles');
            const handle = el.querySelector('.bookmarks-list > .bookmark-link .bookmark-reorder-handle');
            return handle ? getComputedStyle(handle).display : null;
        });
        expect(shown).not.toBeNull();
        expect(shown).not.toBe('none');
    });
});
