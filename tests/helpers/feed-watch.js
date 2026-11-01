// @ts-check
const http = require('http');
const { expect } = require('../fixtures');
const { WRITE_TOKEN, markWhatsNewSeen, dismissBlockingOverlays, dismissOnboardingIfPresent } = require('../e2e-helpers');

const headers = { 'X-NextDash-Token': WRITE_TOKEN };

// A 1x1 PNG, so an item can have a picture that really comes from the stub.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

/**
 * A small site the tests can change: a page that advertises two feeds (Posts as
 * RSS, Comments as Atom) and serves both. `posts` is the list of entries of the
 * Posts feed; `add()` appends a new, newer one.
 */
async function startStubSite() {
    const posts = [{ id: 'p0', title: 'First post', day: 1, html: '<p>First text</p>' }];
    let base = '';
    let broken = false;
    const rss = () => `<?xml version="1.0"?><rss version="2.0"><channel><title>Stub Posts</title>${
        posts.slice().reverse().map((p) => `<item><title>${p.title}</title><link>${base}/${p.id}</link><guid>${p.id}</guid>`
            + `<pubDate>${new Date(Date.UTC(2024, 0, p.day, 10)).toUTCString()}</pubDate>`
            + `<description><![CDATA[${p.image ? `<img src="${base}/hero.png">` : ''}${p.html}]]></description></item>`).join('')
    }</channel></rss>`;
    const server = http.createServer((req, res) => {
        if (req.url === '/feed/' && broken) { res.writeHead(404); res.end('gone'); return; }
        if (req.url === '/feed/') { res.writeHead(200, { 'Content-Type': 'application/rss+xml' }); res.end(rss()); return; }
        if (req.url === '/comments/feed/') {
            res.writeHead(200, { 'Content-Type': 'application/atom+xml' });
            res.end('<feed xmlns="http://www.w3.org/2005/Atom"><title>Stub Comments</title><entry><title>c</title><id>c1</id>'
                + `<link rel="alternate" href="${base}/c1"/><updated>2024-01-01T10:00:00Z</updated></entry></feed>`);
            return;
        }
        if (req.url === '/hero.png') { res.writeHead(200, { 'Content-Type': 'image/png' }); res.end(PNG); return; }
        if (req.url === '/not-a-feed') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<html><body>hello</body></html>'); return; }
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<!doctype html><title>Stub</title><link rel="alternate" type="application/rss+xml" title="Posts" href="/feed/">'
            + '<link rel="alternate" type="application/atom+xml" title="Comments" href="/comments/feed/"><p>Stub site</p>');
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(undefined)));
    const address = server.address();
    base = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
    return {
        url: `${base}/`,
        base,
        add(title, { image = false, html = `<p>${title} text</p>` } = {}) {
            const day = 2 + posts.length;
            posts.push({ id: `p${posts.length}`, title, day, html, image });
        },
        breakFeed(value = true) { broken = value; },
        close: () => new Promise((resolve) => server.close(() => resolve(undefined))),
    };
}

/** An install whose first page holds one bookmark, to the stub site. */
async function installWithBookmark(request, site, name = 'Stub Blog') {
    expect((await request.post('/api/reset', { data: { confirm: true }, headers })).ok()).toBe(true);
    expect((await request.post('/api/settings', {
        data: { allowLocalBookmarks: true, onboardingCompleted: true, enableHealthReviewNotice: false },
        headers,
    })).ok()).toBe(true);
    const pages = await (await request.get('/api/pages')).json();
    const pid = pages[0].id;
    const cats = await (await request.get(`/api/categories?page=${pid}`)).json();
    const category = cats[0]?.id || 'cat';
    expect((await request.post(`/api/bookmarks?page=${pid}`, {
        data: [{ name, url: site.url, category }], headers,
    })).ok()).toBe(true);
    return { pid, name, key: site.url.replace(/\/$/, '') };
}

async function openDashboard(page) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
}

const row = (page, text) => page.locator('#dashboard-layout .bookmark-link:not([data-category-id^="__smart"])', { hasText: text }).first();

/** Right-click the row and choose Watch this feed…, the way a user does. */
async function openPicker(page, name) {
    await row(page, name).click({ button: 'right' });
    await page.getByRole('menuitem', { name: /Watch this feed|Watching feed/ }).click();
    await expect(page.locator('[data-feed-watch-picker]')).toBeVisible();
}

module.exports = { headers, startStubSite, installWithBookmark, openDashboard, openPicker, row, PNG };

/** The key the server uses for a bookmark URL, asked of the page itself. */
async function keyOf(page, url) {
    return page.evaluate((u) => window.BookmarkUrlUtils.canonicalBookmarkURLKey(u), url);
}

/** One watched bookmark with news, as GET /api/feeds/watch would answer it. */
function watchPayload(key, items, { feedTitle = 'Stub Posts', newAt = Date.now() } = {}) {
    return {
        limit: 100,
        total: 1,
        watches: {
            [key]: {
                newCount: items.length,
                newAt,
                newest: items[0] || null,
                feeds: [{ feedUrl: 'http://127.0.0.1:1/feed/', title: feedTitle, intervalMinutes: 60, checkedAt: newAt }],
            },
        },
    };
}

function newsItem(n, extra = {}) {
    return {
        id: `n${n}`,
        title: `Headline ${n}`,
        link: `http://127.0.0.1:1/n${n}`,
        summary: `<p>Lead <b>${n}</b> text</p>`,
        publishedAt: Date.now() - n * 3600e3,
        foundAt: Date.now() - n * 1000,
        ...extra,
    };
}

/** Answer the watch routes with fixed data; returns a setter to change it. */
async function stubWatch(page, state) {
    await page.route('**/api/feeds/watch', (route) => {
        if (route.request().method() !== 'GET') return route.continue();
        return route.fulfill({ contentType: 'application/json', body: JSON.stringify(state.list) });
    });
    await page.route('**/api/feeds/watch/items**', (route) => route.fulfill({
        contentType: 'application/json', body: JSON.stringify({ items: state.items || [] }),
    }));
}

/** A site with a page and no feed at all, for the bookmark that has nothing to follow. */
async function startFeedlessSite() {
    const server = http.createServer((req, res) => {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<!doctype html><title>Plain</title><p>No feed here</p>');
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(undefined)));
    const address = server.address();
    const base = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
    return { url: `${base}/`, base, close: () => new Promise((resolve) => server.close(() => resolve(undefined))) };
}

/** An install whose first page holds one bookmark per site, all in one category. */
async function installWithBookmarks(request, sites) {
    expect((await request.post('/api/reset', { data: { confirm: true }, headers })).ok()).toBe(true);
    expect((await request.post('/api/settings', {
        data: { allowLocalBookmarks: true, onboardingCompleted: true, enableHealthReviewNotice: false },
        headers,
    })).ok()).toBe(true);
    const pages = await (await request.get('/api/pages')).json();
    const pid = pages[0].id;
    const cats = await (await request.get(`/api/categories?page=${pid}`)).json();
    const category = cats[0]?.id || 'cat';
    expect((await request.post(`/api/bookmarks?page=${pid}`, {
        data: sites.map((s) => ({ name: s.name, url: s.site.url, category })), headers,
    })).ok()).toBe(true);
    return { pid, category };
}

module.exports.startFeedlessSite = startFeedlessSite;
module.exports.installWithBookmarks = installWithBookmarks;
module.exports.keyOf = keyOf;
module.exports.watchPayload = watchPayload;
module.exports.newsItem = newsItem;
module.exports.stubWatch = stubWatch;
