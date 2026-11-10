// @ts-check
const { test, expect } = require('./fixtures');
const { startStubSite, installWithBookmark, openDashboard, row, headers } = require('./helpers/feed-watch');

/**
 * The combined paper: one News window for every watched site, a section per
 * site, with read state per item. Nothing is stubbed on nextDash's side; two
 * stub sites publish, the server polls, and the reader reads. Site A publishes
 * three items in the first round, Site B two in the second, so Site B has the
 * newest unread item and comes first.
 */
let siteA;
let siteB;
test.beforeEach(async ({ request }) => {
    siteA = await startStubSite();
    siteB = await startStubSite();
    const { pid } = await installWithBookmark(request, siteA, 'Site A');
    const existing = await (await request.get(`/api/bookmarks?page=${pid}`)).json();
    const cats = await (await request.get(`/api/categories?page=${pid}`)).json();
    expect((await request.post(`/api/bookmarks?page=${pid}`, {
        data: [...existing, { name: 'Site B', url: siteB.url, category: cats[0].id }], headers,
    })).ok()).toBe(true);
    for (const site of [siteA, siteB]) {
        expect((await request.post('/api/feeds/watch', {
            headers, data: { bookmarkUrl: site.url, feeds: [{ feedUrl: `${site.base}/feed/`, intervalMinutes: 1440 }] },
        })).ok()).toBe(true);
    }
    siteA.add('A one');
    siteA.add('A two');
    siteA.add('A three');
    expect((await request.post('/api/feeds/watch/poll', { headers })).ok()).toBe(true);
    siteB.add('B one');
    siteB.add('B two');
    expect((await request.post('/api/feeds/watch/poll', { headers })).ok()).toBe(true);
});
test.afterEach(async () => {
    await siteA.close();
    await siteB.close();
});

const bellRow = (page) => page.locator('.notification-bell-row[data-bell-id="feed-watch"]');
async function openBellRow(page) {
    await page.evaluate(() => window.NotificationBell.refreshAll());
    await page.evaluate(() => window.NotificationBell.open());
    await bellRow(page).waitFor({ state: 'visible' });
}
const modal = (page) => page.locator('#app-modal .modal.feed-news-modal');
const newsButton = (page) => page.locator('#feed-news-btn');
const section = (page, name) => modal(page).locator('.feed-news-section', { has: page.locator('.feed-news-section-name', { hasText: name }) });
const item = (page, title) => modal(page).locator('.feed-news-item', { hasText: title });

/** The stored unread count per site, as the server tells it. */
async function newCounts(request) {
    const list = await (await request.get('/api/feeds/watch')).json();
    const out = {};
    Object.values(list.watches).forEach((w) => { out[w.feeds[0].feedUrl === `${siteA.base}/feed/` ? 'A' : 'B'] = w.newCount; });
    return out;
}

async function expectTwoSections(page) {
    await expect(modal(page)).toBeVisible();
    await expect(modal(page).locator('.feed-news-section-name')).toHaveText(['Site B', 'Site A']);
    await expect(section(page, 'Site B').locator('.feed-news-entry-title')).toHaveText(['B two', 'B one']);
    await expect(section(page, 'Site A').locator('.feed-news-entry-title')).toHaveText(['A three', 'A two', 'A one']);
    await expect(section(page, 'Site B').locator('.feed-news-section-count')).toHaveText('2 unread');
    await expect(section(page, 'Site A').locator('.feed-news-section-count')).toHaveText('3 unread');
    await expect(modal(page).locator('.feed-news-head .feed-news-chip')).toHaveText('5 unread');
}

/** What switching to another tab and back does, as far as the page can tell. */
async function fakeVisibility(page) {
    await page.evaluate(() => {
        let state = 'visible';
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => state === 'hidden' });
        window.__leaveAndReturn = () => {
            state = 'hidden';
            document.dispatchEvent(new Event('visibilitychange'));
            state = 'visible';
            document.dispatchEvent(new Event('visibilitychange'));
        };
    });
}

test('the News button opens one paper with a section per site, newest site first', async ({ page }) => {
    await openDashboard(page);
    await expect(newsButton(page)).toBeVisible();
    await expect(newsButton(page)).toHaveText('5');
    await newsButton(page).click();
    await expectTwoSections(page);
    await expect(modal(page).locator('[data-feed-news-mark-all]')).toBeVisible();
    // Opened by hand: no clock, no bar.
    await expect(modal(page).locator('.feed-news-bar')).toHaveCount(0);
    expect(await page.evaluate(() => window.ScrollLock.isLocked())).toBe(true);

    // An article, the Index button back to the paper, then Esc closes at once, from an article too.
    await item(page, 'A two').locator('.feed-news-entry').click();
    await expect(modal(page).locator('.feed-news-title')).toHaveText('A two');
    await modal(page).locator('[data-feed-news-index]').click();
    await expect(modal(page).locator('.feed-news-section-name')).toHaveCount(2);
    await item(page, 'A two').locator('.feed-news-entry').click();
    await page.keyboard.press('Escape');
    await expect(modal(page)).toBeHidden();
    await expect.poll(() => page.evaluate(() => window.ScrollLock.isLocked())).toBe(false);
});

