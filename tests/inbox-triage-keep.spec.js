const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissBlockingOverlays, dismissOnboardingIfPresent } = require('./e2e-helpers');

/**
 * Keep used to just mark the inbox item read. Now it silently promotes the
 * link to a real bookmark on the reserved Unsorted page -- no modal, no
 * category choice, that is the entire point of Unsorted.
 */
test('Keep promotes an inbox item to Unsorted without opening a modal', async ({ page }) => {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => window.dashboardInstance?.inbox != null, null, { timeout: 15_000 });
    await page.evaluate(() => { window.dashboardInstance.settings.inboxEnabled = true; });

    const url = `https://keep-${Date.now()}.example/x`;
    await page.evaluate(async (u) => {
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        await api('/api/inbox', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: u, title: 'Keep me' }),
        });
    }, url);

    await page.locator('#page-nav-inbox-btn').click();
    await expect(page.locator('.inbox-layout')).toBeVisible();
    await page.evaluate(() => window.dashboardInstance.inbox.loadAndRender({ refresh: true }));
    await expect.poll(() => page.evaluate(() =>
        (window.dashboardInstance.inbox.items || []).length), { timeout: 10_000 }).toBeGreaterThan(0);

    await page.keyboard.press('t');
    await expect.poll(() => page.evaluate(() =>
        !!window.dashboardInstance.inbox.triage?.isOpen?.()), { timeout: 10_000 }).toBe(true);

    await page.keyboard.press('r');

    // No bookmark form modal opened.
    await expect(page.locator('#bookmark-form-modal, .bookmark-form-modal')).toBeHidden();

    // It now exists as a bookmark on the Unsorted page.
    await expect.poll(async () => {
        const res = await page.request.get('/api/unsorted');
        const body = await res.json();
        return body.bookmarks.some((b) => b.url === url);
    }, { timeout: 10_000 }).toBe(true);
});
