// @ts-check
const { test, expect } = require('@playwright/test');
const { prepareDashboardInteraction } = require('./e2e-helpers');

/**
 * Changing a bookmark's availability checking from the dashboard right-click
 * menu — the same three-state choice the health view offers, in the menu where
 * the other per-bookmark actions already live.
 *
 * Real endpoints here rather than mocks: the defect this covers was that the
 * write reached the server but the dashboard's cached copy did not, so anything
 * that stubbed the response would have passed while the bug was live.
 */

async function firstRow(page) {
    await page.waitForSelector('.bookmark-link', { timeout: 15_000 });
    return page.locator('.bookmark-link').first();
}

async function openContextMenu(page, row) {
    await row.click({ button: 'right' });
    await page.waitForSelector('#bookmark-context-menu', { timeout: 10_000 });
}

async function openCheckModeSubmenu(page, row) {
    await openContextMenu(page, row);
    await page.locator('[data-action="check-mode"]').click();
    await page.waitForSelector('#bookmark-check-mode-menu', { timeout: 10_000 });
}

/** The mode the submenu currently shows as active. */
function activeMode(page) {
    return page.evaluate(() => document
        .querySelector('#bookmark-check-mode-menu [aria-checked="true"]')
        ?.getAttribute('data-check-mode') || null);
}

async function setup(page) {
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await prepareDashboardInteraction(page);
    await page.evaluate(() => document.querySelectorAll('.quickstart-card').forEach((el) => el.remove()));
    // Start from a known mode. Earlier tests in this file leave the first
    // bookmark monitored, which would turn "choose monitor" into a no-op — the
    // menu closes without a change and never raises the notification the
    // assertions wait for.
    //
    // nextDashFetch, not fetch: the E2E server runs with NEXTDASH_WRITE_TOKEN
    // set, and check-mode-all is a protected endpoint. A bare fetch sends no
    // token and is answered with 401. The status is checked rather than
    // discarded, because that 401 is exactly what made this reset a silent
    // no-op and the suite order-dependent.
    const reset = await page.evaluate(async () => {
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        const res = await api('/api/health/check-mode-all', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ mode: 'off' }),
        });
        return { ok: res.ok, status: res.status };
    });
    if (!reset.ok) {
        throw new Error(`check-mode reset failed with HTTP ${reset.status}`);
    }
    await page.reload();
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    // Again after the reload, not just before it: a release the browser has not
    // seen opens the What's new modal on load, and that marks the grid inert —
    // every row then reads as "not stable" and never takes a click.
    await prepareDashboardInteraction(page);
    await page.evaluate(() => document.querySelectorAll('.quickstart-card').forEach((el) => el.remove()));
}

