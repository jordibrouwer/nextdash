// @ts-check
const { test, expect } = require('./fixtures');
const { openBookmarks } = require('./config-bookmarks-helpers');

/*
 * The bookmark list as a workbench: filters down the left, rows in the
 * middle, the bookmark (or the selection) on the right.
 */

test.describe('the bookmarks workbench', () => {
    test('is laid out as rail, list and panel', async ({ page }) => {
        await openBookmarks(page);
        const rail = page.locator('#config-bm-rail');
        const main = page.locator('#config-bm-workbench .config-bm-main');
        const panel = page.locator('#config-bm-panel');
        await expect(rail).toBeVisible();
        await expect(panel).toBeVisible();
        await expect(rail.locator('#config-bm-search')).toBeVisible();

        const [r, m, p] = await Promise.all([rail, main, panel].map((l) => l.boundingBox()));
        expect(r && m && p, 'all three parts have a box').toBeTruthy();
        expect(r.x + r.width).toBeLessThanOrEqual(m.x + 1);
        expect(m.x + m.width).toBeLessThanOrEqual(p.x + 1);
    });
});
