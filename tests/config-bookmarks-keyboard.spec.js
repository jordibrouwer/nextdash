// @ts-check
const { test, expect } = require('./fixtures');
const { openBookmarksWithRows } = require('./config-bookmarks-helpers');

test.describe('config bookmarks keyboard navigation', () => {
    test('j and k move between bookmark rows and highlight the selection', async ({ page }) => {
        await openBookmarksWithRows(page, [
            { name: 'Alpha', url: 'https://alpha.example', pageId: 1 },
            { name: 'Beta', url: 'https://beta.example', pageId: 1 },
        ]);

        await page.locator('#config-bm-list').click();
        await page.keyboard.press('j');
        await expect(page.locator('.config-bm-row').first()).toHaveClass(/keyboard-selected/);

        await page.keyboard.press('j');
        await expect(page.locator('.config-bm-row').nth(1)).toHaveClass(/keyboard-selected/);
        await expect(page.locator('.config-bm-row').first()).not.toHaveClass(/keyboard-selected/);

        await page.keyboard.press('k');
        await expect(page.locator('.config-bm-row').first()).toHaveClass(/keyboard-selected/);
    });

    test('e opens the edit bookmark modal', async ({ page }) => {
        await openBookmarksWithRows(page, [
            { name: 'Alpha', url: 'https://alpha.example', pageId: 1 },
        ]);

        await page.locator('#config-bm-list').click();
        await page.keyboard.press('j');
        await page.keyboard.press('e');
        await expect(page.locator('#bookmark-form-modal.show')).toBeVisible();
        await expect(page.locator('#bookmark-form-modal .bookmark-inline-input').first()).toBeFocused();
    });

    test('g and Shift+G jump to first and last bookmark rows', async ({ page }) => {
        await openBookmarksWithRows(page, [
            { name: 'Alpha', url: 'https://alpha.example', pageId: 1 },
            { name: 'Beta', url: 'https://beta.example', pageId: 1 },
            { name: 'Gamma', url: 'https://gamma.example', pageId: 1 },
        ]);

        await page.locator('#config-bm-list').click();
        await page.keyboard.press('j');
        await page.keyboard.press('Shift+G');
        await expect(page.locator('.config-bm-row').nth(2)).toHaveClass(/keyboard-selected/);

        await page.keyboard.press('g');
        await expect(page.locator('.config-bm-row').first()).toHaveClass(/keyboard-selected/);
    });

    test('slash focuses the bookmark search field', async ({ page }) => {
        await openBookmarksWithRows(page, [
            { name: 'Alpha', url: 'https://alpha.example', pageId: 1 },
        ]);

        await page.locator('#config-bm-list').click();
        await page.keyboard.press('/');
        await expect(page.locator('#config-bm-search')).toBeFocused();
    });

    test('Escape closes the modal before clearing list selection', async ({ page }) => {
        await openBookmarksWithRows(page, [
            { name: 'Alpha', url: 'https://alpha.example', pageId: 1 },
        ]);

        await page.locator('#config-bm-list').click();
        await page.keyboard.press('j');
        await page.keyboard.press('e');
        await expect(page.locator('#bookmark-form-modal.show')).toBeVisible();

        await page.keyboard.press('Escape');
        await expect(page.locator('#bookmark-form-modal')).not.toHaveClass(/show/);
        await expect(page.locator('.config-bm-row').first()).toHaveClass(/keyboard-selected/);
        await expect(page.locator('#dashboard-layout')).toHaveClass(/config-layout/);

        await page.keyboard.press('Escape');
        await expect(page.locator('.config-bm-row').first()).not.toHaveClass(/keyboard-selected/);
        await expect(page.locator('#dashboard-layout')).toHaveClass(/config-layout/);

        await page.keyboard.press('Escape');
        await expect(page.locator('#dashboard-layout')).not.toHaveClass(/config-layout/);
    });

    test('j/k in the bookmarks list do not move the section rail', async ({ page }) => {
        await openBookmarksWithRows(page, [
            { name: 'Alpha', url: 'https://alpha.example', pageId: 1 },
        ]);

        await page.locator('#config-bm-list').click();
        await page.keyboard.press('j');
        await expect(page.locator('[data-config-section="bookmarks"]')).toHaveAttribute('aria-selected', 'true');
    });

    test('x and Space tick the row under the cursor, shift+x ticks a range', async ({ page }) => {
        await openBookmarksWithRows(page, [
            { name: 'A', url: 'https://a.example', pageId: 1 },
            { name: 'B', url: 'https://b.example', pageId: 1 },
            { name: 'C', url: 'https://c.example', pageId: 1 },
            { name: 'D', url: 'https://d.example', pageId: 1 },
        ]);
        // Not a click inside the list itself: with four rows sharing one page
        // and no category they draw as a single slab, and a click on
        // #config-bm-list can land on a row and pre-empt the cursor the test
        // means to walk onto with j. The toolbar count is real UI, just not
        // part of the row grid.
        await page.locator('#config-bm-count').click();
        await page.keyboard.press('j');
        await page.keyboard.press('x');
        const selected = () => page.evaluate(() => [...window.dashboardInstance.config.bmSelected].sort());
        await expect.poll(selected).toEqual(['1::https://a.example']);

        await page.keyboard.press('j');
        await page.keyboard.press('j');
        await page.keyboard.press('Shift+X');
        await expect.poll(selected).toEqual(['1::https://a.example', '1::https://b.example', '1::https://c.example']);

        await page.keyboard.press('j');
        await page.keyboard.press(' ');
        await expect.poll(async () => (await selected()).length).toBe(4);
        await page.keyboard.press(' ');
        await expect.poll(async () => (await selected()).length).toBe(3);
    });

    test('m and c no longer open row menus', async ({ page }) => {
        await openBookmarksWithRows(page, [{ name: 'A', url: 'https://a.example', pageId: 1 }]);
        await page.locator('#config-bm-list').click();
        await page.keyboard.press('j');
        await page.keyboard.press('m');
        await page.keyboard.press('c');
        await expect(page.locator('#config-bm-list .health-view-menu:not([hidden])')).toHaveCount(0);
    });
});
