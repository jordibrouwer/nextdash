// @ts-check
const { test, expect } = require('./fixtures');
const { WRITE_TOKEN } = require('./e2e-helpers');
const { startStubSite, installWithBookmark, openDashboard, row, keyOf, watchPayload, newsItem, stubWatch } = require('./helpers/feed-watch');

/**
 * The signals a row with news gives that do not hang on one colour: a stripe at
 * the start edge, a bold name, the newest headline under it, a count badge with
 * a ring, and a dot on the tab of another page. The watch routes are stubbed.
 */
let site;
test.beforeEach(async ({ request }) => {
    site = await startStubSite();
    await installWithBookmark(request, site);
});
test.afterEach(async () => { await site.close(); });

const link = (page) => row(page, 'Stub Blog');

async function withNews(page, items, extra = {}) {
    await page.goto('/');
    const key = await keyOf(page, site.url);
    const state = { list: watchPayload(key, items), items };
    Object.assign(state.list.watches[key], extra);
    await stubWatch(page, state);
    return { key, state };
}

/** Relative luminance contrast of two computed rgb() strings. */
function contrast(a, b) {
    const lum = (css) => {
        const [r, g, bl] = (css.match(/[\d.]+/g) || []).slice(0, 3).map(Number).map((v) => {
            const c = v / 255;
            return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
    };
    const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
}

for (const viewport of [{ width: 1500, height: 950 }, { width: 375, height: 812 }]) {
    test(`a row with news has stripe, bold name and a ringed badge at ${viewport.width}px`, async ({ page }) => {
        await page.setViewportSize(viewport);
        await withNews(page, [newsItem(1), newsItem(2)]);
        await openDashboard(page);
        const r = link(page);
        await expect(r.locator('.bookmark-news-badge')).toBeVisible();
        const stripe = await r.evaluate((el) => {
            const cs = getComputedStyle(el, '::before');
            return { content: cs.content, width: cs.width, bg: cs.backgroundColor };
        });
        expect(stripe.content).not.toBe('none');
        expect(stripe.width).toBe('3px');
        expect(stripe.bg).not.toBe('rgba(0, 0, 0, 0)');
        const weight = await r.locator('.bookmark-text').evaluate((el) => Number(getComputedStyle(el).fontWeight));
        expect(weight).toBeGreaterThanOrEqual(600);
        const badge = await r.locator('.bookmark-news-badge').evaluate((el) => {
            const cs = getComputedStyle(el);
            return { shadow: cs.boxShadow, color: cs.color, bg: cs.backgroundColor };
        });
        expect(badge.shadow).toMatch(/\b2px\b/);
        expect(contrast(badge.color, badge.bg)).toBeGreaterThanOrEqual(4.5);
        // The line is only shown where there is room: a wide screen.
        const line = r.locator('.bookmark-news-line');
        await expect(line).toHaveText('Headline 1');
        await expect(line).toHaveAttribute('aria-hidden', 'true');
        if (viewport.width > 600) await expect(line).toBeVisible();
        else await expect(line).toBeHidden();
    });
}

test('compact density hides the headline and keeps the row height', async ({ page, request }) => {
    const { headers } = require('./helpers/feed-watch');
    expect((await request.post('/api/settings', { data: { densityMode: 'compact' }, headers })).ok()).toBe(true);
    const { key } = await withNews(page, [newsItem(1)]);
    await openDashboard(page);
    const r = link(page);
    await expect(r.locator('.bookmark-news-badge')).toBeVisible();
    await expect(page.locator('body')).toHaveAttribute('data-density-mode', 'compact');
    await expect(r.locator('.bookmark-news-line')).toBeHidden();
    const stripe = await r.evaluate((el) => getComputedStyle(el, '::before').width);
    expect(stripe).toBe('3px');
    expect(await r.locator('.bookmark-text').evaluate((el) => Number(getComputedStyle(el).fontWeight))).toBeGreaterThanOrEqual(600);
    const withNewsHeight = (await r.boundingBox()).height;
    // The same row once the news is read.
    await page.evaluate((k) => window.dashboardInstance.feedWatch.markSeen({ url: k }), key);
    await expect(r.locator('.bookmark-news-badge')).toHaveCount(0);
    expect((await r.boundingBox()).height).toBeCloseTo(withNewsHeight, 0);
});

test('a muted feed neither pulses nor takes the accent stripe', async ({ page }) => {
    await withNews(page, [newsItem(1)], { muted: true });
    await openDashboard(page);
    const r = link(page);
    await expect(r.locator('.bookmark-news-badge.is-muted')).toBeVisible();
    expect(await r.locator('.bookmark-news-badge').evaluate((el) => getComputedStyle(el).animationName)).toBe('none');
    const stripe = await r.evaluate((el) => {
        const cs = getComputedStyle(el, '::before');
        return { width: cs.width, bg: cs.backgroundColor };
    });
    expect(stripe.width).toBe('1px');
    const accent = await page.evaluate(() => {
        const probe = document.createElement('i');
        probe.style.color = 'var(--accent-primary)';
        document.body.appendChild(probe);
        const c = getComputedStyle(probe).color;
        probe.remove();
        return c;
    });
    expect(stripe.bg).not.toBe(accent);
});

test('the pulse plays three times and then rests', async ({ page }) => {
    await withNews(page, [newsItem(1)]);
    await openDashboard(page);
    const badge = link(page).locator('.bookmark-news-badge');
    await expect(badge).toBeVisible();
    expect(await badge.evaluate((el) => getComputedStyle(el).animationIterationCount)).toBe('3');
});

test('another page\'s tab gets a dot while it holds unread news, and loses it once read', async ({ page, request }) => {
    const headers = { 'X-NextDash-Token': WRITE_TOKEN };
    const pages = await (await request.get('/api/pages')).json();
    const second = { id: Math.max(...pages.map((p) => Number(p.id))) + 1, name: 'Second' };
    expect((await request.post('/api/pages', { data: [...pages, second], headers })).ok()).toBe(true);
    const cats = await (await request.get(`/api/categories?page=${second.id}`)).json();
    const otherUrl = `${site.base}/other/`;
    expect((await request.post(`/api/bookmarks?page=${second.id}`, {
        data: [{ name: 'Other Blog', url: otherUrl, category: cats[0]?.id || 'cat' }], headers,
    })).ok()).toBe(true);

    await page.goto('/');
    const key = await keyOf(page, otherUrl);
    const state = { list: watchPayload(key, [newsItem(1)]), items: [newsItem(1)] };
    await stubWatch(page, state);
    // Opening a bookmark must not leave the dashboard.
    await page.evaluate(() => window.addEventListener('click', (e) => {
        if (e.target?.closest?.('a.bookmark-open')) e.preventDefault();
    }));
    await openDashboard(page);
    const tabs = page.locator('#page-navigation .page-nav-btn[role="tab"]');
    await expect(tabs).toHaveCount(2);
    await expect(tabs.nth(1).locator('.page-tab-news-dot')).toHaveCount(1);
    await expect(tabs.nth(1).locator('.page-tab-news-dot')).toHaveText('News');
    await expect(tabs.nth(0).locator('.page-tab-news-dot')).toHaveCount(0);
    const dot = await tabs.nth(1).locator('.page-tab-news-dot').evaluate((el) => {
        const cs = getComputedStyle(el);
        return { w: cs.width, shadow: cs.boxShadow };
    });
    expect(dot.w).toBe('6px');
    expect(dot.shadow).toMatch(/\b2px\b/);

    // On that page the dot goes (it is the current page); reading the row keeps it gone.
    await tabs.nth(1).click();
    await expect(row(page, 'Other Blog').locator('.bookmark-news-badge')).toBeVisible();
    await expect(page.locator('.page-tab-news-dot')).toHaveCount(0);
    await row(page, 'Other Blog').locator('a.bookmark-open').click();
    await expect(row(page, 'Other Blog').locator('.bookmark-news-badge')).toHaveCount(0);
    await tabs.nth(0).click();
    await expect(page.locator('.page-tab-news-dot')).toHaveCount(0);
});

test('a muted feed on another page puts no dot on its tab', async ({ page, request }) => {
    const headers = { 'X-NextDash-Token': WRITE_TOKEN };
    const pages = await (await request.get('/api/pages')).json();
    const second = { id: Math.max(...pages.map((p) => Number(p.id))) + 1, name: 'Second' };
    await request.post('/api/pages', { data: [...pages, second], headers });
    const cats = await (await request.get(`/api/categories?page=${second.id}`)).json();
    const otherUrl = `${site.base}/other/`;
    await request.post(`/api/bookmarks?page=${second.id}`, {
        data: [{ name: 'Other Blog', url: otherUrl, category: cats[0]?.id || 'cat' }], headers,
    });
    await page.goto('/');
    const key = await keyOf(page, otherUrl);
    const list = watchPayload(key, [newsItem(1)]);
    list.watches[key].muted = true;
    await stubWatch(page, { list, items: [newsItem(1)] });
    await openDashboard(page);
    await expect(page.locator('#page-navigation .page-nav-btn[role="tab"]')).toHaveCount(2);
    await page.waitForTimeout(800);
    await expect(page.locator('.page-tab-news-dot')).toHaveCount(0);
});
