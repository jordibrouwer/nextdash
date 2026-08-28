// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * The row menu shows what this row can do, not everything a row could.
 *
 * Fifteen actions under four headings is taller than the window on a laptop, so
 * the last entries — the ones that remove things — sat behind a scrollbar in a
 * context menu. An action that would do nothing on this row is what it costs
 * least to leave out.
 *
 * Asserted on which actions are rendered rather than on the menu's height:
 * these specs run with dashboard.css only — the view's own stylesheet arrives
 * in a bundle this harness does not fetch — so a height measured here is not
 * the height anyone sees.
 */

async function openHealth(page, { height = 800 } = {}) {
    await page.setViewportSize({ width: 1200, height });
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

/** Add a bookmark and hand back the health row that belongs to it. */
async function addBookmark(page, bookmark) {
    await page.evaluate(async ([bm]) => {
        const f = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        const h = {
            'Content-Type': 'application/json',
            ...(typeof nextDashWriteHeaders === 'function' ? nextDashWriteHeaders() : {}),
        };
        await f('/api/bookmarks/add', { method: 'POST', headers: h, body: JSON.stringify({ page: 1, bookmark: bm }) });
        const health = window.dashboardInstance.health;
        await health.loadAndRender({ refresh: true });
        health.filter = 'all';
        health.render();
        // The view re-renders itself on a timer; a list rebuilding under the
        // pointer is a row Playwright will not call stable, and this test is
        // about the menu rather than about the refresh.
        health.stopLiveRefresh?.();
    }, [bookmark]);
    return page.locator('.health-view-item', { hasText: bookmark.name });
}

/**
 * Open the ⋯ menu on a row.
 *
 * Clicked through the DOM rather than with the pointer: the health list repaints
 * on its own and Playwright refuses a target it has seen move, which says
 * nothing about the menu this file is testing.
 */
async function openMenu(row) {
    await row.evaluate((el) => el.querySelector('.health-view-more-btn')?.click());
    // A row carries two menus — the check-mode popover and this one — so it is
    // named by its owner rather than by being the only one.
    const menu = row.locator('.health-view-menu[data-menu-owner="more"]');
    await expect(menu).toBeVisible({ timeout: 10_000 });
    return menu;
}

/** The actions a row's menu offers. */
async function menuActionsFor(row) {
    const menu = await openMenu(row);
    return menu.evaluate((el) => [...el.querySelectorAll('[data-menu-action]')]
        .map((item) => item.getAttribute('data-menu-action')));
}

test.describe('the health row menu', () => {
    test('leaves out what would do nothing on a healthy row', async ({ page }) => {
        await openHealth(page);
        const row = await addBookmark(page, {
            name: 'Healthy row', url: 'https://healthy-menu.example/', openCount: 4, lastOpened: Date.now(),
        });

        const actions = await menuActionsFor(row);

        // Restoring an archived copy over a working link is not an action, and
        // a list of copies that do not exist opens empty.
        expect(actions).not.toContain('archive-recover');
        expect(actions).not.toContain('local-copies');
        // What is always worth offering stays.
        expect(actions).toContain('dashboard');
        expect(actions).toContain('delete');
        expect(actions).toContain('checkmode');
    });

    test('offers the repair actions on a broken row', async ({ page }) => {
        await openHealth(page);
        const row = await addBookmark(page, {
            name: 'Broken row', url: 'https://broken-menu.example/',
            checkStatus: true, lastChecked: Date.now(), lastError: 'HTTP 500',
        });

        const actions = await menuActionsFor(row);

        expect(actions).toContain('redirect');
        expect(actions).toContain('title');
        expect(actions).toContain('archive-recover');
    });

    test('a heading never stands above an empty group', async ({ page }) => {
        await openHealth(page);
        const row = await addBookmark(page, {
            name: 'No repairs', url: 'https://no-repairs.example/', openCount: 2, lastOpened: Date.now(),
        });

        const menu = await openMenu(row);

        const trailingHeading = await menu.evaluate((el) => {
            const children = [...el.children];
            return children.some((child, i) => child.classList.contains('health-view-menu-label')
                && (i === children.length - 1
                    || children[i + 1].classList.contains('health-view-menu-label')));
        });
        expect(trailingHeading).toBe(false);
    });

});
