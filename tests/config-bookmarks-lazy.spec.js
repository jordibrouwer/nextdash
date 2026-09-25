// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissBlockingOverlays, dismissOnboardingIfPresent } = require('./e2e-helpers');

/**
 * The bookmark list's renderers arrive with the section, not with the module.
 *
 * Twelve methods drew one list — rows, bulk bar, tag cloud, chips, crumbs — and
 * every visit to any other config section carried them. Split out the way
 * Statistics already is: fetched when config opens, so the list is drawn once
 * and complete, and never fetched at all by someone who only ever changes a
 * theme.
 */

async function openConfig(page, section) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.evaluate((s) => { const c = window.dashboardInstance.config; if (s === 'appearance' || s === 'behavior') c[`${s}Tab`] = c[`${s}Tab`] || 'general'; return c.openConfigView(s); }, section);
    await page.waitForSelector('#config-section-panel, #config-view-body', { timeout: 15_000 });
}

test.describe('the bookmark list loads with its section', () => {
    test('the dashboard alone never fetches it', async ({ page }) => {
        const asked = [];
        page.on('request', (r) => {
            if (r.url().includes('dashboard-config-bookmarks')) asked.push(r.url());
        });
        await markWhatsNewSeen(page);
        await page.goto('/');
        await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
        await page.waitForTimeout(800);
        expect(asked.length).toBe(0);
    });

    test('opening Bookmarks draws the list once, complete', async ({ page }) => {
        await openConfig(page, 'bookmarks');

        // No placeholder left behind, and the rows are really there.
        await expect(page.locator('#config-bm-list .config-bm-row').first()).toBeVisible({ timeout: 15_000 });
        expect(await page.evaluate(() => window.DashboardConfigBookmarksReady === true)).toBe(true);
        const loading = await page.locator('#config-bm-list').innerText();
        expect(loading).not.toMatch(/loading your bookmarks/i);
    });

    test('the section still works when the file cannot be fetched', async ({ page }) => {
        await page.route('**/dashboard-config-bookmarks*', (route) => route.abort());
        await openConfig(page, 'bookmarks');

        // A failure leaves the placeholder, which says the list is on its way —
        // better than an empty panel that reads as a library with nothing in it.
        await expect(page.locator('#config-bm-list')).toContainText(/loading your bookmarks|bladwijzers laden/i, { timeout: 15_000 });
        // And the rest of config is untouched: the toolbar above it still draws.
        await expect(page.locator('#config-bm-search')).toBeVisible();
    });
});

test('a repaint asked for before the renderers land waits for them, without an error', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    // Hold the list's renderers back, so the moment between opening the
    // section and their arrival is long enough to ask for a repaint in.
    await page.route('**/dashboard-config-bookmarks-workbench*', async (route) => {
        await new Promise((r) => setTimeout(r, 1500));
        await route.continue();
    });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.evaluate(() => {
        const c = window.dashboardInstance.config;
        void c.openConfigView('bookmarks');
        // A list host already on screen -- from an earlier visit -- and a data
        // refresh landing now, asking for it to be drawn again.
        if (!document.getElementById('config-bm-list')) {
            const host = document.createElement('div');
            host.id = 'config-bm-list';
            document.body.appendChild(host);
        }
        c.repaintBookmarksList();
    });
    await page.waitForSelector('#config-bm-list .config-bm-row', { timeout: 15_000 });
    expect(errors).toEqual([]);
});
