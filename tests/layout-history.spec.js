// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays, waitForConfigReady } = require('./e2e-helpers');

/**
 * Earlier arrangements of a page, restored from Find settings. Driven through
 * the entry the reader uses: the action in the finder, then the Restore button.
 */

async function openDashboard(page) {
    await page.setViewportSize({ width: 1400, height: 900 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });
}

const api = (page, method, url, body) => page.evaluate(async ([m, u, b]) => {
    const f = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
    const h = { 'Content-Type': 'application/json', ...(typeof nextDashWriteHeaders === 'function' ? nextDashWriteHeaders() : {}) };
    const res = await f(u, { method: m, headers: h, body: b ? JSON.stringify(b) : undefined });
    return res.ok ? res.json() : { error: res.status };
}, [method, url, body]);

test.describe('layout history', () => {
    test('a removed widget comes back from the list, and the restore can itself be undone', async ({ page }) => {
        // One real wait: a burst of edits is twenty seconds long.
        test.setTimeout(90_000);
        await openDashboard(page);
        const keep = { id: 'w_aaaaaaaaaaaa', type: 'notes', title: 'Keep', config: { text: 'k' } };
        const gone = { id: 'w_bbbbbbbbbbbb', type: 'notes', title: 'Gone', config: { text: 'g' } };
        await api(page, 'PUT', '/api/pages/1/blocks', { widgets: [keep, gone] });
        // The history files a layout only once the last one is older than a burst of edits.
        await page.waitForTimeout(21_000);
        await api(page, 'PUT', '/api/pages/1/blocks', { widgets: [keep] });
        await page.reload({ waitUntil: 'networkidle' });
        await expect(page.locator('.dashboard-widget[data-widget-type="notes"]')).toHaveCount(1, { timeout: 15_000 });

        await waitForConfigReady(page);
        await page.evaluate(() => window.dashboardInstance.config.openConfigView('overview'));
        await page.waitForSelector('.config-view', { timeout: 15_000 });
        await page.evaluate(() => {
            const c = window.dashboardInstance.config._module || window.dashboardInstance.config;
            return c.activateSettingsJumpEntry(c.getSettingsJumpEntries().find((e) => e.action === 'layout-history'));
        });
        const restore = page.locator('[data-layout-restore]').first();
        await expect(restore).toBeVisible({ timeout: 10_000 });
        await expect(page.locator('.config-layout-history-box')).toContainText('brings back Gone');
        await restore.click();

        await expect(page.locator('#app-modal.show')).toHaveCount(0, { timeout: 10_000 });
        // The grid behind Config is drawn again from the restored page.
        await expect.poll(() => page.evaluate(() => (window.dashboardInstance.widgets || []).map((w) => w.title).join()), { timeout: 15_000 }).toBe('Keep,Gone');
        const stored = await api(page, 'GET', '/api/pages/1/blocks');
        expect(stored.widgets.map((w) => w.title)).toEqual(['Keep', 'Gone']);
        // The layout the restore replaced is now the newest entry.
        const history = await api(page, 'GET', '/api/pages/1/layout-history');
        expect(history.entries[0].removes).toEqual(['Gone']);
    });

    test('an install with no earlier layout says so', async ({ page }) => {
        await openDashboard(page);
        await page.route('**/api/pages/*/layout-history', (route) => route.fulfill({
            status: 200, contentType: 'application/json', body: JSON.stringify({ entries: [] }),
        }));
        await waitForConfigReady(page);
        await page.evaluate(() => window.dashboardInstance.config.openConfigView('overview'));
        await page.waitForSelector('.config-view', { timeout: 15_000 });
        await page.evaluate(() => (window.dashboardInstance.config._module || window.dashboardInstance.config).openLayoutHistory());
        await expect(page.locator('.config-layout-history-box')).toContainText('No earlier layouts yet');
    });
});
