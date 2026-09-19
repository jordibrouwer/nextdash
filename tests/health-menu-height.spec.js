// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, prepareDashboardInteraction } = require('./e2e-helpers');

/** The icon-prefetch overlay covers the view while a fresh install seeds icons. */
async function dismissFaviconOverlay(page) {
    await page.evaluate(() => {
        const overlay = document.getElementById('favicon-prefetch-overlay');
        if (overlay) overlay.hidden = true;
    });
}

/**
 * A context menu you have to scroll is a menu whose last item nobody finds.
 *
 * The health row menu capped itself at min(70vh, 24rem) — 384px on any window
 * — so a row whose repair options ran long put a scrollbar inside the menu.
 * Sprawl was the reason for the cap, and placement answers that better: the
 * menu flips above its trigger when there is no room below, and the cursor path
 * clamps it inside the viewport. The cap that remains is the window itself.
 */
async function openHealth(page) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 20_000 });
    await prepareDashboardInteraction(page);
    await dismissFaviconOverlay(page);
    await page.evaluate(async () => {
        const d = window.dashboardInstance;
        await d.health.openHealthView();
        await d.health.loadAndRender({ refresh: true });
    });
    await page.locator('[data-health-filter="all"]').click();
    await page.waitForSelector('#dashboard-layout.health-layout .health-view-item', { timeout: 20_000 });
}

test.describe('the health row menu shows all of itself', () => {
    test('it is capped by the window, not by a fixed height', async ({ page }) => {
        await openHealth(page);

        await page.evaluate(() => {
            const h = window.dashboardInstance.health;
            const row = document.querySelector('.health-view-item');
            h.closeAllMenus();
            h.toggleMenu(row.getAttribute('data-health-key'), 'more');
        });
        // Placement runs on the next frame — it is what flips the menu above
        // its trigger — so measuring in the same tick reads it mid-move.
        await page.waitForTimeout(300);

        const menu = await page.evaluate(() => {
            const el = document.querySelector('.health-view-menu[data-menu-owner="more"]:not([hidden])');
            if (!el) return null;
            const box = el.getBoundingClientRect();
            return {
                items: el.querySelectorAll('.health-view-menu-item').length,
                scrolls: el.scrollHeight > el.clientHeight + 1,
                maxHeight: parseFloat(getComputedStyle(el).maxHeight),
                viewport: window.innerHeight,
                onScreen: box.top >= -1 && box.bottom <= window.innerHeight + 1,
            };
        });

        expect(menu, 'no row menu to measure').not.toBeNull();
        expect(menu.items).toBeGreaterThan(4);
        // The whole menu, with no scrollbar inside it.
        expect(menu.scrolls).toBe(false);
        expect(menu.onScreen).toBe(true);
        // And the only limit left is the window: a 24rem cap would sit far
        // below this, and would have scrolled a menu this window has room for.
        expect(menu.maxHeight).toBeGreaterThan(menu.viewport - 40);
    });

    /**
     * A short window (this test's) leaves a menu with many repair options no
     * room above or below a row near the middle of the list. The fallback
     * used to pin the menu to the very top of the viewport regardless of
     * where the row was -- fine for a row already near the top, but for one
     * further down it put the menu nowhere near what was clicked, drawing
     * over the header and everything between it and the row. It now clamps
     * toward the row instead, landing as close as the viewport allows.
     */
    test('a row with no room above or below still opens its menu near itself', async ({ page }) => {
        await page.setViewportSize({ width: 1000, height: 750 });
        await openHealth(page);

        const rows = page.locator('.health-view-item');
        const count = await rows.count();
        const targetIndex = Math.min(Math.max(Math.floor(count / 2), 1), count - 1);

        const result = await page.evaluate((idx) => {
            const h = window.dashboardInstance.health;
            const row = document.querySelectorAll('.health-view-item')[idx];
            h.closeAllMenus();
            h.toggleMenu(row.getAttribute('data-health-key'), 'more');
            return row.getBoundingClientRect().top;
        }, targetIndex);
        await page.waitForTimeout(300);

        const menu = await page.evaluate((rowTop) => {
            const el = document.querySelector('.health-view-menu[data-menu-owner="more"]:not([hidden])');
            if (!el) return null;
            const box = el.getBoundingClientRect();
            return {
                onScreen: box.top >= -1 && box.bottom <= window.innerHeight + 1,
                distanceFromRow: Math.abs(box.top - rowTop),
                viewport: window.innerHeight,
            };
        }, result);

        expect(menu, 'no row menu to measure').not.toBeNull();
        expect(menu.onScreen).toBe(true);
        // Landed within the window rather than pinned to its very top
        // regardless of where the row was.
        expect(menu.distanceFromRow).toBeLessThan(menu.viewport - 40);
    });
});
