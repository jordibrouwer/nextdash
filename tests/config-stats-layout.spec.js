// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * Statistics as a grid: renamed tabs that old links still reach, six figures
 * at the top of every tab, panels two to a row on a wide window and one on a
 * narrow one, and tab links that no longer collide with bookmark rows.
 */

const BOOKMARKS = [
    { url: 'https://a.example', name: 'Alpha', pageId: 1, tags: ['dev', 'code'], openCount: 9, lastOpened: Date.now() - 86400000, shortcut: 'a' },
    { url: 'https://b.example', name: 'Beta', pageId: 1, tags: ['dev'], openCount: 3, lastOpened: Date.now() - 5 * 86400000 },
    { url: 'https://c.example', name: 'Gamma', pageId: 1, tags: [], openCount: 1, lastOpened: Date.now() - 40 * 86400000 },
    { url: 'http://192.168.0.3', name: 'Router', pageId: 1, tags: [], openCount: 0 },
];

async function openHash(page, hash, { width = 1440 } = {}) {
    await page.setViewportSize({ width, height: 1000 });
    await markWhatsNewSeen(page);
    await page.goto(`/${hash}`);
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });
    await page.evaluate((bms) => {
        const d = window.dashboardInstance;
        const pageId = d.pages?.[0]?.id ?? 1;
        d.allBookmarks = bms.map((b) => ({ ...b, pageId }));
    }, BOOKMARKS);
    await page.evaluate(() => window.dashboardInstance.config.openConfigView('stats'));
    await page.waitForFunction(() => window.DashboardConfigStatsReady === true, null, { timeout: 20_000 });
    await page.evaluate(() => window.dashboardInstance.config.repaintStatsBody());
    await page.waitForSelector('#config-stats-body .config-stats-kpis', { timeout: 20_000 });
}

test.describe('statistics layout', () => {
    test('old tab hashes open the renamed tabs', async ({ page }) => {
        await openHash(page, '#config/stats/activity');
        expect(await page.evaluate(() => window.dashboardInstance.config.statsTab)).toBe('usage');
        await expect(page.locator('[data-stats-tab="usage"]')).toHaveAttribute('aria-selected', 'true');
        await openHash(page, '#config/stats/content');
        expect(await page.evaluate(() => window.dashboardInstance.config.statsTab)).toBe('collection');
    });

    test('every tab opens with six figures', async ({ page }) => {
        await openHash(page, '#config/stats');
        for (const tab of ['overview', 'usage', 'collection', 'inbox', 'health']) {
            await page.locator(`[data-stats-tab="${tab}"]`).click();
            await expect(page.locator('#config-stats-body .config-stats-kpis > [role="listitem"]')).toHaveCount(6, { timeout: 15_000 });
        }
    });

    test('half-width panels sit two to a row wide, and stack narrow', async ({ page }) => {
        const tops = () => page.$$eval('#config-stats-body .config-stats-panel[data-span="6"]',
            (els) => els.slice(0, 2).map((e) => Math.round(e.getBoundingClientRect().top)));
        await openHash(page, '#config/stats/usage');
        const wide = await tops();
        expect(wide[0]).toBe(wide[1]);
        await page.setViewportSize({ width: 800, height: 1000 });
        const narrow = await tops();
        expect(narrow[1]).toBeGreaterThan(narrow[0]);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
        expect(overflow).toBe(false);
    });

    test('a tag row opens Bookmarks without changing the statistics tab', async ({ page }) => {
        await openHash(page, '#config/stats/usage');
        await page.locator('[data-stats-goto="tag:dev"]').first().click();
        expect(await page.evaluate(() => window.dashboardInstance.config.statsTab)).toBe('usage');
    });

    test('the line under the tabs follows the open tab', async ({ page }) => {
        await openHash(page, '#config/stats');
        const note = () => page.locator('.config-tab-note').first().textContent();
        const before = await note();
        await page.locator('[data-stats-tab="health"]').click();
        await expect.poll(note).not.toBe(before);
    });

    test('refresh and export sit in the tab row', async ({ page }) => {
        await openHash(page, '#config/stats');
        await expect(page.locator('.config-stats-head [data-stats-action="refresh"]')).toBeVisible();
        await expect(page.locator('.config-stats-head [data-stats-action="export"]')).toBeVisible();
    });
});
