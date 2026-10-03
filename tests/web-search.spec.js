// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');
const http = require('http');

/**
 * Web search from the search panel.
 *
 * The server asks the engine; these tests stand in for a SearXNG instance
 * and check the three promises the feature makes: nothing leaves while you
 * type, Shift+Enter brings the web into the panel, and a query you sent to
 * the web does not also end up in the dashboard's own activity log.
 */

let stub;
let stubUrl = '';
let stubRequests = [];
/** What the stub answers; tests replace it. */
let stubResults = [];
/** How long the stub takes to answer, in ms. */
let stubDelay = 0;
/** Per-category answers; `web` falls back to stubResults. */
let stubInfobox = null;

test.beforeAll(async () => {
    stub = http.createServer((req, res) => {
        stubRequests.push(req.url);
        const u = new URL(req.url, 'http://x');
        const cat = u.searchParams.get('categories');
        const results = cat === 'news' ? [{ url: 'https://news.example/n', title: 'A news item', content: 'news' }] : stubResults;
        const body = JSON.stringify({ results, infoboxes: stubInfobox ? [stubInfobox] : [] });
        setTimeout(() => {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(body);
        }, stubDelay);
    });
    await new Promise((resolve) => stub.listen(0, '127.0.0.1', resolve));
    stubUrl = `http://127.0.0.1:${stub.address().port}`;
});
test.afterAll(async () => { await new Promise((resolve) => stub.close(resolve)); });
test.beforeEach(() => {
    stubRequests = [];
    stubDelay = 0;
    stubInfobox = null;
    stubResults = [
        { url: 'https://first.example/a', title: 'First result', content: 'The first snippet' },
        { url: 'https://second.example/b', title: 'Second result', content: 'The second snippet' },
    ];
});

async function openWithEngine(page, extra = {}) {
    await page.setViewportSize({ width: 1400, height: 900 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.settings != null, null, { timeout: 15_000 });
    await page.evaluate(async ({ url, extra }) => {
        const settings = await (await fetch('/api/settings')).json();
        Object.assign(settings, { webSearchEngine: 'searxng', webSearchSearxngUrl: url }, extra);
        const write = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        await write('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(settings) });
    }, { url: stubUrl, extra });
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });
}

async function typeQuery(page, text) {
    await page.keyboard.press('>');
    await page.waitForTimeout(300);
    await page.keyboard.type(text);
    await page.waitForTimeout(400);
}

