// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissBlockingOverlays, dismissOnboardingIfPresent } = require('./e2e-helpers');

/**
 * Keep was only reachable by starting a triage run first (the "r" key).
 * The right-click context menu on an inbox row now carries its own "Keep"
 * entry, calling the same DashboardInbox.keepItem() triage's "r" uses.
 */
test('the inbox row context menu offers Keep, promoting to Unsorted', async ({ page }) => {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => window.dashboardInstance?.inbox != null, null, { timeout: 15_000 });
    await page.evaluate(() => { window.dashboardInstance.settings.inboxEnabled = true; });

    const url = `https://inbox-keep-menu-${Date.now()}.example/x`;
    await page.evaluate(async (u) => {
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        await api('/api/inbox', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: u, title: 'Keep via menu' }),
        });
    }, url);

    await page.locator('#page-nav-inbox-btn').click();
    await expect(page.locator('.inbox-layout')).toBeVisible();
    await page.evaluate(() => window.dashboardInstance.inbox.loadAndRender({ refresh: true }));
    const row = page.locator('.inbox-item', { hasText: 'Keep via menu' });
    await expect(row).toBeVisible({ timeout: 10_000 });

    await row.click({ button: 'right' });
    await page.waitForSelector('#bookmark-context-menu', { timeout: 10_000 });
    await page.click('#bookmark-context-menu [data-action="inbox-keep"]');

    await expect(row).toHaveCount(0, { timeout: 5_000 });
    await expect.poll(async () => {
        const res = await page.request.get('/api/unsorted');
        const body = await res.json();
        return body.bookmarks.some((b) => b.url === url);
    }, { timeout: 10_000 }).toBe(true);
});
