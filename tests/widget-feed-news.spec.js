// @ts-check
const { test, expect } = require('./fixtures');
const { waitForFaviconPrefetch, markWidgetsTutorialSeen } = require('./e2e-helpers');
const { startStubSite, installWithBookmarks, openDashboard, headers } = require('./helpers/feed-watch');

/**
 * The Watch feeds news widget: the sites whose watched feeds have unread items.
 *
 * Nothing is stubbed on nextDash's side. Three stub sites publish and the
 * server polls between them, so the order is real: Site C first (and muted),
 * then Site A with two items, then Site B with one, which makes B the newest
 * news and C the oldest.
 */
let sites;
let pid;
test.beforeEach(async ({ request }) => {
    sites = { A: await startStubSite(), B: await startStubSite(), C: await startStubSite() };
    ({ pid } = await installWithBookmarks(request, [
        { name: 'Site A', site: sites.A }, { name: 'Site B', site: sites.B }, { name: 'Site C', site: sites.C },
    ]));
});
test.afterEach(async () => {
    await Promise.all(Object.values(sites).map((site) => site.close()));
});

async function watch(request, site) {
    expect((await request.post('/api/feeds/watch', {
        headers, data: { bookmarkUrl: site.url, feeds: [{ feedUrl: `${site.base}/feed/`, intervalMinutes: 1440 }] },
    })).ok()).toBe(true);
}

async function poll(request) {
    expect((await request.post('/api/feeds/watch/poll', { headers })).ok()).toBe(true);
}

/** C, then A, then B publish, a poll after each; C is muted. */
async function publishThree(request) {
    for (const site of Object.values(sites)) await watch(request, site);
    sites.C.add('C one');
    await poll(request);
    sites.A.add('A one');
    sites.A.add('A two');
    await poll(request);
    sites.B.add('B one');
    await poll(request);
    expect((await request.post('/api/feeds/watch/feed', {
        headers, data: { bookmarkUrl: sites.C.url, feedUrl: `${sites.C.base}/feed/`, muted: true },
    })).ok()).toBe(true);
}

/** The widget on the first page, written the way the settings panel saves it. */
async function placeWidget(request, config = {}) {
    expect((await request.put(`/api/pages/${pid}/blocks`, {
        headers, data: { widgets: [{ type: 'feed-news', config }] },
    })).ok()).toBe(true);
}

const tile = (page) => page.locator('.dashboard-widget[data-widget-type="feed-news"]');
const rows = (page) => tile(page).locator('.feed-news-widget-row');
const modal = (page) => page.locator('#app-modal .modal.feed-news-modal');

async function openWidgetsConfig(page) {
    await waitForFaviconPrefetch(page);
    await markWidgetsTutorialSeen(page);
    await page.evaluate(async () => { await window.dashboardInstance.config.openConfigView('widgets'); });
    await expect(page.locator('#config-widgets-body')).toBeVisible();
}

/** Pick a layout in the widget's own settings and save, as a reader does. */
async function chooseLayout(page, layout) {
    await openWidgetsConfig(page);
    const toggle = page.locator('[data-widget-settings]').first();
    if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
    const detail = page.locator('.config-widget-detail').first();
    await detail.locator('select[data-widget-setting="layout"]').selectOption(layout);
    const saved = page.waitForResponse((r) => /\/api\/pages\/[^/]+\/blocks/.test(r.url()) && r.request().method() === 'PUT');
    await detail.locator('[data-widget-save]').click();
    expect((await saved).ok()).toBe(true);
    await openDashboard(page);
}

test('added from the catalogue, it lists a row per site, newest news first, the muted one dimmed', async ({ page, request }) => {
    await publishThree(request);
    await openDashboard(page);
    await openWidgetsConfig(page);
    await page.locator('[data-widget-catalogue]').first().click();
    await page.locator('.modal--widget-catalogue [data-widget-option="feed-news"]').first().click();
    await expect(page.locator('.modal--widget-catalogue .config-widget-picker-name')).toHaveText('Watch feeds news');
    await page.locator('.modal--widget-catalogue [data-widget-add="feed-news"]').click();
    await expect(page.locator('.modal--widget-catalogue')).toHaveCount(0);

    await openDashboard(page);
    await expect(tile(page).locator('.feed-news-widget-total')).toHaveText('4 new');
    await expect(rows(page).locator('.feed-news-widget-name')).toHaveText(['Site B', 'Site A', 'Site C']);
    await expect(rows(page).locator('.feed-news-widget-pill')).toHaveText(['1', '2', '1']);
    await expect(rows(page).locator('.feed-news-widget-headline')).toHaveText(['B one', 'A two', 'C one']);
    await expect(rows(page).nth(2)).toHaveClass(/is-muted/);
    await expect(rows(page).nth(2).locator('.feed-news-widget-pill')).toHaveCSS('animation-name', 'none');
    await expect(rows(page).nth(0)).not.toHaveClass(/is-muted/);
});

test('a row opens the paper on that site only', async ({ page, request }) => {
    await publishThree(request);
    await placeWidget(request);
    await openDashboard(page);
    await rows(page).filter({ hasText: 'Site A' }).click();
    await expect(modal(page)).toBeVisible();
    await expect(modal(page).locator('.feed-news-section-name')).toHaveText(['Site A']);
});

test('the keyboard opens a row: Enter on the focused button', async ({ page, request }) => {
    await publishThree(request);
    await placeWidget(request);
    await openDashboard(page);
    await rows(page).filter({ hasText: 'Site B' }).focus();
    await page.keyboard.press('Enter');
    await expect(modal(page).locator('.feed-news-section-name')).toHaveText(['Site B']);
});

