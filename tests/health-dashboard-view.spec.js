// @ts-check
const { test, expect } = require('@playwright/test');
const { prepareDashboardInteraction } = require('./e2e-helpers');

/**
 * Health as a dashboard view (the inbox-shaped one).
 *
 * The report is mocked so the assertions describe the view rather than whatever the
 * seeded bookmarks happen to score.
 */

function report() {
    return {
        generatedAt: Date.now(),
        summary: {
            totalBookmarks: 4,
            healthyCount: 1,
            brokenCount: 1,
            duplicateCount: 2,
            uncheckedCount: 1,
        },
        issues: [
            {
                pageId: 1, index: 0, pageName: 'dev', name: 'Broken one',
                url: 'https://example.com/broken', category: 'tools',
                status: 'broken', score: 25, duplicateCount: 0,
                lastChecked: 1752000000000,
                reasons: ['HTTP 500', 'Never opened', 'No preview metadata yet'],
                reasonDetails: [
                    { code: 'last_error', detail: 'HTTP 500', penalty: 60 },
                    { code: 'never_opened', penalty: 10 },
                    { code: 'no_preview', penalty: 5 },
                ],
            },
            {
                pageId: 1, index: 2, pageName: 'dev', name: 'Dup A',
                url: 'https://dup.test/x', category: 'tools',
                status: 'duplicate', score: 85, duplicateCount: 2,
                lastChecked: 1752000000000,
                reasons: ['Duplicate URL in 2 bookmarks'],
                reasonDetails: [{ code: 'duplicate_url', params: { count: '2' }, penalty: 15 }],
            },
            {
                pageId: 1, index: 3, pageName: 'dev', name: 'Never checked one',
                url: 'https://example.com/fresh', category: 'tools',
                status: 'unchecked', score: 90, duplicateCount: 0,
                reasons: ['Status check has never run'],
                reasonDetails: [{ code: 'status_never_run', penalty: 10 }],
            },
            {
                pageId: 1, index: 4, pageName: 'dev', name: 'Monitored one',
                url: 'https://example.com/monitored', category: 'tools',
                status: 'healthy', score: 100, duplicateCount: 0,
                lastChecked: 1752000000000,
                reasons: [], reasonDetails: [],
                monitor: true, checkStatus: true,
                monitorStats: monitorStats(),
            },
            {
                pageId: 1, index: 5, pageName: 'dev', name: 'Monitored pending',
                url: 'https://example.com/pending', category: 'tools',
                status: 'healthy', score: 100, duplicateCount: 0,
                reasons: [], reasonDetails: [],
                // Monitored, but the scheduler has not produced a sample yet, so the
                // server sends no monitorStats at all.
                monitor: true, checkStatus: true,
            },
        ],
        duplicateGroups: [],
    };
}

/**
 * A full monitorStats block. The heartbeat carries varying avgMs so the enlarged
 * chart has something to draw, plus one gap ('unknown') to keep the
 * no-interpolation path covered.
 */
