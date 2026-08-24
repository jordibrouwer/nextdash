// @ts-check
const { test, expect } = require('./fixtures');
const { prepareDashboardInteraction } = require('./e2e-helpers');

/**
 * Changing a bookmark's check mode from inside the health view.
 *
 * The report is mocked so each row's mode is fixed rather than depending on what
 * the seeded bookmarks happen to be. The write itself is intercepted too: this
 * spec is about the view keeping its place while the mode changes, and the
 * endpoint's own behaviour is covered by the Go tests.
 */

function issue(overrides = {}) {
    return {
        pageId: 1, index: 0, pageName: 'dev', category: 'tools',
        status: 'ok', score: 90, duplicateCount: 0,
        lastChecked: 1752000000000, reasons: [], reasonDetails: [],
        ...overrides,
    };
}

function report() {
    return {
        generatedAt: Date.now(),
        summary: { totalBookmarks: 3, healthyCount: 3, brokenCount: 0, duplicateCount: 0, uncheckedCount: 0 },
        issues: [
            issue({ index: 0, name: 'Monitored one', url: 'https://example.com/mon', monitor: true }),
            issue({ index: 1, name: 'Periodic one', url: 'https://example.com/per', checkStatus: true }),
            // No lastChecked, so this is the row the "Never checked" filter finds.
            issue({ index: 2, name: 'Unchecked one', url: 'https://example.com/off', lastChecked: 0 }),
        ],
        duplicateGroups: [],
    };
}

async function openHealthView(page) {
    await page.route('**/api/bookmark-health**', async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(report()),
        });
    });
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await prepareDashboardInteraction(page);
    await page.click('.health-link a.health-link-anchor');
    await page.waitForSelector('#dashboard-layout.health-layout', { timeout: 15_000 });
    // Wait for the mocked report to land before touching a filter: the pills are
    // counted from it, so clicking earlier picks a filter that still reads 0.
    await page.waitForFunction(() => {
        const h = window.dashboardInstance?.healthView || window.dashboardInstance?.health;
        return h?.report?.issues?.length === 3;
    }, null, { timeout: 15_000 });
    // The view opens on the "broken" filter; these rows are deliberately healthy,
    // because this spec is about check mode rather than scoring.
    await page.click('[data-health-filter="all"]');
    await page.waitForSelector('.health-view-item', { timeout: 15_000 });
}

/** Capture check-mode writes without letting them touch the store. */
async function captureCheckMode(page, status = 200) {
    /** @type {any[]} */
    const calls = [];
    await page.route('**/api/health/check-mode', async (route) => {
        calls.push(JSON.parse(route.request().postData() || '{}'));
        await route.fulfill({
            status,
            contentType: 'application/json',
            body: JSON.stringify(status === 200 ? { mode: 'monitor' } : { error: 'stale' }),
        });
    });
    return calls;
}