test('the bell row Read opens the same paper', async ({ page }) => {
    await openDashboard(page);
    await openBellRow(page);
    await expect(bellRow(page)).toContainText('watched feeds');
    await bellRow(page).getByRole('button', { name: 'Read', exact: true }).click();
    await expectTwoSections(page);
});

test('Open reader on the hover card shows only that site', async ({ page }) => {
    await openDashboard(page);
    await row(page, 'Site A').hover();
    await page.locator('#bookmark-preview-card').getByRole('button', { name: 'Open reader' }).click();
    await expect(modal(page)).toBeVisible();
    await expect(modal(page).locator('.feed-news-section-name')).toHaveText(['Site A']);
    await expect(modal(page).locator('.feed-news-section:not(.is-earlier) .feed-news-entry-title')).toHaveText(['A three', 'A two', 'A one']);
    // One site's paper marks that site read, not everything.
    await expect(modal(page).locator('[data-feed-news-mark-all]')).toHaveCount(0);
    await expect(section(page, 'Site A').locator('[data-feed-news-mark-site]')).toBeVisible();
});

test('opening an article marks only that item read', async ({ page, request }) => {
    await openDashboard(page);
    await expect.poll(() => page.title()).toMatch(/^\(5\) /);
    await newsButton(page).click();
    await item(page, 'A two').locator('.feed-news-entry').click();
    await expect(modal(page).locator('.feed-news-title')).toHaveText('A two');
    await expect.poll(() => newCounts(request)).toEqual({ A: 2, B: 2 });
    await expect(row(page, 'Site A').locator('.bookmark-news-badge')).toHaveText('2');
    await expect.poll(() => page.title()).toMatch(/^\(4\) /);

    await modal(page).locator('[data-feed-news-index]').click();
    await expect(item(page, 'A two')).toHaveClass(/is-read/);
    await expect(item(page, 'A three')).toHaveClass(/is-unread/);
    await expect(item(page, 'A one')).toHaveClass(/is-unread/);
    await expect(section(page, 'Site A').locator('.feed-news-section-count')).toHaveText('2 unread');
    await expect(newsButton(page)).toHaveText('4');
});

test('an item toggles read and unread, Mark site read and Mark all read clear the rest', async ({ page, request }) => {
    await openDashboard(page);
    await newsButton(page).click();
    await expectTwoSections(page);

    // The toggle shows on hover; read, then unread again.
    await item(page, 'B one').hover();
    await item(page, 'B one').getByRole('button', { name: 'Mark read' }).click();
    await expect(item(page, 'B one')).toHaveClass(/is-read/);
    await expect(section(page, 'Site B').locator('.feed-news-section-count')).toHaveText('1 unread');
    await expect.poll(() => newCounts(request)).toEqual({ A: 3, B: 1 });
    await item(page, 'B one').getByRole('button', { name: 'Mark unread' }).click();
    await expect(item(page, 'B one')).toHaveClass(/is-unread/);
    await expect.poll(() => newCounts(request)).toEqual({ A: 3, B: 2 });
    // The order of the sections stays put while marking.
    await expect(modal(page).locator('.feed-news-section-name')).toHaveText(['Site B', 'Site A']);

    await section(page, 'Site A').getByRole('button', { name: 'Mark site read' }).click();
    await expect(section(page, 'Site A').locator('.feed-news-item.is-read')).toHaveCount(3);
    await expect(section(page, 'Site A').locator('.feed-news-section-count')).toHaveCount(0);
    await expect.poll(() => newCounts(request)).toEqual({ A: 0, B: 2 });
    await expect(newsButton(page)).toHaveText('2');

    await modal(page).getByRole('button', { name: 'Mark all read' }).click();
    await expect(modal(page).locator('.feed-news-head .feed-news-chip')).toHaveText('0 unread');
    await expect(modal(page).locator('.feed-news-empty')).toHaveText('Nothing new from the feeds you watch');
    await expect(modal(page).locator('.feed-news-item.is-unread')).toHaveCount(0);
    await expect.poll(() => newCounts(request)).toEqual({ A: 0, B: 0 });
    await expect(newsButton(page)).toHaveText('');
    await expect.poll(() => page.title()).not.toMatch(/^\(\d+\) /);
});

const allowOpenOnReturn = (request, on = true) => request.post('/api/settings', { headers, data: { feedWatchOpenOnReturn: on } });

