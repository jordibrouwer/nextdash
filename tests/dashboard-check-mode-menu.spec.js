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
    // Start from a known mode. Earlier specs share this server and leave
    // bookmarks monitored, which would turn "choose monitor" into a no-op and
    // make these tests pass or fail on run order.
    await page.evaluate(() => fetch('/api/health/check-mode-all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'off' }),
    }));
    await page.reload();
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
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
        const row = await firstRow(page);

        await openCheckModeSubmenu(page, row);
        await page.locator('[data-check-mode="monitor"]').click();
        await expect(page.locator('.app-notification')).toContainText(/monitor/i, { timeout: 10_000 });

        // No reload in between — that is the whole point.
        await openCheckModeSubmenu(page, row);
        expect(await activeMode(page)).toBe('monitor');

        await page.keyboard.press('Escape');
        await openCheckModeSubmenu(page, row);
        await page.locator('[data-check-mode="periodic"]').click();
        await expect(page.locator('.app-notification')).toContainText(/periodic/i, { timeout: 10_000 });

        await openCheckModeSubmenu(page, row);
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

    test('the submenu opens on the active option and Escape changes nothing', async ({ page }) => {
        await setup(page);
        const row = await firstRow(page);

        await openCheckModeSubmenu(page, row);
        const before = await activeMode(page);
        // Focus starts on the current mode, so a stray Enter is a no-op rather
        // than a change nobody asked for.
        const focused = await page.evaluate(() => document
            .querySelector('#bookmark-check-mode-menu .move-popover-item.is-focused')
            ?.getAttribute('data-check-mode') || null);
        expect(focused).toBe(before);

        await page.keyboard.press('Escape');
        await expect(page.locator('#bookmark-check-mode-menu')).toHaveCount(0);

        await openCheckModeSubmenu(page, row);
        expect(await activeMode(page)).toBe(before);
    });
});