test.describe('health view check mode', () => {
    test('each row shows its current mode as a button', async ({ page }) => {
        await openHealthView(page);

        const badges = page.locator('.health-check-mode');
        await expect(badges).toHaveCount(3);
        await expect(badges.nth(0)).toHaveClass(/is-monitor/);
        await expect(badges.nth(1)).toHaveClass(/is-periodic/);
        await expect(badges.nth(2)).toHaveClass(/is-off/);

        // The badge is the control, so it must be reachable and announced as one.
        await expect(badges.nth(0)).toHaveAttribute('aria-haspopup', 'menu');
        await expect(badges.nth(0)).toHaveAttribute('aria-expanded', 'false');
    });

    test('clicking the badge opens a popover with the active mode marked', async ({ page }) => {
        await openHealthView(page);

        await page.locator('.health-view-item').first().locator('.health-check-mode').click();
        const menu = page.locator('.health-view-item').first().locator('.health-check-menu');
        await expect(menu).toBeVisible();

        // Three named options rather than a control that cycles.
        await expect(menu.locator('.health-check-option')).toHaveCount(3);
        await expect(menu.locator('[data-check-mode="monitor"]')).toHaveAttribute('aria-checked', 'true');
        await expect(menu.locator('[data-check-mode="off"]')).toHaveAttribute('aria-checked', 'false');
        await expect(page.locator('.health-check-mode').first()).toHaveAttribute('aria-expanded', 'true');
    });

    test('choosing a mode posts the row reference and its URL', async ({ page }) => {
        await openHealthView(page);
        const calls = await captureCheckMode(page);

        const row = page.locator('.health-view-item').nth(2);
        await row.locator('.health-check-mode').click();
        await row.locator('[data-check-mode="monitor"]').click();

        await expect.poll(() => calls.length).toBe(1);
        // The URL rides along with the index so the server can reject a stale row.
        expect(calls[0]).toMatchObject({
            pageId: 1,
            index: 2,
            url: 'https://example.com/off',
            mode: 'monitor',
        });
    });

    test('the view stays open and keeps its filter while the mode changes', async ({ page }) => {
        await openHealthView(page);
        await captureCheckMode(page);

        // Search narrows the list to one row; both it and the filter must survive.
        await page.fill('.health-view-search-input', 'Unchecked');
        await expect(page.locator('.health-view-item')).toHaveCount(1);

        const row = page.locator('.health-view-item').first();
        await row.locator('.health-check-mode').click();
        await row.locator('[data-check-mode="periodic"]').click();

        // The old route was a deep link out of the view; the whole point is that
        // the user keeps their place.
        await expect(page.locator('#dashboard-layout')).toHaveClass(/health-layout/);
        expect(await page.evaluate(() => window.location.hash)).toBe('#health');
        await expect(page.locator('.health-view-filter-btn.is-active')).toContainText('All');
        await expect(page.locator('.health-view-search-input')).toHaveValue('Unchecked');
    });

    test('selecting the mode a row already has closes without writing', async ({ page }) => {
        await openHealthView(page);
        const calls = await captureCheckMode(page);

        const row = page.locator('.health-view-item').first();
        await row.locator('.health-check-mode').click();
        await row.locator('[data-check-mode="monitor"]').click();

        await expect(row.locator('.health-check-menu')).toBeHidden();
        expect(calls).toHaveLength(0);
    });

    test('c opens the popover for the keyboard-selected row', async ({ page }) => {
        await openHealthView(page);

        await page.keyboard.press('ArrowDown');
        await expect(page.locator('.health-view-item.keyboard-selected')).toHaveCount(1);
        await page.keyboard.press('c');

        await expect(page.locator('.health-view-item').first().locator('.health-check-menu')).toBeVisible();
    });

    test('Escape closes the popover without leaving the view', async ({ page }) => {
        await openHealthView(page);

        const row = page.locator('.health-view-item').first();
        await row.locator('.health-check-mode').click();
        await expect(row.locator('.health-check-menu')).toBeVisible();
        await page.keyboard.press('Escape');

        await expect(row.locator('.health-check-menu')).toBeHidden();
        // Escape must dismiss the menu only — closing the whole view here would
        // lose the user's place in the list.
        await expect(page.locator('#dashboard-layout')).toHaveClass(/health-layout/);
        await expect(row.locator('.health-check-mode')).toBeFocused();
    });

    test('the overflow menu names the current mode and opens the popover', async ({ page }) => {
        await openHealthView(page);

        // Row actions only surface on the selected row, so drive it by keyboard
        // the way the rest of the health specs do.
        await page.keyboard.press('j');
        await page.keyboard.press('m');

        const row = page.locator('.health-view-item').first();
        const item = row.locator('[data-menu-action="checkmode"]');
        // Naming the current mode saves opening the popover just to read it.
        await expect(item).toContainText('Monitor');

        await item.click();
        // It hands off rather than duplicating the options, so one place explains
        // what the modes mean.
        await expect(row.locator('.health-check-menu')).toBeVisible();
        await expect(row.locator('.health-view-menu[data-menu-owner="more"]')).toBeHidden();
    });

    test('the legend teaches c alongside the other row shortcuts', async ({ page }) => {
        await openHealthView(page);
        await expect(page.locator('.health-view-legend')).toContainText('c');
    });

    test('the bulk monitor button is offered on a narrowed list, never on All', async ({ page }) => {
        await openHealthView(page);

        // openHealthView leaves the view on "All", where bulk enabling would mean
        // the whole collection — the one thing it must not be able to do.
        await expect(page.locator('.health-view-bulk-monitor-btn')).toHaveCount(0);

        await page.click('[data-health-filter="unchecked"]');
        const btn = page.locator('.health-view-bulk-monitor-btn');
        await expect(btn).toHaveCount(1);
        // The count names the blast radius, and it is the visible list.
        await expect(btn).toContainText('1');
    });

    // These buttons act on the filtered list while the bulk bar right below them
    // acts on the ticked rows, and with a selection open both are on screen at
    // once. "Monitor these 3" sat a few pixels above "2 selected" with nothing
    // saying which set was which, so the label names its own scope now.
    test('the bulk enable label says it acts on the shown rows, not the ticked ones', async ({ page }) => {
        await openHealthView(page);

        await page.click('[data-health-filter="unchecked"]');
        const btn = page.locator('.health-view-bulk-monitor-btn');
        await expect(btn).toHaveCount(1);

        // "shown" is the word that separates it from the selection bar.
        await expect(btn).toContainText(/shown/i);
        await expect(btn, 'the ambiguous wording is back').not.toContainText(/these \d/i);

        // The tooltip says the same thing the long way round.
        expect(await btn.getAttribute('title')).toMatch(/not the ticked rows/i);
    });

    test('bulk monitor confirms, then posts only the visible rows', async ({ page }) => {
        await openHealthView(page);
        /** @type {any[]} */
        const calls = [];
        await page.route('**/api/health/check-mode-all', async (route) => {
            calls.push(JSON.parse(route.request().postData() || '{}'));
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ mode: 'monitor', changed: 1, skipped: 0 }),
            });
        });

        await page.click('[data-health-filter="unchecked"]');
        await page.click('.health-view-bulk-monitor-btn');

        // Confirmation is mandatory: the count is the only view of the impact.
        // #app-modal specifically: other dialogs (the tag cloud) sit in the DOM
        // from load, so a generic [role=dialog] would match the wrong one.
        const dialog = page.locator('#app-modal');
        await expect(dialog).toBeVisible();
        expect(calls).toHaveLength(0);

        await dialog.getByRole('button', { name: /confirm/i }).click();

        await expect.poll(() => calls.length).toBe(1);
        expect(calls[0].mode).toBe('monitor');
        // Named targets, so the server cannot be asked to enable everything.
        expect(Array.isArray(calls[0].targets)).toBe(true);
        expect(calls[0].targets).toHaveLength(1);
        expect(calls[0].targets[0]).toMatchObject({ pageId: 1, index: 2, url: 'https://example.com/off' });
    });

    test('cancelling the bulk confirmation writes nothing', async ({ page }) => {
        await openHealthView(page);
        /** @type {any[]} */
        const calls = [];
        await page.route('**/api/health/check-mode-all', async (route) => {
            calls.push(JSON.parse(route.request().postData() || '{}'));
            await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
        });

        await page.click('[data-health-filter="unchecked"]');
        await page.click('.health-view-bulk-monitor-btn');
        const dialog = page.locator('#app-modal');
        await expect(dialog).toBeVisible();
        await dialog.getByRole('button', { name: /cancel/i }).click();

        await expect(dialog).toBeHidden();
        expect(calls).toHaveLength(0);
    });

    test('a stale row is reported rather than silently retried', async ({ page }) => {
        await openHealthView(page);
        await captureCheckMode(page, 409);

        const row = page.locator('.health-view-item').nth(2);
        await row.locator('.health-check-mode').click();
        await row.locator('[data-check-mode="monitor"]').click();

        await expect(page.locator('.app-notification')).toContainText(/refreshed/i, { timeout: 5000 });
    });

    /**
     * CheckMode.intervalOf() reads a flat `monitorIntervalMinutes` field. A raw
     * Bookmark has it; a health-report issue used not to — HealthIssue only
     * carried the interval nested under monitorStats, which itself does not
     * exist until the bookmark has at least one sample (buildMonitorStats
     * returns nil for an empty history). So a first fix that only taught
     * intervalOf to fall back to monitorStats.intervalMinutes still defaulted
     * to 15m for exactly the row someone would test this on: one just switched
     * to Monitor, or whose interval was just changed, with no check having run
     * yet. HealthIssue now carries monitorIntervalMinutes directly, set from
     * the bookmark regardless of sample history, which is what these two cases
     * cover.
     */
    test('the interval accent is correct with an established history', async ({ page }) => {
        await mockHealthWithInterval(page, {
            monitor: true, monitorIntervalMinutes: 30,
            monitorStats: { intervalMinutes: 30, uptime24h: {}, uptime7d: {}, uptime30d: {}, totalChecks: 10 },
        });
        await openInterval(page);
        await expect(page.locator('.health-check-interval-btn.is-active')).toHaveText('30m');
    });

    test('the interval accent is correct with no samples yet', async ({ page }) => {
        // The exact shape buildMonitorStats produces for an empty history: the
        // field is absent from the JSON entirely (nil in Go, omitempty).
        await mockHealthWithInterval(page, { monitor: true, monitorIntervalMinutes: 60 });
        await openInterval(page);
        await expect(page.locator('.health-check-interval-btn.is-active')).toHaveText('1h');
    });

    async function mockHealthWithInterval(page, issueOverrides) {
        await page.route('**/api/bookmark-health**', (route) => route.fulfill({
            status: 200, contentType: 'application/json',
            body: JSON.stringify({
                generatedAt: Date.now(),
                summary: { totalBookmarks: 1, healthyCount: 1, brokenCount: 0, duplicateCount: 0, uncheckedCount: 0 },
                issues: [issue({
                    index: 0, name: 'Interval accent', url: 'https://example.com/interval-accent',
                    ...issueOverrides,
                })],
                duplicateGroups: [],
            }),
        }));
    }

    async function openInterval(page) {
        await page.goto('/');
        await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
        await prepareDashboardInteraction(page);
        await page.click('.health-link a.health-link-anchor');
        await page.waitForSelector('#dashboard-layout.health-layout', { timeout: 15_000 });
        await page.waitForFunction(() => {
            const h = window.dashboardInstance?.healthView || window.dashboardInstance?.health;
            return h?.report?.issues?.length === 1;
        }, null, { timeout: 15_000 });
        await page.click('[data-health-filter="all"]');
        await page.waitForSelector('.health-view-item', { timeout: 15_000 });
        await page.click('.health-check-mode');
    }
});