test.describe('dashboard check-mode menu', () => {
    test('the context menu names the current mode and opens a submenu', async ({ page }) => {
        await setup(page);
        const row = await firstRow(page);
        await openContextMenu(page, row);

        // Naming the mode saves opening the submenu just to read it.
        const entry = page.locator('[data-action="check-mode"]');
        await expect(entry).toBeVisible();
        await expect(entry).toHaveAttribute('aria-haspopup', 'menu');

        await entry.click();
        await expect(page.locator('#bookmark-check-mode-menu')).toBeVisible();
        // Three named options rather than a control that cycles, each with the
        // sentence that distinguishes it.
        await expect(page.locator('#bookmark-check-mode-menu .move-popover-item')).toHaveCount(3);
        for (const mode of ['off', 'periodic', 'monitor']) {
            await expect(page.locator(`[data-check-mode="${mode}"]`)).toHaveCount(1);
        }
        await expect(page.locator('.check-mode-option-body').first()).not.toBeEmpty();
    });

    /**
     * The regression: the write succeeded server-side, but loadBookmarks() reads
     * through the page data cache, so reopening the menu showed the mode from
     * before the change.
     */
    test('a chosen mode is still shown when the menu is reopened', async ({ page }) => {
        await setup(page);

        // Re-resolved after every change: applying a mode ends in a full
        // renderDashboard(), which replaces the row element. Holding one handle
        // across that would be waiting on a node no longer in the document.
        await openCheckModeSubmenu(page, await firstRow(page));
        await page.locator('[data-check-mode="monitor"]').click();
        await expect(page.locator('.app-notification')).toContainText(/monitor/i, { timeout: 10_000 });

        // No reload in between — that is the whole point.
        await openCheckModeSubmenu(page, await firstRow(page));
        expect(await activeMode(page)).toBe('monitor');

        await page.keyboard.press('Escape');
        await openCheckModeSubmenu(page, await firstRow(page));
        await page.locator('[data-check-mode="periodic"]').click();
        await expect(page.locator('.app-notification')).toContainText(/periodic/i, { timeout: 10_000 });

        await openCheckModeSubmenu(page, await firstRow(page));
        expect(await activeMode(page)).toBe('periodic');
    });

    test('the change reaches the server', async ({ page }) => {
        await setup(page);
        const row = await firstRow(page);
        const url = await row.getAttribute('data-bookmark-url');

        await openCheckModeSubmenu(page, row);
        await page.locator('[data-check-mode="monitor"]').click();
        await expect(page.locator('.app-notification')).toContainText(/monitor/i, { timeout: 10_000 });

        const stored = await page.evaluate(async (target) => {
            const res = await fetch(`/api/bookmarks?page=${window.dashboardInstance.currentPageId}`);
            const list = await res.json();
            return list.find((b) => b.url === target) || null;
        }, url);
        expect(stored?.monitor).toBe(true);
        // A monitor must state its own cadence rather than inheriting one.
        expect(Number(stored?.monitorIntervalMinutes)).toBeGreaterThan(0);
    });

    test('Shift+C opens the same menu from the keyboard', async ({ page }) => {
        await setup(page);
        await page.waitForSelector('.bookmark-link', { timeout: 15_000 });
        await page.click('body');
        await page.keyboard.press('ArrowDown');
        await page.keyboard.press('Shift+C');

        await expect(page.locator('#bookmark-check-mode-menu')).toBeVisible();
        await expect(page.locator('#bookmark-check-mode-menu .move-popover-item')).toHaveCount(3);
    });

    test('letter accelerators pick a mode, and do not leak to the shortcut search', async ({ page }) => {
        await setup(page);
        const row = await firstRow(page);

        await openCheckModeSubmenu(page, row);
        // Each option prints its own letter, so the accelerator is discoverable
        // from the menu rather than only from the cheat sheet.
        await expect(page.locator('[data-check-mode="monitor"] .check-mode-option-key')).toHaveText('m');

        await page.keyboard.press('m');
        await expect(page.locator('.app-notification')).toContainText(/monitor/i, { timeout: 10_000 });
        await expect(page.locator('#bookmark-check-mode-menu')).toHaveCount(0);

        // A bare letter would otherwise open the shortcut search behind the menu.
        expect(await page.evaluate(() => Boolean(window.dashboardInstance?.searchComponent?.isActive?.()))).toBe(false);

        await openCheckModeSubmenu(page, row);
        expect(await activeMode(page)).toBe('monitor');
        await page.keyboard.press('o');
        await expect(page.locator('.app-notification')).toContainText(/off|uit/i, { timeout: 10_000 });
    });

    test('the menu anchors to its row for both mouse and keyboard', async ({ page }) => {
        await setup(page);
        const row = await firstRow(page);

        // Right-click near the row's far edge: the submenu still opens beside the
        // row, not where the pointer happened to be.
        const box = await row.boundingBox();
        await page.mouse.click(box.x + box.width - 12, box.y + box.height - 4, { button: 'right' });
        await page.waitForSelector('#bookmark-context-menu', { timeout: 10_000 });
        await page.locator('[data-action="check-mode"]').click();
        await page.waitForSelector('#bookmark-check-mode-menu', { timeout: 10_000 });

        // Measured against the row that was actually clicked, since the grid can
        // reorder between renders.
        const url = await row.getAttribute('data-bookmark-url');
        const aligned = await page.evaluate((target) => {
            const menu = document.querySelector('#bookmark-check-mode-menu').getBoundingClientRect();
            const el = document.querySelector(`.bookmark-link[data-bookmark-url="${CSS.escape(target)}"]`);
            if (!el) return null;
            const rect = el.getBoundingClientRect();
            return { dLeft: Math.abs(menu.left - rect.left), below: menu.top >= rect.bottom - 2 };
        }, url);
        expect(aligned).not.toBeNull();
        // A few pixels of slack: the assertion is "beside this row, not under the
        // pointer", and the pointer was ~200px away at the row's far edge.
        expect(aligned.dLeft).toBeLessThan(8);
        expect(aligned.below).toBe(true);
    });

    /**
     * The health view and the dashboard keep separate caches of the same
     * bookmark. Refreshing the health report alone left the dashboard holding
     * the pre-change mode, so going back and acting on the bookmark used the
     * old setting until a hard reload.
     */
    test('a mode set in the health view is live on the dashboard', async ({ page }) => {
        await setup(page);
        const url = await (await firstRow(page)).getAttribute('data-bookmark-url');

        await page.click('.health-link a.health-link-anchor');
        await page.waitForSelector('#dashboard-layout.health-layout', { timeout: 15_000 });
        await page.click('[data-health-filter="all"]').catch(() => {});
        await page.waitForSelector('.health-view-item', { timeout: 15_000 });

        const applied = await page.evaluate(async (target) => {
            const hv = window.dashboardInstance.health || window.dashboardInstance.healthView;
            const issue = (hv?.report?.issues || []).find((i) => i.url === target);
            if (!issue) return false;
            await hv.setCheckMode(issue, 'monitor');
            return true;
        }, url);
        expect(applied).toBe(true);

        // Read the dashboard's own arrays, not the health report: those are what
        // every later action on the bookmark reads from.
        await expect.poll(async () => page.evaluate((target) => {
            const d = window.dashboardInstance;
            const current = (d.bookmarks || []).find((b) => b.url === target);
            const all = (d.allBookmarks || []).find((b) => b.url === target);
            return Boolean(current?.monitor) && (!all || Boolean(all.monitor));
        }, url), { timeout: 10_000 }).toBe(true);
    });

    test('the submenu opens on the active option and Escape changes nothing', async ({ page }) => {
        await setup(page);
        const row = await firstRow(page);

        await openCheckModeSubmenu(page, row);
        const before = await activeMode(page);
        // Focus starts on the current mode, so a stray Enter is a no-op rather
        // than a change nobody asked for.
        //
        // Polled rather than read once: the menu sets focus inside a
        // requestAnimationFrame, so the element exists a frame before it is
        // focused. Reading immediately passed on an idle machine and failed
        // under load.
        await expect.poll(() => page.evaluate(() => document
            .querySelector('#bookmark-check-mode-menu .move-popover-item.is-focused')
            ?.getAttribute('data-check-mode') || null)).toBe(before);

        await page.keyboard.press('Escape');
        await expect(page.locator('#bookmark-check-mode-menu')).toHaveCount(0);

        await openCheckModeSubmenu(page, row);
        expect(await activeMode(page)).toBe(before);
    });
});