function monitorStats() {
    const now = 1752000000000;
    const heartbeat = [];
    for (let i = 0; i < 40; i += 1) {
        const from = now - (40 - i) * 5 * 60 * 1000;
        if (i === 12) {
            heartbeat.push({ state: 'unknown', from, to: from + 5 * 60 * 1000 });
            continue;
        }
        const down = i === 20 || i === 21;
        heartbeat.push({
            state: down ? 'down' : 'up',
            from,
            to: from + 5 * 60 * 1000,
            up: down ? 0 : 1,
            down: down ? 1 : 0,
            avgMs: down ? 0 : 120 + (i % 7) * 15,
        });
    }
    return {
        intervalMinutes: 5,
        uptime24h: { ratio: 0.992, samples: 288 },
        uptime7d: { ratio: 0.978, samples: 2016 },
        uptime30d: { ratio: 0.981, samples: 8640 },
        heartbeat,
        incidents: [
            { start: now - 90 * 60 * 1000, end: now - 78 * 60 * 1000, durationMs: 12 * 60 * 1000, checks: 2, reason: 'HTTP 500' },
            { start: now - 3 * 86400000, end: now - 3 * 86400000 + 180000, durationMs: 180000, checks: 1 },
        ],
        lastSample: now,
        lastPingMs: 142,
        totalChecks: 8640,
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
    await page.waitForSelector('#dashboard-layout.health-layout .health-view-item', { timeout: 15_000 });
}

test.describe('health dashboard view', () => {
    test('opens from the header icon and renders into the dashboard layout', async ({ page }) => {
        await openHealthView(page);

        // The view owns the container, exactly as inbox does.
        const layout = page.locator('#dashboard-layout');
        await expect(layout).toHaveClass(/health-layout/);
        await expect(layout).toHaveAttribute('role', 'feed');
        await expect(page.locator('.bookmark-link')).toHaveCount(0);

        expect(await page.evaluate(() => window.location.hash)).toBe('#health');
        expect(await page.evaluate(() => window.dashboardInstance.activeView)).toBe('health');
        // No second health entry point: one icon, one badge.
        await expect(page.locator('.health-link')).toHaveCount(1);
    });

    test('the header badge counts broken bookmarks and survives opening the view', async ({ page }) => {
        await openHealthView(page);

        // The count comes from the seeded fixture rather than the mocked report: the
        // badge refreshes on its own schedule, so asserting a mocked number here would
        // be racing the route. What matters is that a count renders and stays.
        const badge = page.locator('.health-link a .health-badge');
        await expect(badge).toBeVisible();
        await expect(badge).toHaveText(/^\d+$/);

        // The dashboard icon should stay hash-based, even while the badge refreshes.
        await expect(page.locator('.health-link a.health-link-anchor')).toHaveAttribute('href', '/#health');
    });

    test('the header icon still opens dashboard health in a new tab', async ({ page, context }) => {
        await page.goto('/');
        await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
        await prepareDashboardInteraction(page);

        // Intercepting the plain left click must not cost the modified-click paths.
        const [popup] = await Promise.all([
            context.waitForEvent('page'),
            page.click('.health-link a.health-link-anchor', { modifiers: ['Meta'] }),
        ]);
        // A fresh tab starts at about:blank, so wait for the real navigation rather
        // than reading url() straight away.
        await popup.waitForURL(/\/#health$/, { timeout: 15_000 });
        const popupUrl = new URL(popup.url());
        expect(popupUrl.pathname).toBe('/');
        expect(popupUrl.hash).toBe('#health');
        await popup.close();
    });

    test('opening health deselects the page tab', async ({ page }) => {
        await openHealthView(page);

        // The regression this guards: page tabs keyed off `activeView !== 'inbox'`,
        // which stays true on health and would leave a page tab looking selected.
        const pageTabSelections = await page.locator('.page-nav-btn:not([data-view-tab])')
            .evaluateAll((tabs) => tabs.map((t) => t.getAttribute('aria-selected')));
        expect(pageTabSelections.every((s) => s === 'false')).toBe(true);
    });

    test('summary tiles appear above the list and filter it', async ({ page }) => {
        await openHealthView(page);

        const tiles = page.locator('.health-view-tile');
        await expect(tiles).toHaveCount(5);
        await expect(page.locator('[data-health-tile="broken"]')).toContainText('1');
        // Broken is the default filter, so its tile starts marked.
        await expect(page.locator('[data-health-tile="broken"]')).toHaveClass(/is-active/);

        await page.click('[data-health-tile="duplicate"]');
        await expect(page.locator('.health-view-item-title')).toHaveText('Dup A');
        await expect(page.locator('.health-view-filter-btn.is-active')).toContainText('Duplicates');
    });

    test('tiles are hidden when the list is empty', async ({ page }) => {
        await page.route('**/api/bookmark-health**', async (route) => {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    generatedAt: Date.now(),
                    summary: { totalBookmarks: 4, healthyCount: 4, brokenCount: 0 },
                    issues: [],
                    duplicateGroups: [],
                }),
            });
        });
        await page.goto('/#health');
        await page.waitForSelector('#dashboard-layout.health-layout', { timeout: 15_000 });
        await expect(page.locator('.health-view-empty-state')).toBeVisible();

        // A wall of zeroes above "nothing to fix" is noise, not information.
        await expect(page.locator('.health-view-tile')).toHaveCount(0);
    });

    test('row actions stay collapsed until the row is selected', async ({ page }) => {
        await openHealthView(page);

        const row = page.locator('.health-view-item').first();
        const collapsed = await row.evaluate((el) => el.getBoundingClientRect().height);

        await page.keyboard.press('j');
        await expect(row).toHaveClass(/keyboard-selected/);
        await expect.poll(async () => row.evaluate((el) => el.getBoundingClientRect().height))
            .toBeGreaterThan(collapsed);

        // Collapsed rows must not merely be transparent: the buttons keep their box
        // for focus, but the row must not reserve their height.
        await expect(row.locator('.health-view-action-btn').first()).toBeVisible();
    });

    test('the shortcut legend renders once, below the list', async ({ page }) => {
        await openHealthView(page);
        await page.click('[data-health-filter="all"]');

        // A single copy under the feed — the top strip was removed as visual clutter.
        await expect(page.locator('.health-view-legend')).toHaveCount(1);
        await expect(page.locator('.health-view-legend--bottom')).toBeVisible();
        await expect(page.locator('.health-view-legend--top')).toHaveCount(0);

        // It sits after the feed, not between toolbar and first row.
        const order = await page.locator('#dashboard-layout > *').evaluateAll(
            (els) => els.map((el) => el.className)
        );
        const legendIndex = order.findIndex((c) => c.includes('legend--bottom'));
        const feedIndex = order.findIndex((c) => c.includes('health-view-feed'));
        expect(legendIndex).toBeGreaterThan(feedIndex);

        // The sole copy stays announced to assistive tech (no longer aria-hidden).
        await expect(page.locator('.health-view-legend--bottom')).not.toHaveAttribute('aria-hidden', 'true');
    });

    test('m opens the row menu, arrows walk it, Escape closes it without leaving', async ({ page }) => {
        await openHealthView(page);

        await page.keyboard.press('j');
        await page.keyboard.press('m');
        const menu = page.locator('.health-view-menu:not([hidden])');
        await expect(menu).toBeVisible();
        await expect(menu.locator('.health-view-menu-item').first()).toBeFocused();

        await page.keyboard.press('ArrowDown');
        await expect(menu.locator('.health-view-menu-item').nth(1)).toBeFocused();

        // Escape belongs to the menu first: closing the whole view would lose the
        // user's place in the list.
        await page.keyboard.press('Escape');
        await expect(menu).toBeHidden();
        expect(await page.evaluate(() => window.dashboardInstance.activeView)).toBe('health');
        await expect(page.locator('#dashboard-layout')).toHaveClass(/health-layout/);
    });

    test('the menu adds actions without repeating the row buttons', async ({ page }) => {
        await openHealthView(page);
        await page.keyboard.press('j');
        await page.keyboard.press('m');

        const items = await page.locator('.health-view-menu:not([hidden]) .health-view-menu-item').allTextContents();
        // Open / Re-check / Edit are buttons on the row; repeating them here would
        // be two paths to the same thing.
        expect(items).not.toContain('Open');
        expect(items).not.toContain('Re-check');
        expect(items).not.toContain('Edit');
        expect(items).toEqual([
            'Show on dashboard',
            'Detect redirect',
            'Refresh title',
            'Refresh favicon',
            'Find in Web Archive',
            // The discoverable route to the check-mode popover; the badge is the
            // fast one, but nothing announces that a badge is clickable.
            'Change checking (Not checked)',
            'Delete bookmark',
        ]);
    });

    test('repair actions only appear on a broken row', async ({ page }) => {
        await openHealthView(page);
        await page.click('[data-health-filter="unchecked"]');

        await page.keyboard.press('j');
        await page.keyboard.press('m');
        const items = await page.locator('.health-view-menu:not([hidden]) .health-view-menu-item').allTextContents();

        // Redirect detection and title refresh cannot help a row that is not broken.
        expect(items).not.toContain('Detect redirect');
        expect(items).not.toContain('Refresh title');
        expect(items).toContain('Refresh favicon');
        expect(items).toContain('Delete bookmark');
        await expect(page.locator('.health-view-menu:not([hidden]) .health-view-menu-label'))
            .toHaveCount(1);
    });

    test('a click outside dismisses the menu', async ({ page }) => {
        await openHealthView(page);
        await page.keyboard.press('j');
        await page.keyboard.press('m');
        await expect(page.locator('.health-view-menu:not([hidden])')).toBeVisible();

        await page.locator('.health-view-title').click();
        await expect(page.locator('.health-view-menu:not([hidden])')).toHaveCount(0);
    });

    test('sorting reorders the list and leaves the shortcuts working', async ({ page }) => {
        await openHealthView(page);
        await page.click('[data-health-filter="all"]');

        // Score ascending by default: worst first. The two monitored rows both
        // score 100, so they tie and fall back to name order.
        await expect(page.locator('.health-view-item-title')).toHaveText([
            'Broken one', 'Dup A', 'Never checked one', 'Monitored one', 'Monitored pending',
        ]);

        await page.selectOption('.health-view-sort-select', 'name');
        await expect(page.locator('.health-view-item-title')).toHaveText([
            'Broken one', 'Dup A', 'Monitored one', 'Monitored pending', 'Never checked one',
        ]);

        await page.selectOption('.health-view-sort-select', 'last-checked-desc');
        const byChecked = await page.locator('.health-view-item-title').allTextContents();
        expect(byChecked).toHaveLength(5);

        // Focus must not stay on the select: a focused SELECT swallows every row
        // shortcut, so j/k/m would go dead until the user clicked away.
        await page.keyboard.press('j');
        await expect(page.locator('.health-view-item.keyboard-selected')).toHaveCount(1);
    });

    test('Shift+H opens the view from the bookmark grid', async ({ page }) => {
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

        await page.keyboard.press('Shift+H');
        await page.waitForSelector('#dashboard-layout.health-layout', { timeout: 15_000 });
        await expect.poll(() => page.evaluate(() => window.dashboardInstance?.activeView)).toBe('health');
        // openHealthView() renders first and only then rewrites the hash (via
        // restoreHealthHash), so the layout class lands before #health does.
        await expect.poll(() => page.evaluate(() => window.location.hash)).toBe('#health');

        // Leaving the view is async (it reloads the page's bookmarks), so poll
        // rather than read activeView on the next tick.
        await page.keyboard.press('Escape');
        await expect.poll(() => page.evaluate(() => window.dashboardInstance?.activeView)).toBe('bookmarks');
    });

    test('Shift+I opens the inbox, and 0 still does too', async ({ page }) => {
        await page.goto('/');
        await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
        await prepareDashboardInteraction(page);

        await page.keyboard.press('Shift+I');
        await expect.poll(() => page.evaluate(() => window.dashboardInstance?.activeView)).toBe('inbox');

        await page.keyboard.press('Escape');
        await expect.poll(() => page.evaluate(() => window.dashboardInstance?.activeView)).toBe('bookmarks');

        // '0' is superseded by Shift+I and no longer documented, but must keep
        // working for anyone who already has the habit.
        await page.keyboard.press('0');
        await expect.poll(() => page.evaluate(() => window.dashboardInstance?.activeView)).toBe('inbox');
    });

    test('bare h and i still open the shortcut search', async ({ page }) => {
        await page.goto('/');
        await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
        await prepareDashboardInteraction(page);

        // The whole reason these views are Shift+letter: bare letters reach a bookmark
        // by its shortcut letter. Taking 'h' or 'i' would make those bookmarks
        // unreachable.
        await page.keyboard.press('h');
        await expect(page.locator('#shortcut-search.show')).toBeVisible();
        expect(await page.evaluate(() => window.dashboardInstance.activeView)).toBe('bookmarks');

        await page.keyboard.press('Escape');
        await expect(page.locator('#shortcut-search.show')).toBeHidden();

        await page.keyboard.press('i');
        await expect(page.locator('#shortcut-search.show')).toBeVisible();
        expect(await page.evaluate(() => window.dashboardInstance.activeView)).toBe('bookmarks');
    });

    test('the cheat sheet teaches Shift+I and Shift+H, not 0', async ({ page }) => {
        await page.goto('/');
        await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
        await prepareDashboardInteraction(page);

        await page.keyboard.press('F1');
        const sheet = page.locator('.modal-overlay.show');
        await expect(sheet).toBeVisible();

        // The rendered label collapses the spaces around '+'.
        await expect(sheet).toContainText('Shift+I');
        await expect(sheet).toContainText('Shift+H');
        await expect(sheet).toContainText('1–9');
        // '0' still works but is on the way out; documenting it would teach a
        // shortcut that is going away.
        await expect(sheet).not.toContainText('0 = Inbox');
    });

    test('the header icon is marked active exactly like the inbox tab', async ({ page }) => {
        await openHealthView(page);

        const healthAnchor = page.locator('.health-link a.health-link-anchor');
        const inboxTab = page.locator('#page-nav-inbox-btn');

        await expect(healthAnchor).toHaveClass(/active/);
        await expect(healthAnchor).toHaveAttribute('aria-current', 'page');
        await expect(inboxTab).not.toHaveClass(/active/);

        // Same underline as an active page tab: the health icon is a header link
        // rather than a tab, so it needs its own rule to look the same.
        const underline = (locator) => locator.evaluate((el) => {
            const cs = getComputedStyle(el);
            return `${cs.borderBottomColor} ${cs.borderBottomWidth}`;
        });
        const healthUnderline = await underline(healthAnchor);
        expect(healthUnderline).not.toContain('rgba(0, 0, 0, 0)');

        // Switching to the inbox must hand the marking over, not light up both.
        await page.keyboard.press('Shift+I');
        await expect.poll(() => page.evaluate(() => window.dashboardInstance?.activeView)).toBe('inbox');
        await expect(healthAnchor).not.toHaveClass(/active/);
        await expect(healthAnchor).not.toHaveAttribute('aria-current', 'page');
        await expect(inboxTab).toHaveClass(/active/);
        // The whole point: the two get the same underline, not merely both a class.
        await expect.poll(() => underline(inboxTab)).toBe(healthUnderline);
    });

    test('the header icon is unmarked again on the bookmark grid', async ({ page }) => {
        await openHealthView(page);
        await expect(page.locator('.health-link a.health-link-anchor')).toHaveClass(/active/);

        await page.keyboard.press('Escape');
        await expect.poll(() => page.evaluate(() => window.dashboardInstance?.activeView)).toBe('bookmarks');
        await expect(page.locator('.health-link a.health-link-anchor')).not.toHaveClass(/active/);
        await expect(page.locator('.health-link a.health-link-anchor')).not.toHaveAttribute('aria-current', 'page');
    });

    test('no raw translation keys leak into the view', async ({ page }) => {
        await openHealthView(page);
        await page.click('[data-health-filter="all"]');

        // formatDashboardLabel prepends 'dashboard.' itself; passing it a full key
        // rendered 'dashboard.dashboard.healthMoreReasons' on screen.
        const text = await page.locator('#dashboard-layout').innerText();
        expect(text).not.toContain('dashboard.');
        expect(text).not.toMatch(/health[A-Z]\w+/);
    });

    test('defaults to broken and filters to duplicates on demand', async ({ page }) => {
        await openHealthView(page);

        await expect(page.locator('.health-view-filter-btn.is-active')).toContainText('Broken');
        await expect(page.locator('.health-view-item')).toHaveCount(1);
        await expect(page.locator('.health-view-item-title')).toHaveText('Broken one');

        await page.click('[data-health-filter="duplicate"]');
        await expect(page.locator('.health-view-item-title')).toHaveText('Dup A');
        await expect(page.locator('.health-view-item-reason')).toContainText('Duplicate URL in 2 bookmarks');

        await page.click('[data-health-filter="all"]');
        await expect(page.locator('.health-view-item')).toHaveCount(5);
    });

    test('j and k move the selection without opening search', async ({ page }) => {
        await openHealthView(page);
        await page.click('[data-health-filter="all"]');

        await page.keyboard.press('j');
        const first = page.locator('.health-view-item.keyboard-selected');
        await expect(first).toHaveCount(1);
        await expect(first).toHaveAttribute('aria-selected', 'true');
        // Worth asserting: j/k are also type-to-search triggers on the bookmark grid.
        await expect(page.locator('#search-overlay.active')).toHaveCount(0);

        const firstKey = await first.getAttribute('data-health-key');
        await page.keyboard.press('j');
        const secondKey = await page.locator('.health-view-item.keyboard-selected').getAttribute('data-health-key');
        expect(secondKey).not.toBe(firstKey);

        await page.keyboard.press('k');
        expect(await page.locator('.health-view-item.keyboard-selected').getAttribute('data-health-key')).toBe(firstKey);
    });

    test('s unfolds a breakdown that reconciles with the score', async ({ page }) => {
        await openHealthView(page);

        await page.keyboard.press('j');
        const panel = page.locator('.health-view-item.keyboard-selected .health-view-score-panel');
        await expect(panel).toBeHidden();

        await page.keyboard.press('s');
        await expect(panel).toBeVisible();
        await expect(page.locator('.health-view-item.keyboard-selected .health-view-item-score'))
            .toHaveAttribute('aria-expanded', 'true');

        const costs = await panel.locator('.health-view-score-item-cost').allTextContents();
        const deducted = costs.reduce((sum, text) => sum + Number(text.replace(/[^0-9]/g, '')), 0);
        expect(deducted).toBe(75);
        await expect(panel.locator('.health-view-score-total-value')).toHaveText('25');
        expect(100 - deducted).toBe(25);

        await page.keyboard.press('s');
        await expect(panel).toBeHidden();
    });

    test('Escape returns to the bookmark grid', async ({ page }) => {
        await openHealthView(page);

        await page.keyboard.press('Escape');
        await expect(page.locator('#dashboard-layout')).not.toHaveClass(/health-layout/);
        expect(await page.evaluate(() => window.dashboardInstance.activeView)).toBe('bookmarks');
        await expect(page.locator('.bookmark-link').first()).toBeVisible();
    });

    test('#health deep link restores the view on load', async ({ page }) => {
        await page.route('**/api/bookmark-health**', async (route) => {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify(report()),
            });
        });
        await page.goto('/#health');
        await page.waitForSelector('#dashboard-layout.health-layout', { timeout: 15_000 });
        // The layout class lands before dashboardInstance is necessarily exposed on
        // window, so poll rather than read it once.
        await expect.poll(
            () => page.evaluate(() => window.dashboardInstance?.activeView),
            { timeout: 10_000 }
        ).toBe('health');
        // The startup page load must leave the deep link alone: it used to rewrite
        // the hash to #1 before anything had consumed #health.
        await expect.poll(() => page.evaluate(() => window.location.hash)).toBe('#health');
    });

    test('score badge is a real button and does not double-fire the row', async ({ page }) => {
        await openHealthView(page);

        // Enter on the badge must toggle the panel only. The equivalent bug on
        // The health action should only open config and leave score collapsed.
        const badge = page.locator('.health-view-item-score').first();
        await badge.focus();
        await page.keyboard.press('Enter');

        await expect(page.locator('.health-view-item .health-view-score-panel').first()).toBeVisible();
        expect(page.url()).not.toContain('/config');
        await expect(page.locator('#dashboard-layout')).toHaveClass(/health-layout/);
    });
});

