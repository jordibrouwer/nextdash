// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * The Inbox icon says how many links wait in Kept, on its tooltip.
 */

async function bootstrap(page, rows) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });
    await page.evaluate(async (list) => {
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        const current = await (await fetch('/api/unsorted', { cache: 'no-store' })).json();
        for (const bookmark of current.bookmarks || []) {
            await api('/api/bookmarks', {
                method: 'DELETE', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ page: 999999, bookmark }),
            });
        }
        for (const bookmark of list) {
            await api('/api/bookmarks/add', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ page: 999999, bookmark: { ...bookmark, category: '' } }),
            });
        }
        const patch = { inboxEnabled: true, unsortedEnabled: true, inboxShowInPageTabs: true };
        await api('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) });
        Object.assign(window.dashboardInstance.settings, patch);
        await window.dashboardInstance.loadAllBookmarks?.();
    }, rows);
}

test('the Inbox icon names the kept count in its tooltip', async ({ page }) => {
    await bootstrap(page, [
        { name: 'Kept One', url: 'https://kept-one.example/', createdAt: 1000 },
        { name: 'Kept Two', url: 'https://kept-two.example/', createdAt: 2000 },
    ]);
    await page.evaluate(() => window.dashboardInstance.pageNav.updateInboxTabBadge());
    await expect(page.locator('#page-nav-inbox-btn')).toHaveAttribute('title', /Inbox · 2 kept/);
    await expect(page.locator('#page-nav-inbox-btn')).toHaveAttribute('aria-label', /2 kept/);
});

test('nothing kept leaves the tooltip as the plain name', async ({ page }) => {
    await bootstrap(page, []);
    await page.evaluate(() => window.dashboardInstance.pageNav.updateInboxTabBadge());
    await expect(page.locator('#page-nav-inbox-btn')).toHaveAttribute('title', /^Inbox$/);
});
