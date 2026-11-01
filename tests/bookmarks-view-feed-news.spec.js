// @ts-check
const { test, expect } = require('./fixtures');
const { startStubSite, installWithBookmark, openDashboard, headers } = require('./helpers/feed-watch');

/**
 * The Latest news column of the Bookmarks view: when a watched site's newest
 * item came out and its headline, sortable, and a click on the headline opens
 * the paper on that site. Nothing is stubbed on nextDash's side; the stub
 * sites publish and the server polls. Site A publishes one item, Site B three
 * (newer), Plain is not watched.
 */
let siteA;
let siteB;
let plain;
test.describe.configure({ mode: 'serial' });
test.beforeEach(async ({ request }) => {
    siteA = await startStubSite();
    siteB = await startStubSite();
    plain = await startStubSite();
    const { pid } = await installWithBookmark(request, siteA, 'Site A');
    const existing = await (await request.get(`/api/bookmarks?page=${pid}`)).json();
    const cats = await (await request.get(`/api/categories?page=${pid}`)).json();
    expect((await request.post(`/api/bookmarks?page=${pid}`, {
        data: [...existing, { name: 'Site B', url: siteB.url, category: cats[0].id }, { name: 'Plain', url: plain.url, category: cats[0].id }], headers,
    })).ok()).toBe(true);
    for (const site of [siteA, siteB]) {
        expect((await request.post('/api/feeds/watch', {
            headers, data: { bookmarkUrl: site.url, feeds: [{ feedUrl: `${site.base}/feed/`, intervalMinutes: 1440 }] },
        })).ok()).toBe(true);
    }
    siteA.add('A one');
    siteB.add('B one');
    siteB.add('B two');
    siteB.add('B three');
    expect((await request.post('/api/feeds/watch/poll', { headers })).ok()).toBe(true);
});
test.afterEach(async () => {
    await siteA.close();
    await siteB.close();
    await plain.close();
});

const rows = (page) => page.locator('#config-bm-list .config-bm-row');
const names = (page) => rows(page).locator('.config-bm-title');

async function openView(page) {
    await page.setViewportSize({ width: 1500, height: 950 });
    await openDashboard(page);
    await page.evaluate(() => { window.dashboardInstance.settings.enableSessionTips = false; window.location.hash = '#bookmarks'; });
    await page.waitForSelector('#config-bm-list .config-bm-row', { timeout: 15_000 });
}

test('the column shows when and what, in the accent while unread, empty for an unwatched bookmark', async ({ page }) => {
    await openView(page);
    const cell = (name) => rows(page).filter({ has: page.locator('.config-bm-title', { hasText: name }) }).locator('.config-bm-news');
    await expect(cell('Site B').locator('.config-bm-news-title')).toHaveText('B three');
    await expect(cell('Site A').locator('.config-bm-news-title')).toHaveText('A one');
    await expect(cell('Site B')).toHaveClass(/is-unread/);
    await expect(cell('Site B').locator('.config-bm-news-when')).not.toHaveText('');
    await expect(cell('Plain')).toHaveText('');
    await expect(page.locator('[data-bm-colhead] [data-bm-sort-head="news"]')).toHaveText('Latest news');
});

test('sorting by Latest news lists the newest publish first and unwatched bookmarks last', async ({ page }) => {
    await openView(page);
    await expect(names(page)).toHaveText(['Site A', 'Site B', 'Plain']);
    await page.locator('[data-bm-colhead] [data-bm-sort-head="news"]').click();
    await expect(names(page)).toHaveText(['Site B', 'Site A', 'Plain']);
    // A second click turns it round.
    await page.locator('[data-bm-colhead] [data-bm-sort-head="news"]').click();
    await expect(names(page).first()).toHaveText('Plain');
});

test('the headline opens the paper on that site alone', async ({ page }) => {
    await openView(page);
    await rows(page).filter({ has: page.locator('.config-bm-title', { hasText: 'Site A' }) }).locator('.config-bm-news-title').click();
    const modal = page.locator('#app-modal .modal.feed-news-modal');
    await expect(modal).toBeVisible();
    await expect(modal.locator('.feed-news-section-name')).toHaveText(['Site A']);
    // The click opened the paper, not the row's side panel.
    await expect(page.locator('#config-bm-list .config-bm-row.is-checked')).toHaveCount(0);
});
