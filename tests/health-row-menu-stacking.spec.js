// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * A row's More menu drew behind the row below it, cut in half.
 *
 * theme-character.css gives `.feed-row` a backdrop-filter under a depth theme,
 * and feed-row.css already puts the action bar holding the menu at
 * opacity: 0 until the row is hovered. Both a non-`none` backdrop-filter and a
 * non-1 opacity create a stacking context, so `.feed-row` is one — which traps
 * the menu's `z-index: 20` (health-view.css) inside that single row. A later
 * row in the DOM always paints over it, no matter how high the menu's own
 * z-index goes, because that number never gets to compete outside its row.
 *
 * The fix has two halves: raise the row itself while its menu is open, so it
 * beats the later siblings' plain DOM-order stacking, and keep the action bar
 * painted (not faded back to opacity: 0 the instant the pointer leaves the
 * row on its way into the menu). Both live in feed-row.css, keyed on the
 * `.health-view-menu:not([hidden])` state Health and Config → Bookmarks
 * already share, so this covers both of those views without touching either
 * one's own CSS. Inbox is not covered here: its only row popover (Snooze) is
 * appended straight to <body>, never to the row, so it never inherited the
 * row's stacking context and there is nothing for this hook to fix there.
 *
 * Reproduces only under a theme that actually paints backdrop-filter — under
 * Flat there is none, `.feed-row` is not a stacking context, and this test
 * would pass whether or not the fix is present. aurora-glass-dark is a
 * built-in theme with a non-zero SurfaceBlur (models.go), applied here through
 * the app's own window.ThemeLoader.applyTheme/applyThemeDepth rather than by
 * hand-setting attributes the app itself never sets that way — the same path
 * a reader's own theme switch goes through.
 *
 * Asserted on containment (does the hit land inside the menu element), not on
 * a z-index value: a z-index assertion can pass while the pixel the reader
 * actually sees still belongs to the row underneath.
 */

async function openHealth(page) {
    await page.setViewportSize({ width: 1200, height: 800 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.evaluate(() => {
        const state = window.DiscoverabilityState;
        if (state?.markSettingPromoSeen) state.markSettingPromoSeen('health-filter-scroll-v1');
    });
    await page.evaluate(async () => {
        await window.dashboardInstance.health.openHealthView();
        window.dashboardInstance.health.filter = 'all';
        window.dashboardInstance.health.render();
        window.dashboardInstance.health.stopLiveRefresh?.();
    });
    await expect(page.locator('.health-view-item').first()).toBeVisible({ timeout: 15_000 });
}

/** Add several bookmarks and re-render, so the first row has rows below it. */
async function addBookmarks(page, bookmarks) {
    await page.evaluate(async (bms) => {
        const f = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        const h = {
            'Content-Type': 'application/json',
            ...(typeof nextDashWriteHeaders === 'function' ? nextDashWriteHeaders() : {}),
        };
        for (const bm of bms) {
            await f('/api/bookmarks/add', {
                method: 'POST', headers: h, body: JSON.stringify({ page: 1, bookmark: bm }),
            });
        }
        const health = window.dashboardInstance.health;
        await health.loadAndRender({ refresh: true });
        health.filter = 'all';
        health.render();
        health.stopLiveRefresh?.();
    }, bookmarks);
}

/**
 * Switches to a glass-depth theme with real blur, through the app's own
 * theme-application functions (static/js/theme-loader.js) rather than by
 * writing data-theme/data-depth onto the document by hand.
 */
async function useGlassDepthTheme(page) {
    await page.evaluate(() => {
        window.ThemeLoader.applyTheme('aurora-glass-dark');
        window.ThemeLoader.applyThemeDepth('glass');
    });
}

/** Opens a row's ⋯ "More" menu through the DOM, as health-row-menu.spec.js does. */
async function openMoreMenu(row) {
    await row.evaluate((el) => el.querySelector('.health-view-more-btn')?.click());
    const menu = row.locator('.health-view-menu[data-menu-owner="more"]');
    await expect(menu).toBeVisible({ timeout: 10_000 });
    // The action bar's reveal (grid-template-rows/opacity/margin-top) and the
    // menu's own flip-above-or-below placement both run after the click —
    // one on a CSS transition, the other in a requestAnimationFrame — so the
    // menu's box is still moving for a moment. Matches the wait
    // health-menu-height.spec.js uses for the same reason.
    await row.page().waitForTimeout(300);
    return menu;
}

test.describe('a row menu draws above the rows below it', () => {
    test('a point inside the overlap lands in the menu, not the next row', async ({ page }) => {
        await openHealth(page);
        await addBookmarks(page, [
            { name: 'Stacking row A', url: 'https://stacking-a.example/', openCount: 4, lastOpened: Date.now() },
            { name: 'Stacking row B', url: 'https://stacking-b.example/', openCount: 3, lastOpened: Date.now() },
            { name: 'Stacking row C', url: 'https://stacking-c.example/', openCount: 2, lastOpened: Date.now() },
        ]);
        await useGlassDepthTheme(page);

        const rows = page.locator('.health-view-item');
        await expect(rows.nth(1)).toBeVisible();

        const menu = await openMoreMenu(rows.first());
        await expect(menu).toBeVisible();

        const boxes = await page.evaluate(() => {
            const menuEl = document.querySelector(
                '.health-view-item .health-view-menu[data-menu-owner="more"]:not([hidden])'
            );
            const nextRow = document.querySelectorAll('.health-view-item')[1];
            const m = menuEl.getBoundingClientRect();
            const n = nextRow.getBoundingClientRect();
            return {
                menu: { left: m.left, right: m.right, top: m.top, bottom: m.bottom },
                next: { left: n.left, right: n.right, top: n.top, bottom: n.bottom },
            };
        });

        const overlapTop = Math.max(boxes.menu.top, boxes.next.top);
        const overlapBottom = Math.min(boxes.menu.bottom, boxes.next.bottom);
        const overlapLeft = Math.max(boxes.menu.left, boxes.next.left);
        const overlapRight = Math.min(boxes.menu.right, boxes.next.right);

        // Setup check, not the bug under test: if the menu never reaches the
        // row below it, the containment assertion below would pass on a test
        // that could never have caught the bug.
        expect(overlapBottom - overlapTop, 'setup: the open menu must overlap the row below it')
            .toBeGreaterThan(4);
        expect(overlapRight - overlapLeft, 'setup: the open menu must overlap the row below it')
            .toBeGreaterThan(4);

        const point = { x: (overlapLeft + overlapRight) / 2, y: (overlapTop + overlapBottom) / 2 };

        const hitLandedInMenu = await page.evaluate((p) => {
            const menuEl = document.querySelector(
                '.health-view-item .health-view-menu[data-menu-owner="more"]:not([hidden])'
            );
            const hit = document.elementFromPoint(p.x, p.y);
            return Boolean(menuEl && hit && menuEl.contains(hit));
        }, point);

        expect(hitLandedInMenu, 'the point inside the open menu hit the row below it instead of the menu')
            .toBe(true);
    });
});
