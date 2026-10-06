// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, markInboxTutorialSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');
const { sidePanel } = require('./config-bookmarks-helpers');

/**
 * The kept page is called Unsorted, never 999999.
 *
 * Kept links live on a hidden pseudo-page with id 999999. It is not in
 * d.pages, so every place that looked a page name up there and fell back to
 * the id printed the id: the group header in Bookmarks → Unsorted read
 * "999999", and so did the side panel's location line.
 */

async function bootstrap(page, settings = {}) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await markInboxTutorialSeen(page);
    await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });
    await page.evaluate(async (extra) => {
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        const current = await (await fetch('/api/unsorted', { cache: 'no-store' })).json();
        for (const bookmark of current.bookmarks || []) {
            await api('/api/bookmarks', {
                method: 'DELETE', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ page: 999999, bookmark }),
            });
        }
        const patch = { inboxEnabled: true, unsortedEnabled: true, keepAutoFile: false, ...extra };
        await api('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) });
        Object.assign(window.dashboardInstance.settings, patch);
        await window.dashboardInstance.loadAllBookmarks?.();
    }, settings);
}

async function queue(page, url, title) {
    await page.evaluate(async ({ u, t }) => {
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        await api('/api/inbox', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: u, title: t }),
        });
    }, { u: url, t: title });
    await page.evaluate(() => window.dashboardInstance.inbox.openInboxView());
    await page.evaluate(() => window.dashboardInstance.inbox.loadAndRender({ refresh: true }));
    await expect(page.locator('.inbox-item', { hasText: title })).toBeVisible({ timeout: 10_000 });
}

async function keepFromRow(page, title) {
    await page.locator('.inbox-item', { hasText: title }).locator('.inbox-item-title').click();
    await page.locator('[data-lvs-drawer="inbox"] [data-slp-action="keep"]').click();
}

test('Bookmarks → Unsorted names the kept page in the group header and the side panel', async ({ page }) => {
    await bootstrap(page);
    const url = `https://label-${Date.now()}.example/x`;
    await queue(page, url, 'Label me');
    await keepFromRow(page, 'Label me');
    await expect(page.locator('.app-notification', { hasText: 'Kept' })).toBeVisible({ timeout: 5_000 });

    await page.goto('/#unsorted');
    await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });
    await expect(page).toHaveURL(/#bookmarks\?filter=unsorted$/);
    await page.locator('#config-bm-group').selectOption('page');

    const head = page.locator('#config-bm-list .config-bm-group-head .config-bm-group-label');
    await expect(head).toHaveCount(1);
    await expect(head).toContainText('Unsorted');
    await expect(head).not.toContainText('999999');

    await page.locator('#config-bm-list .config-bm-title', { hasText: 'Label me' }).click();
    const where = sidePanel(page).locator('.config-bm-panel-where');
    await expect(where).toHaveText('Unsorted');
});