/**
 * Enlarging a monitored row's statistics. The row strip only has room for a 24h
 * figure and one ping; these cover the modal that shows the rest.
 */
test.describe('health view — enlarged monitor statistics', () => {
    const monitoredRow = '.health-view-item:has-text("Monitored one")';

    async function openMonitored(page) {
        await openHealthView(page);
        await page.click('[data-health-filter="monitored"]');
        await page.waitForSelector(monitoredRow);
    }

    test('the enlarge button appears only on rows with monitoring data', async ({ page }) => {
        await openMonitored(page);

        // Monitored and sampled: the button is there.
        await expect(page.locator(`${monitoredRow} .health-monitor-expand-btn`)).toHaveCount(1);
        // Monitored but awaiting a first check has nothing to enlarge.
        await expect(
            page.locator('.health-view-item:has-text("Monitored pending") .health-monitor-expand-btn')
        ).toHaveCount(0);

        // And an unmonitored row has no strip at all.
        await page.click('[data-health-filter="broken"]');
        await page.waitForSelector('.health-view-item:has-text("Broken one")');
        await expect(
            page.locator('.health-view-item:has-text("Broken one") .health-monitor-expand-btn')
        ).toHaveCount(0);
    });

    test('the modal shows the windows the row strip has no room for', async ({ page }) => {
        await openMonitored(page);
        await page.click(`${monitoredRow} .health-monitor-expand-btn`);

        const stats = page.locator('.health-monitor-stats');
        await expect(stats).toBeVisible();

        // 7d and 30d are the point of enlarging: the row only ever shows 24h.
        await expect(stats).toContainText('97.8%');
        await expect(stats).toContainText('98.1%');
        await expect(stats).toContainText('99.2%');

        // The big chart, and the incidents the row never lists.
        await expect(stats.locator('.health-sparkline--large')).toHaveCount(1);
        await expect(stats.locator('.health-view-score-item')).toHaveCount(2);
        await expect(stats).toContainText('HTTP 500');

        // Outage lengths come from durationMs, the server's field name. Reading
        // `duration` instead rendered every closed outage as "0s".
        await expect(stats.locator('.health-view-score-item-cost').first()).toHaveText('12m');
        await expect(stats.locator('.health-view-score-item-cost')).not.toHaveText(['0s', '0s']);
    });

    test('outage lengths in the score panel come from durationMs, not duration', async ({ page }) => {
        // The score panel is where outages shipped first, so it gets its own
        // assertion: the server sends HealthIncident.Duration as `durationMs`, and
        // reading `duration` formatted undefined into "0s" for every closed outage.
        await openMonitored(page);

        await page.click(`${monitoredRow} .health-view-item-score`);
        const panel = page.locator(`${monitoredRow} .health-view-score-panel`);
        await expect(panel).toBeVisible();
        await expect(panel.locator('.health-view-score-item-cost').first()).toHaveText('12m');
        await expect(panel.locator('.health-view-score-item-cost').nth(1)).toHaveText('3m');
    });

    test('"i" opens the statistics for the selected row', async ({ page }) => {
        await openMonitored(page);

        // Select the row the way the keyboard path does, then press i.
        await page.click(`${monitoredRow} .health-view-item-title`);
        await page.keyboard.press('i');

        await expect(page.locator('.health-monitor-stats')).toBeVisible();
    });

    test('Escape closes the modal and leaves the health view open', async ({ page }) => {
        await openMonitored(page);
        await page.click(`${monitoredRow} .health-monitor-expand-btn`);
        await expect(page.locator('.health-monitor-stats')).toBeVisible();

        // The regression this guards: the view's own Escape handler runs in the
        // capture phase, so without the isModalOpen guard this would close the
        // whole view instead of just the overlay.
        await page.keyboard.press('Escape');

        await expect(page.locator('.health-monitor-stats')).toBeHidden();
        await expect(page.locator('#dashboard-layout')).toHaveClass(/health-layout/);
        expect(await page.evaluate(() => window.dashboardInstance.activeView)).toBe('health');
    });
});
