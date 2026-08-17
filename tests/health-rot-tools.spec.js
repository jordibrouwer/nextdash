// @ts-check
const { test, expect } = require('@playwright/test');
const { markWhatsNewSeen, dismissBlockingOverlays, dismissOnboardingIfPresent } = require('./e2e-helpers');

/**
 * The three additions the health view carries for link rot: a list that can be
 * read by site, a report of what has rotted, and a way to fix a domain move on
 * a whole selection at once.
 */

async function healthView(page) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 20_000 });
    await page.evaluate(() => window.dashboardInstance.health.openHealthView());
    await page.waitForTimeout(1200);
    await page.evaluate(() => {
        const h = window.dashboardInstance.health._module || window.dashboardInstance.health;
        h.filter = 'all';
        h._resetFeedPaging();
        h.render();
    });
    await page.waitForSelector('.health-view-item', { timeout: 20_000 });
}

test.describe('reading the list by site', () => {
    test('the toggle groups every row under its host', async ({ page }) => {
        await healthView(page);
        await page.locator('.health-view-groupby-btn').click();
        await page.waitForTimeout(500);

        const grouped = await page.evaluate(() => {
            const h = window.dashboardInstance.health._module || window.dashboardInstance.health;
            const groups = h.groupFilteredIssues(h.getFilteredIssues());
            return {
                on: h.groupByHost,
                keys: groups.map((g) => g.key),
                // Biggest site first: the one with the most rows behind it is the
                // one worth looking at.
                sizes: groups.map((g) => g.items.length),
            };
        });
        expect(grouped.on).toBe(true);
        expect(grouped.keys.length).toBeGreaterThan(0);
        expect(grouped.keys.every((k) => k.startsWith('host:'))).toBe(true);
        expect([...grouped.sizes]).toEqual([...grouped.sizes].sort((a, b) => b - a));

        await page.locator('.health-view-groupby-btn').click();
        await page.waitForTimeout(400);
        expect(await page.evaluate(() => {
            const h = window.dashboardInstance.health._module || window.dashboardInstance.health;
            return h.groupFilteredIssues(h.getFilteredIssues()).map((g) => g.key);
        })).toEqual(['flat']);
    });
});

test.describe('the rot report', () => {
    test('opens with a section per finding, and says so when there is nothing', async ({ page }) => {
        await healthView(page);
        await page.locator('.health-view-rot-btn').click();
        const modal = page.locator('.health-rot-modal');
        await expect(modal).toBeVisible({ timeout: 10_000 });

        const headings = await modal.locator('.health-explain-row h4').allTextContents();
        expect(headings.length).toBe(5);
        expect(headings.join(' ')).toMatch(/Gone without saying so/i);
        expect(headings.join(' ')).toMatch(/Failing for over a month/i);
    });
});

test.describe('a domain move is one action', () => {
    test('the bulk bar offers following redirects', async ({ page }) => {
        await healthView(page);
        // Rendered from the module rather than reached through a click: the bar
        // only exists while rows are selected, and what is being pinned here is
        // that the action is on it at all.
        const html = await page.evaluate(() => {
            const h = window.dashboardInstance.health._module || window.dashboardInstance.health;
            const ms = h.multiSelect || h._multiSelect || h.multiSelectController;
            if (!ms?.renderToolbar) return '';
            ms.selected = new Set([h.issueKey(h.getFilteredIssues()[0])]);
            return ms.renderToolbar() || '';
        });
        expect(html).toContain('data-bulk="heal"');
        expect(html).toMatch(/Follow redirects/i);
    });
});
