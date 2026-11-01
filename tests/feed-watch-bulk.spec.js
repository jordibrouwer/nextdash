// @ts-check
const { test, expect } = require('./fixtures');
const {
    startStubSite, startFeedlessSite, installWithBookmarks, openDashboard, row, headers,
} = require('./helpers/feed-watch');

/**
 * Following several bookmarks at once: select them through the right-click
 * menu, press Watch feeds… in the selection bar and read what the server
 * stored. Polling is global on the shared server, so only stored state is asserted.
 */
test.describe.configure({ mode: 'serial' });

let a; let b; let plain;
test.beforeEach(async ({ request }) => {
    a = await startStubSite();
    b = await startStubSite();
    plain = await startFeedlessSite();
    await installWithBookmarks(request, [
        { name: 'Alpha Blog', site: a }, { name: 'Beta Blog', site: b }, { name: 'Plain Page', site: plain },
    ]);
});
test.afterEach(async () => { await a.close(); await b.close(); await plain.close(); });

const popover = (page) => page.locator('#multi-select-feed-watch-popover');

/** Right-click a row and choose Select all in category, as a user does. */
async function selectCategory(page) {
    await row(page, 'Alpha Blog').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Select all in category' }).click();
    await expect(page.locator('.multi-select-toolbar .multi-select-count')).toContainText('3');
}

test('select three, Watch feeds… every 6 hours saves two watches and reports the one without a feed', async ({ page, request }) => {
    await openDashboard(page);
    await selectCategory(page);
    await page.locator('.multi-select-toolbar').getByRole('button', { name: 'Watch feeds…' }).click();
    await expect(popover(page)).toBeVisible();

    await popover(page).locator('[data-feed-watch-bulk-interval]').selectOption('360');
    await popover(page).locator('[data-feed-watch-bulk-run]').click();

    await expect(popover(page).locator('[data-feed-watch-bulk-progress]')).toHaveText('3 of 3 · 1 had no feed');
    await expect(popover(page).locator('[data-feed-watch-bulk-report]')).toContainText('Plain Page · no feed found');
    const list = await (await request.get('/api/feeds/watch')).json();
    const entries = Object.values(list.watches);
    expect(entries).toHaveLength(2);
    for (const entry of entries) {
        // Only the first advertised feed (Posts), never the Comments one.
        expect(entry.feeds).toEqual([expect.objectContaining({ feedUrl: expect.stringMatching(/\/feed\/$/), intervalMinutes: 360 })]);
    }
});

test('Set all to Every day changes the interval of bookmarks that are already watched', async ({ page, request }) => {
    for (const site of [a, b]) {
        const res = await request.post('/api/feeds/watch', {
            data: { bookmarkUrl: site.url, feeds: [{ feedUrl: `${site.base}/feed/`, intervalMinutes: 60 }] }, headers,
        });
        expect(res.ok()).toBe(true);
    }
    await openDashboard(page);
    await selectCategory(page);
    await page.locator('.multi-select-toolbar').getByRole('button', { name: 'Watch feeds…' }).click();
    await popover(page).locator('[data-feed-watch-bulk-interval]').selectOption('1440');
    await popover(page).getByRole('button', { name: 'Set all to Every day' }).click();

    await expect(popover(page).locator('[data-feed-watch-bulk-report]')).toContainText('Alpha Blog · now every day');
    const list = await (await request.get('/api/feeds/watch')).json();
    const entries = Object.values(list.watches);
    expect(entries).toHaveLength(2);
    expect(entries.map((e) => e.feeds[0].intervalMinutes)).toEqual([1440, 1440]);
});

test('Escape closes the Watch feeds popover', async ({ page }) => {
    await openDashboard(page);
    await selectCategory(page);
    await page.locator('.multi-select-toolbar').getByRole('button', { name: 'Watch feeds…' }).click();
    await expect(popover(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(popover(page)).toHaveCount(0);
});
