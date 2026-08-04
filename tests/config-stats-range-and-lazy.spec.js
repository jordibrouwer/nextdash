// @ts-check
const { test, expect } = require('@playwright/test');
const { dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * Two things Statistics did without being asked.
 *
 * The activity range reset to 30 days on every visit while the sub-tab you were
 * on survived, so half the view was remembered and half was not. And the health
 * summary was fetched on every Statistics open — the only one of the three
 * tab-owned endpoints not loading lazily — for a tab most visits never reach.
 */

const RANGE_KEY = 'nextdash:config-stats-range-v1';

async function loadDashboard(page) {
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.allBookmarks?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
}

async function openStats(page) {
    await page.evaluate(() => window.dashboardInstance.config.openConfigView('stats'));
    await page.waitForFunction(() => typeof window.DashboardConfig === 'function', null, { timeout: 10_000 });
}

test.describe('statistics: the activity range is remembered', () => {
    test('a chosen range survives a reload', async ({ page }) => {
        await loadDashboard(page);
        await openStats(page);
        await page.locator('[data-stats-tab="activity"]').click();
        await page.locator('[data-stats-range="365"]').click();
        await expect.poll(() => page.evaluate(() => window.dashboardInstance.config.statsRange)).toBe(365);

        await page.reload();
        await loadDashboard(page);
        await openStats(page);
        expect(await page.evaluate(() => window.dashboardInstance.config.statsRange)).toBe(365);
    });

    test('the stored range drives the chart, not just the state', async ({ page }) => {
        await loadDashboard(page);
        await page.evaluate((k) => localStorage.setItem(k, '7'), RANGE_KEY);
        await page.reload();
        await loadDashboard(page);
        await openStats(page);
        await page.locator('[data-stats-tab="activity"]').click();

        // The button reflects it, and so does the axis the range decides.
        await expect(page.locator('[data-stats-range="7"]')).toHaveAttribute('aria-pressed', 'true');
        await expect(page.locator('.config-chart-axis-x')).toHaveText(/day/i);
    });

    test('a junk stored value falls back to 30 rather than sticking', async ({ page }) => {
        await loadDashboard(page);
        // 999 is not a button, so honouring it would strand the chart on a range
        // with no way back.
        await page.evaluate((k) => localStorage.setItem(k, '999'), RANGE_KEY);
        await page.reload();
        await loadDashboard(page);
        await openStats(page);
        expect(await page.evaluate(() => window.dashboardInstance.config.statsRange)).toBe(30);
    });

    test('a browser that refuses this key still works', async ({ page }) => {
        // Safari in private mode throws on setItem rather than failing quietly.
        // Only this key is broken: the dashboard needs localStorage to boot, so
        // disabling it wholesale would test the harness, not the fallback.
        await page.addInitScript((k) => {
            const realGet = Storage.prototype.getItem;
            const realSet = Storage.prototype.setItem;
            Storage.prototype.getItem = function (key) {
                if (key === k) throw new Error('blocked');
                return realGet.call(this, key);
            };
            Storage.prototype.setItem = function (key, value) {
                if (key === k) throw new Error('blocked');
                return realSet.call(this, key, value);
            };
        }, RANGE_KEY);
        await loadDashboard(page);
        await openStats(page);
        await page.locator('[data-stats-tab="activity"]').click();
        // Falls back to the default and the range still applies for this visit.
        expect(await page.evaluate(() => window.dashboardInstance.config.statsRange)).toBe(30);
        await page.locator('[data-stats-range="90"]').click();
        await expect.poll(() => page.evaluate(() => window.dashboardInstance.config.statsRange)).toBe(90);
    });
});

test.describe('statistics: health loads only when its tab is opened', () => {
    /** Counts requests to the health endpoint across a run. */
    const trackHealth = (page) => {
        const hits = [];
        page.on('request', (r) => {
            if (r.url().includes('/api/bookmark-health')) hits.push(r.url());
        });
        return hits;
    };

    test('opening Statistics does not fetch the health summary', async ({ page }) => {
        const hits = trackHealth(page);
        await loadDashboard(page);
        const before = hits.length;

        await openStats(page);
        await page.waitForTimeout(600);
        expect(hits.length - before).toBe(0);
    });

    test('opening the Health tab fetches it, once', async ({ page }) => {
        const hits = trackHealth(page);
        await loadDashboard(page);
        const before = hits.length;

        await openStats(page);
        await page.locator('[data-stats-tab="health"]').click();
        await expect.poll(() => hits.length - before, { timeout: 10_000 }).toBe(1);
        await expect(page.locator('#config-stats-health')).toBeVisible();

        // Leaving and returning must not refetch — the result is cached.
        await page.locator('[data-stats-tab="overview"]').click();
        await page.locator('[data-stats-tab="health"]').click();
        await page.waitForTimeout(600);
        expect(hits.length - before).toBe(1);
    });

    test('landing straight on the Health tab still fetches it', async ({ page }) => {
        const hits = trackHealth(page);
        await loadDashboard(page);
        const before = hits.length;

        // The restored tab is not a click, so the fetch cannot hang off one.
        await page.evaluate(() => {
            window.dashboardInstance.config.statsTab = 'health';
            window.dashboardInstance.config.openConfigView('stats');
        });
        await page.waitForFunction(() => typeof window.DashboardConfig === 'function', null, { timeout: 10_000 });
        await expect.poll(() => hits.length - before, { timeout: 10_000 }).toBeGreaterThan(0);
        await expect(page.locator('#config-stats-health')).toBeVisible();
    });

    test('the other tabs still load their own data', async ({ page }) => {
        await loadDashboard(page);
        await openStats(page);
        // One helper now drives all three, so a regression would take them all.
        await page.locator('[data-stats-tab="inbox"]').click();
        await expect.poll(() => page.evaluate(() =>
            window.dashboardInstance.config._statsInboxItems !== undefined), { timeout: 10_000 }).toBe(true);

        await page.locator('[data-stats-tab="activity"]').click();
        await expect.poll(() => page.evaluate(() =>
            window.dashboardInstance.config._statsFinders !== undefined), { timeout: 10_000 }).toBe(true);
    });
});