test('returning to the tab opens nothing by itself unless the setting is on', async ({ page }) => {
    await openDashboard(page);
    await expect.poll(() => page.title()).toMatch(/^\(5\) /);
    await fakeVisibility(page);
    await page.evaluate(() => window.__leaveAndReturn());
    // Nothing should open: a fixed wait, so a late open would show up before the check.
    await page.waitForTimeout(600);
    await expect(modal(page)).toHaveCount(0);
});

test('returning to the tab opens the paper once, but not after it was opened by hand', async ({ page, request }) => {
    await allowOpenOnReturn(request);
    await openDashboard(page);
    await expect.poll(() => page.title()).toMatch(/^\(5\) /);
    await fakeVisibility(page);
    await page.evaluate(() => window.__leaveAndReturn());
    await expectTwoSections(page);
    // Opened by the window, so it is on its clock.
    await expect(modal(page).locator('.feed-news-bar')).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(modal(page)).toBeHidden();

    // Opened by hand now: the next return leaves it closed.
    await newsButton(page).click();
    await expect(modal(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(modal(page)).toBeHidden();
    await page.evaluate(() => window.__leaveAndReturn());
    // Nothing should open: a fixed wait, so a late open would show up before the check.
    await page.waitForTimeout(500);
    await expect(modal(page)).toBeHidden();
});

test('returning to the tab leaves the paper closed when only muted feeds have news', async ({ page, request }) => {
    await allowOpenOnReturn(request);
    for (const site of [siteA, siteB]) {
        expect((await request.post('/api/feeds/watch/feed', {
            headers, data: { bookmarkUrl: site.url, feedUrl: `${site.base}/feed/`, muted: true },
        })).ok()).toBe(true);
    }
    await openDashboard(page);
    // Muted feeds still count in the tab title, but nothing opens by itself.
    await expect.poll(() => page.title()).toMatch(/^\(5\) /);
    await fakeVisibility(page);
    await page.evaluate(() => window.__leaveAndReturn());
    // Nothing should open: a fixed wait, so a late open would show up before the check.
    await page.waitForTimeout(500);
    await expect(modal(page)).toHaveCount(0);
});

test('returning to the tab does not cover another window', async ({ page, request }) => {
    await allowOpenOnReturn(request);
    await openDashboard(page);
    await expect.poll(() => page.title()).toMatch(/^\(5\) /);
    await fakeVisibility(page);
    // The keyboard cheat sheet, opened the way a reader does.
    await page.locator('#help-button').click();
    await expect(page.locator('#app-modal.show .modal')).toBeVisible();
    await page.evaluate(() => window.__leaveAndReturn());
    // Nothing should open over the other window: a fixed wait, so a late open would show up before the check.
    await page.waitForTimeout(500);
    await expect(modal(page)).toHaveCount(0);
});

test('on a phone the sections stack, the controls are 44 px and nothing runs off the side', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await openDashboard(page);
    // No News button on a phone, and no bell under 768 px: the paper opens through the
    // call the bell row's Read button makes.
    await expect(newsButton(page)).toBeHidden();
    await page.evaluate(() => window.FeedWatchNews.open());
    await expectTwoSections(page);
    const box = async (locator) => /** @type {{x:number,y:number,width:number,height:number}} */ (await locator.boundingBox());
    const toggle = await box(item(page, 'B one').locator('.feed-news-toggle'));
    expect(toggle.width).toBeGreaterThanOrEqual(43.9);
    expect(toggle.height).toBeGreaterThanOrEqual(43.9);
    const markSite = await box(section(page, 'Site A').locator('[data-feed-news-mark-site]'));
    expect(markSite.height).toBeGreaterThanOrEqual(43.9);
    const markAll = await box(modal(page).locator('[data-feed-news-mark-all]'));
    expect(markAll.height).toBeGreaterThanOrEqual(43.9);
    // Stacked: Site A's section starts below Site B's.
    const b = await box(section(page, 'Site B'));
    const a = await box(section(page, 'Site A'));
    expect(a.y).toBeGreaterThanOrEqual(b.y + b.height - 1);
    const panel = await box(modal(page));
    expect(panel.x).toBeGreaterThanOrEqual(0);
    expect(panel.x + panel.width).toBeLessThanOrEqual(375);
    expect(await modal(page).evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
});

test.describe('on a phone', () => {
    test.use({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true });

    test('returning to the tab never opens the paper, even with the setting on', async ({ page, request }) => {
        await allowOpenOnReturn(request);
        await openDashboard(page);
        await fakeVisibility(page);
        await page.evaluate(() => window.__leaveAndReturn());
        // Nothing should open: a fixed wait, so a late open would show up before the check.
        await page.waitForTimeout(600);
        await expect(modal(page)).toHaveCount(0);
    });
});
