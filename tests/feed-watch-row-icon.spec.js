// @ts-check
const { test, expect } = require('./fixtures');
const { startStubSite, installWithBookmarks, openDashboard, row, keyOf, newsItem, stubWatch, headers } = require('./helpers/feed-watch');

/**
 * A watched bookmark is recognisable by a small feed glyph after its name, also
 * when it has no news. With news the badge takes its place. The watch routes are
 * stubbed so each state of the feed can be set.
 */
let site;
let plain;
test.beforeEach(async ({ request }) => {
    site = await startStubSite();
    plain = await startStubSite();
    await installWithBookmarks(request, [{ name: 'Stub Blog', site }, { name: 'Plain Site', site: plain }]);
});
test.afterEach(async () => { await site.close(); await plain.close(); });

const link = (page) => row(page, 'Stub Blog');
const icon = (page) => link(page).locator('.bookmark-feed-icon');

function feed(extra = {}) {
    return { feedUrl: 'http://127.0.0.1:1/feed/', title: 'Stub Posts', intervalMinutes: 120, checkedAt: Date.now() - 5 * 60000, ...extra };
}

async function watching(page, { feeds = [feed()], entry = {}, items = [] } = {}) {
    await page.goto('/');
    const key = await keyOf(page, site.url);
    const state = {
        list: { limit: 100, total: 1, watches: { [key]: { newCount: items.length, newAt: Date.now(), newest: items[0] || null, feeds, ...entry } } },
        items,
    };
    await stubWatch(page, state);
    await openDashboard(page);
    return { key, state };
}

test('a watched bookmark without news shows the glyph and says how it is watched', async ({ page }) => {
    await watching(page);
    await expect(icon(page)).toHaveCount(1);
    await expect(icon(page)).toHaveClass(/is-ok/);
    const label = await icon(page).getAttribute('aria-label');
    expect(label).toContain('Watching');
    expect(label).toContain('every 2 hours');
    expect(label).toContain('checked 5 min ago');
    await expect(icon(page)).toHaveAttribute('title', label || '');
    await expect(icon(page)).toHaveAttribute('role', 'img');
    // An unwatched bookmark has none.
    await expect(row(page, 'Plain Site').locator('.bookmark-feed-icon')).toHaveCount(0);
});

test('several feeds say so, with the earliest interval and the oldest check', async ({ page }) => {
    await watching(page, { feeds: [feed(), feed({ feedUrl: 'http://127.0.0.1:1/c/', intervalMinutes: 30, checkedAt: Date.now() - 90 * 60000 })] });
    const label = await icon(page).getAttribute('aria-label');
    expect(label).toContain('Watching 2 feeds');
    expect(label).toContain('every 30 minutes');
    expect(label).toContain('checked 2 h ago');
});

test('news takes the glyph\'s place and reading the news brings it back', async ({ page }) => {
    const { key } = await watching(page, { items: [newsItem(1)] });
    await expect(link(page).locator('.bookmark-news-badge')).toBeVisible();
    await expect(icon(page)).toHaveCount(0);
    // Opening the bookmark is what reads the news.
    await page.evaluate((k) => window.dashboardInstance.feedWatch.markOpened({ url: k }), key);
    await expect(link(page).locator('.bookmark-news-badge')).toHaveCount(0);
    await expect(icon(page)).toHaveCount(1);
});

test('a muted watch gets the struck-through glyph', async ({ page }) => {
    await watching(page, { feeds: [feed({ muted: true })], entry: { muted: true } });
    await expect(icon(page)).toHaveClass(/is-muted/);
    await expect(icon(page).locator('.bookmark-feed-icon-strike')).toHaveCount(1);
    expect(await icon(page).getAttribute('aria-label')).toContain('Watching, muted');
});

test('a feed that is failing or stopped gets the warning dot and the reason', async ({ page }) => {
    await watching(page, { feeds: [feed({ retired: true, failures: 5, lastError: 'http-404', lastStatus: 404 })] });
    await expect(icon(page)).toHaveClass(/is-unhealthy/);
    await expect(icon(page).locator('.bookmark-feed-icon-dot')).toBeVisible();
    await expect(icon(page).locator('.bookmark-feed-icon-strike')).toHaveCount(0);
    const label = await icon(page).getAttribute('aria-label');
    expect(label).toContain('Paused');
    expect(label).toContain('Not found (404)');
});

test('a feed with failed checks reads "Not responding"', async ({ page }) => {
    await watching(page, { feeds: [feed({ failures: 2, lastError: 'timeout' })] });
    await expect(icon(page)).toHaveClass(/is-unhealthy/);
    const label = await icon(page).getAttribute('aria-label');
    expect(label).toContain('Not responding');
    expect(label).toContain('Timed out');
});

test('the setting off hides the glyph, and Config switches it without a reload', async ({ page, request }) => {
    await watching(page);
    await expect(icon(page)).toHaveCount(1);
    await page.evaluate(() => { window.__noReload = true; });
    const leave = () => page.evaluate(() => window.dashboardInstance.config.closeConfigView());
    await page.goto('/#config/feed-watch');
    const box = page.locator('[data-behavior-field="showFeedWatchIcon"]');
    await expect(box).toBeChecked();
    await box.uncheck();
    await expect.poll(async () => (await (await request.get('/api/settings')).json()).showFeedWatchIcon).toBe(false);
    await leave();
    await expect(link(page)).toBeVisible();
    await expect(icon(page)).toHaveCount(0);
    await page.goto('/#config/feed-watch');
    await page.locator('[data-behavior-field="showFeedWatchIcon"]').check();
    await leave();
    await expect(icon(page)).toHaveCount(1);
    expect(await page.evaluate(() => window.__noReload)).toBe(true);
});

test('the setting stored as off keeps the glyph away from the start', async ({ page, request }) => {
    expect((await request.post('/api/settings', { data: { showFeedWatchIcon: false }, headers })).ok()).toBe(true);
    await watching(page);
    await expect(link(page)).toBeVisible();
    // Wait until the page knows the bookmark is watched and has drawn again.
    await expect.poll(() => page.evaluate(() => window.dashboardInstance.feedWatch.byKey.size)).toBe(1);
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(undefined)))));
    await expect(icon(page)).toHaveCount(0);
});

test('compact density keeps the row height', async ({ page, request }) => {
    expect((await request.post('/api/settings', { data: { densityMode: 'compact' }, headers })).ok()).toBe(true);
    await watching(page);
    await expect(page.locator('body')).toHaveAttribute('data-density-mode', 'compact');
    await expect(icon(page)).toHaveCount(1);
    const watched = (await link(page).boundingBox())?.height;
    const unwatched = (await row(page, 'Plain Site').boundingBox())?.height;
    expect(watched).toBeCloseTo(unwatched || 0, 0);
});

test('on a phone the glyph is there and the page does not scroll sideways', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await watching(page, { feeds: [feed({ failures: 1, lastError: 'timeout' })] });
    await expect(icon(page)).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
});