test.describe('web search in the search panel', () => {
    test('typing sends nothing; Shift+Enter shows the web', async ({ page }) => {
        await openWithEngine(page);
        const webCalls = [];
        page.on('request', (req) => { if (req.url().includes('/api/web-search?')) webCalls.push(req.url()); });

        await typeQuery(page, 'zzweb query');
        await page.waitForTimeout(800);
        expect(webCalls).toEqual([]);
        expect(stubRequests).toEqual([]);
        await expect(page.locator('#search-matches .search-web-entry')).toContainText('zzweb query');

        await page.keyboard.press('Shift+Enter');
        await expect(page.locator('#search-matches .search-web-result')).toHaveCount(2);
        expect(webCalls).toHaveLength(1);
        await expect(page.locator('#search-matches .search-web-result').first()).toContainText('first.example');
        // Selection lands on the first web result.
        await expect(page.locator('#search-matches .search-web-result').first()).toHaveClass(/keyboard-selected/);
    });

    test('Enter opens the result without a referrer and closes the panel', async ({ page }) => {
        await openWithEngine(page);
        await page.evaluate(() => {
            window.__opened = [];
            window.open = (url, target, features) => { window.__opened.push([url, target, features]); return null; };
        });
        await typeQuery(page, 'zzweb open');
        await page.keyboard.press('Shift+Enter');
        await expect(page.locator('#search-matches .search-web-result')).toHaveCount(2);
        await page.keyboard.press('Enter');
        const opened = await page.evaluate(() => window.__opened);
        expect(opened).toEqual([['https://first.example/a', '_blank', 'noopener,noreferrer']]);
        await expect.poll(() => page.evaluate(() => window.dashboardInstance.searchComponent.searchActive)).toBe(false);
    });

    test('a web search stays out of the activity log; a bookmark search does not', async ({ page }) => {
        await openWithEngine(page, { activityChannels: ['search'] });
        const tracked = [];
        page.on('request', (req) => {
            if (req.url().includes('/api/track-search')) tracked.push(req.postData() || '');
        });
        await page.evaluate(() => { window.open = () => null; });

        await typeQuery(page, 'zzprivate');
        await page.keyboard.press('Shift+Enter');
        await expect(page.locator('#search-matches .search-web-result')).toHaveCount(2);
        await page.keyboard.press('Enter');
        await page.waitForTimeout(500);
        expect(tracked.filter((b) => b.includes('zzprivate'))).toEqual([]);

        // Control: the channel is on, so an ordinary search is logged.
        await typeQuery(page, 'zzordinary');
        await page.keyboard.press('Escape');
        await expect.poll(() => tracked.some((b) => b.includes('zzordinary'))).toBe(true);
    });

    test('no entry row with the engine off', async ({ page }) => {
        await openWithEngine(page, { webSearchEngine: 'off' });
        await typeQuery(page, 'zzweb off');
        await expect(page.locator('#search-matches .search-web-entry')).toHaveCount(0);
    });

    test('tag mode and filter queries are not offered to the web', async ({ page }) => {
        await openWithEngine(page);
        // In the open panel, "/" switches to tag mode: the query becomes "tag:".
        await page.keyboard.press('>');
        await page.waitForTimeout(300);
        await page.keyboard.press('/');
        await page.waitForTimeout(400);
        await expect.poll(() => page.evaluate(() => window.dashboardInstance.searchComponent.currentQuery)).toBe('tag:');
        await expect(page.locator('#search-matches .search-web-entry')).toHaveCount(0);
        await page.keyboard.press('Escape');

        await typeQuery(page, 'zzweb category:');
        await expect(page.locator('#search-matches .search-web-entry')).toHaveCount(0);
        await page.keyboard.press('Shift+Enter');
        await page.waitForTimeout(300);
        expect(stubRequests).toEqual([]);
    });

    test('Enter while the web is loading neither throws nor drops focus', async ({ page }) => {
        stubDelay = 2000;
        await openWithEngine(page);
        const errors = [];
        page.on('pageerror', (err) => errors.push(err.message));
        await page.evaluate(() => {
            window.open = () => null;
            // Whatever a stray Enter could open besides the web.
            window.__strays = [];
            const s = window.dashboardInstance.searchComponent;
            s.openBookmark = (b) => { window.__strays.push(`bookmark:${b?.url}`); };
            const handler = s.commandsComponent?.newCommandHandler;
            if (handler) handler.openModal = () => { window.__strays.push('new-modal'); };
        });
        await typeQuery(page, 'zzweb slow');

        // Walk the selection down to the entry row, the last selectable row.
        const entry = page.locator('#search-matches .search-web-entry');
        for (let i = 0; i < 20; i += 1) {
            if (await entry.evaluate((el) => el.classList.contains('keyboard-selected'))) break;
            await page.keyboard.press('ArrowDown');
        }
        await expect(entry).toHaveClass(/keyboard-selected/);

        await page.keyboard.press('Shift+Enter');
        await expect(page.locator('#search-matches .search-web-loading')).toBeVisible();
        const bodyFocused = await page.evaluate(() => document.activeElement === document.body);
        // Nothing is selected while the answer is on its way.
        expect(await page.evaluate(() => window.dashboardInstance.searchComponent.selectedMatchIndex)).toBe(-1);
        await page.keyboard.press('Enter');
        await page.waitForTimeout(300);
        expect(await page.evaluate(() => window.__strays)).toEqual([]);
        await expect(page.locator('#search-matches .search-web-loading')).toBeVisible();
        expect({ bodyFocused, errors }).toEqual({ bodyFocused: false, errors: [] });
        // The answer selects the first web result.
        await expect(page.locator('#search-matches .search-web-result').first()).toHaveClass(/keyboard-selected/);
    });

    test('a row picked while the web is loading keeps the selection', async ({ page }) => {
        stubDelay = 1500;
        await openWithEngine(page);
        await page.evaluate(async () => {
            const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
            const d = window.dashboardInstance;
            await api('/api/bookmarks/add', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ page: d.currentPageId, bookmark: { name: 'zzpick local', url: 'https://zzpick.example/' } }) });
            await d.loadAllBookmarks();
            window.open = () => null;
        });
        await typeQuery(page, 'zzpick');
        await page.keyboard.press('Shift+Enter');
        await expect(page.locator('#search-matches .search-web-loading')).toBeVisible();
        await page.keyboard.press('ArrowDown');
        const picked = await page.evaluate(() => {
            const s = window.dashboardInstance.searchComponent;
            return s.selectableMatches[s.selectedMatchIndex]?.type || null;
        });
        expect(picked).not.toBeNull();
        expect(picked).not.toMatch(/^web-/);
        await expect(page.locator('#search-matches .search-web-result').first()).toBeVisible();
        // Moved to the first web result, the next Enter opened a web page.
        const after = await page.evaluate(() => {
            const s = window.dashboardInstance.searchComponent;
            return s.selectableMatches[s.selectedMatchIndex]?.type || null;
        });
        expect(after).toBe(picked);
    });

    test('editing the query while the web is loading gives the list its selection back', async ({ page }) => {
        stubDelay = 2000;
        await openWithEngine(page);
        await page.evaluate(() => { window.open = () => null; });
        await typeQuery(page, 'zzweb edit');
        await page.keyboard.press('Shift+Enter');
        await expect(page.locator('#search-matches .search-web-loading')).toBeVisible();
        expect(await page.evaluate(() => window.dashboardInstance.searchComponent.selectedMatchIndex)).toBe(-1);

        // The query changes under the pending search: that search no longer
        // belongs to what the list shows, so Enter must have a row again.
        await page.keyboard.type('x');
        await expect(page.locator('#search-matches .search-web-entry')).toContainText('zzweb editx');
        expect(await page.evaluate(() => window.dashboardInstance.searchComponent.selectedMatchIndex)).toBe(0);
        await expect(page.locator('#search-matches .keyboard-selected')).toHaveCount(1);
    });

    test('an empty answer offers the engine itself', async ({ page }) => {
        stubResults = [];
        await openWithEngine(page);
        await typeQuery(page, 'zznothing');
        await page.keyboard.press('Shift+Enter');
        await expect(page.locator('#search-matches .search-web-fallback')).toBeVisible();
        await expect(page.locator('#search-matches .search-web-fallback')).toContainText('SearXNG');
    });

    test('a result on a bookmarked site says so, and Alt+Enter opens your bookmark', async ({ page }) => {
        await openWithEngine(page);
        const bookmark = await page.evaluate(() =>
            (window.dashboardInstance.searchComponent?.allBookmarks || window.dashboardInstance.allBookmarks || [])
                .find((b) => /^https?:\/\//.test(b.url || '')));
        test.skip(!bookmark, 'the seed data has no bookmark with an http(s) URL');
        const host = new URL(bookmark.url).hostname;
        stubResults = [{ url: `https://${host}/some/page`, title: 'On your site', content: 'x' }];

        await page.evaluate(() => {
            window.__openedBookmarks = [];
            const s = window.dashboardInstance.searchComponent;
            s.openBookmark = (b) => { window.__openedBookmarks.push(b.url); };
        });
        await typeQuery(page, 'zzbadge');
        await page.keyboard.press('Shift+Enter');
        const row = page.locator('#search-matches .search-web-result').first();
        await expect(row.locator('.search-web-badge')).toContainText(bookmark.name || host);
        await page.keyboard.press('Alt+Enter');
        expect(await page.evaluate(() => window.__openedBookmarks)).toEqual([bookmark.url]);
    });

    test('opening a bookmark after a web search leaves the query out of the saved settings', async ({ page }) => {
        await openWithEngine(page);
        const bookmark = await page.evaluate(() =>
            (window.dashboardInstance.searchComponent?.allBookmarks || window.dashboardInstance.allBookmarks || [])
                .find((b) => /^https?:\/\//.test(b.url || '')));
        test.skip(!bookmark, 'the seed data has no bookmark with an http(s) URL');
        const host = new URL(bookmark.url).hostname;
        stubResults = [{ url: `https://${host}/some/page`, title: 'On your site', content: 'x' }];

        // The real openBookmark runs; only the browser's way of leaving the page is stubbed.
        await page.evaluate(() => {
            const click = HTMLAnchorElement.prototype.click;
            window.__clicked = [];
            HTMLAnchorElement.prototype.click = function () { window.__clicked.push(this.href); };
            window.__restoreClick = () => { HTMLAnchorElement.prototype.click = click; };
            window.dashboardInstance.settings.openInNewTab = true;
        });
        const saved = [];
        page.on('request', (req) => {
            if (req.url().endsWith('/api/settings') && req.method() === 'POST') saved.push(req.postData() || '');
        });
        await typeQuery(page, 'zzpickleak');
        await page.keyboard.press('Shift+Enter');
        const row = page.locator('#search-matches .search-web-result').first();
        await expect(row.locator('.search-web-badge')).toBeVisible();
        await page.keyboard.press('Alt+Enter');
        // The bookmark really opened ...
        await expect.poll(() => page.evaluate(() => window.__clicked.length)).toBe(1);
        // ... and the pick memory's write-out (debounced 2 s) had its chance to go.
        await page.waitForTimeout(2600);
        const picks = await page.evaluate(async () => (await (await fetch('/api/settings')).json()).searchPicks || []);
        expect(picks.filter((p) => String(p.q).includes('zzpickleak'))).toEqual([]);
        expect(saved.filter((b) => b.includes('zzpickleak'))).toEqual([]);
        await page.evaluate(() => window.__restoreClick());
    });

    test('tabs switch category, Shift+→ steps them', async ({ page }) => {
        await openWithEngine(page);
        await typeQuery(page, 'zztabs');
        await page.keyboard.press('Shift+Enter');
        const tabs = page.locator('#search-matches .search-web-tab');
        await expect(tabs).toHaveText(['Web', 'News', 'Video', 'IT']);
        await expect(tabs.first()).toHaveAttribute('aria-selected', 'true');

        await page.keyboard.press('Shift+ArrowRight');
        await expect(page.locator('#search-matches .search-web-result')).toContainText(['A news item']);
        await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true');

        await tabs.first().click();
        await expect(page.locator('#search-matches .search-web-result')).toHaveCount(2);
    });

    test('an infobox shows above the results and is not a row', async ({ page }) => {
        stubInfobox = { infobox: 'Example topic', content: 'What it is.', id: 'https://en.wikipedia.org/wiki/Example' };
        await openWithEngine(page);
        await typeQuery(page, 'zzinfo');
        await page.keyboard.press('Shift+Enter');
        const card = page.locator('#search-matches .search-web-infobox');
        await expect(card).toContainText('Example topic');
        await expect(card.locator('a')).toHaveAttribute('rel', 'noopener noreferrer');
        const types = await page.evaluate(() => window.dashboardInstance.searchComponent.selectableMatches.map((m) => m.type));
        expect(types.filter((t) => t === 'web-result')).toHaveLength(2);
        expect(types).not.toContain('web-infobox');
    });

    test('→ opens a preview of the selected result, ← closes it', async ({ page }) => {
        await openWithEngine(page);
        await typeQuery(page, 'zzpreview');
        await page.keyboard.press('Shift+Enter');
        await expect(page.locator('#search-matches .search-web-result')).toHaveCount(2);
        await page.keyboard.press('ArrowRight');
        const preview = page.locator('#search-web-preview');
        await expect(preview).toContainText('The first snippet');
        await expect(preview).toContainText('https://first.example/a');
        await page.keyboard.press('ArrowDown');
        await expect(preview).toContainText('The second snippet');
        await page.keyboard.press('ArrowLeft');
        await expect(preview).toHaveCount(0);
    });

    test('after editing the query, Shift+→ does not ask the web', async ({ page }) => {
        await openWithEngine(page);
        await typeQuery(page, 'zzedit');
        await page.keyboard.press('Shift+Enter');
        await expect(page.locator('#search-matches .search-web-result')).toHaveCount(2);
        const sent = stubRequests.length;

        await page.keyboard.type('x');
        await expect(page.locator('#search-matches .search-web-entry')).toContainText('zzeditx');
        await page.keyboard.press('Shift+ArrowRight');
        await page.waitForTimeout(500);
        expect(stubRequests).toHaveLength(sent);
        await expect(page.locator('#search-matches .search-web-entry')).toBeVisible();
    });
    test('recent web searches come back in the empty panel and can be cleared', async ({ page }) => {
        await openWithEngine(page);
        await typeQuery(page, 'zzremember me');
        await page.keyboard.press('Shift+Enter');
        await expect(page.locator('#search-matches .search-web-result')).toHaveCount(2);
        await page.keyboard.press('Escape');

        await page.keyboard.press('>');
        const header = page.locator('#search-matches', { hasText: 'Recent on the web' });
        await expect(header).toBeVisible();
        await page.getByText('Recent on the web').click(); // closed by default
        await expect(page.locator('#search-matches')).toContainText('zzremember me');

        // The server keeps an answer for a minute, so the stub may not be asked
        // again; what the click must do is send exactly one request of its own.
        const webCalls = [];
        page.on('request', (req) => { if (req.url().includes('/api/web-search?')) webCalls.push(req.url()); });
        await page.getByText('zzremember me').click();
        await expect(page.locator('#search-matches .search-web-result')).toHaveCount(2);
        expect(webCalls.length).toBe(1);
        expect(webCalls[0]).toContain('zzremember');

        await page.keyboard.press('Escape');
        await page.keyboard.press('>');
        await page.getByText('Recent on the web').click();
        await page.getByText('Clear recent web searches').click();
        expect(await page.evaluate(() => localStorage.getItem('nextdash.webSearchRecent'))).toBeNull();
    });

    test('arriving on #search?web= runs the web search', async ({ page }) => {
        await openWithEngine(page);
        stubRequests = [];
        await page.goto('/#search?web=zzarrived');
        await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
        await dismissOnboardingIfPresent(page);
        await dismissBlockingOverlays(page);
        await expect(page.locator('#search-matches .search-web-result')).toHaveCount(2, { timeout: 15_000 });
        expect(stubRequests.some((u) => u.includes('zzarrived'))).toBe(true);
    });

    test('config sets the engine, and Test connection reports the answer', async ({ page }) => {
        await openWithEngine(page, { webSearchEngine: 'off', webSearchSearxngUrl: '' });
        await page.goto('/#config/behavior/search');
        await page.waitForSelector('[data-web-search-panel]', { timeout: 20_000 });

        await page.selectOption('[data-behavior-field="webSearchEngine"]', 'searxng');
        await page.fill('[data-behavior-field="webSearchSearxngUrl"]', stubUrl);
        await page.locator('[data-behavior-field="webSearchSearxngUrl"]').blur();
        await expect.poll(async () => (await page.evaluate(async () => (await fetch('/api/settings')).json())).webSearchEngine).toBe('searxng');

        await page.click('[data-web-search-action="test"]');
        await expect(page.locator('[data-web-search-state]')).toContainText('2');
    });
});