test('headlines: chosen in the settings, newest first; a tap opens the article and drops the count', async ({ page, request }) => {
    await publishThree(request);
    await placeWidget(request);
    await openDashboard(page);
    await chooseLayout(page, 'headlines');

    const items = tile(page).locator('.feed-news-widget-item');
    await expect(items.locator('.feed-news-widget-item-title')).toHaveText(['B one', 'A two', 'A one', 'C one']);
    await expect(items.first().locator('.feed-news-widget-meta')).toContainText('Site B · ');
    await expect(items.first().locator('.feed-news-widget-picture')).toHaveCount(1);
    await expect(tile(page).locator('.feed-news-widget-total')).toHaveText('4 new');

    const popup = page.waitForEvent('popup');
    await items.filter({ hasText: 'B one' }).click();
    const article = await popup;
    expect(article.url()).toBe(`${sites.B.base}/p1`);
    await article.close();

    await expect(tile(page).locator('.feed-news-widget-total')).toHaveText('3 new');
    await expect(items.locator('.feed-news-widget-item-title')).toHaveText(['A two', 'A one', 'C one']);
    await expect.poll(async () => {
        const list = await (await request.get('/api/feeds/watch')).json();
        return Object.values(list.watches).reduce((sum, w) => sum + w.newCount, 0);
    }).toBe(3);

    // Read all is the paper, every site: those with unread news first, then
    // Site B, read now, with its earlier entries.
    await tile(page).locator('.feed-news-widget-readall').click();
    await expect(modal(page).locator('.feed-news-section-name')).toHaveText(['Site A', 'Site C', 'Site B']);
});

test('chips: chosen in the settings, one per site with its count; a chip opens the paper on it', async ({ page, request }) => {
    await publishThree(request);
    await placeWidget(request);
    await openDashboard(page);
    await chooseLayout(page, 'chips');

    const chips = tile(page).locator('.feed-news-widget-chip');
    await expect(chips.locator('.feed-news-widget-chip-name')).toHaveText(['Site B', 'Site A', 'Site C']);
    await expect(chips.locator('.feed-news-widget-chip-count')).toHaveText(['1', '2', '1']);
    await expect(tile(page).locator('.feed-news-widget-latest')).toContainText('B one');
    await expect(tile(page).locator('.feed-news-widget-latest')).toContainText('Site B');

    await chips.filter({ hasText: 'Site C' }).click();
    await expect(modal(page).locator('.feed-news-section-name')).toHaveText(['Site C']);
});

test('nothing watched says how to start, with no button', async ({ page, request }) => {
    await placeWidget(request);
    await openDashboard(page);
    await expect(tile(page).locator('.dashboard-widget-empty'))
        .toHaveText('You do not watch any feed yet. Right-click a bookmark and choose Watch this feed…');
    await expect(tile(page).locator('button.feed-news-widget-action')).toHaveCount(0);
});

test('nothing new says so, and still opens the paper', async ({ page, request }) => {
    await watch(request, sites.A);
    await placeWidget(request);
    await openDashboard(page);
    await expect(tile(page).locator('.dashboard-widget-empty')).toHaveText('Nothing new from the feeds you watch');
    await tile(page).getByRole('button', { name: 'Open the paper' }).click();
    await expect(modal(page)).toBeVisible();
});

test('new posts appear without a reload', async ({ page, request }) => {
    await publishThree(request);
    await placeWidget(request);
    await openDashboard(page);
    await expect(rows(page).filter({ hasText: 'Site A' }).locator('.feed-news-widget-pill')).toHaveText('2');
    await page.evaluate(() => { window.__sameDocument = true; });

    sites.A.add('A three');
    await poll(request);
    await page.evaluate(() => window.dashboardInstance.feedWatch.load({ force: true }));

    await expect(rows(page).filter({ hasText: 'Site A' }).locator('.feed-news-widget-pill')).toHaveText('3');
    await expect(rows(page).locator('.feed-news-widget-name')).toHaveText(['Site A', 'Site B', 'Site C']);
    await expect(tile(page).locator('.feed-news-widget-total')).toHaveText('5 new');
    expect(await page.evaluate(() => window.__sameDocument)).toBe(true);
});

test.describe('on a phone', () => {
    test.use({ viewport: { width: 375, height: 812 } });

    for (const layout of ['list', 'headlines', 'chips']) {
        test(`${layout}: no sideways scroll, and every target is 44 px tall`, async ({ page, request }) => {
            await publishThree(request);
            for (const site of Object.values(sites)) {
                site.add(`A long headline that would run well past the edge of a phone screen ${'word '.repeat(12)}`);
            }
            await poll(request);
            await placeWidget(request, { layout });
            await openDashboard(page);
            await tile(page).scrollIntoViewIfNeeded();
            const targets = tile(page).locator('.feed-news-widget-row, .feed-news-widget-item, .feed-news-widget-chip, .feed-news-widget-action');
            await expect(targets.first()).toBeVisible();
            const measured = await page.evaluate(() => {
                const body = document.querySelector('.dashboard-widget[data-widget-type="feed-news"] .dashboard-widget-body');
                const heights = [...body.querySelectorAll('.feed-news-widget-row, .feed-news-widget-item, .feed-news-widget-chip, .feed-news-widget-action')]
                    .map((el) => el.getBoundingClientRect().height);
                return {
                    page: document.documentElement.scrollWidth,
                    body: body.scrollWidth - body.clientWidth,
                    right: Math.max(...[...body.querySelectorAll('*')].map((el) => el.getBoundingClientRect().right)),
                    shortest: Math.min(...heights),
                };
            });
            expect(measured.page).toBeLessThanOrEqual(375);
            expect(measured.body).toBeLessThanOrEqual(0);
            expect(measured.right).toBeLessThanOrEqual(375);
            expect(measured.shortest).toBeGreaterThanOrEqual(44);
        });
    }
});
