// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * Fixes from a read-through of search.js and dashboard-inbox.js.
 */

async function dashboard(page) {
    await page.setViewportSize({ width: 1400, height: 1000 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });
}

async function openSearch(page) {
    await page.keyboard.press('Shift+Period');
    await expect(page.locator('#shortcut-search.show')).toBeVisible({ timeout: 10_000 });
    await page.waitForFunction(() => window.dashboardInstance?.searchComponent != null);
}

const query = (page) => page.evaluate(() => window.dashboardInstance.searchComponent.currentQuery);

test.describe('search', () => {
    /*
     * The click had its own copy of the Enter dispatch, with no branch for the
     * mode hint: it fell through to openBookmark(undefined), which closed the
     * panel and threw when the timer read bookmark.url.
     */
    test('clicking the "press / to search names" hint runs the name search', async ({ page }) => {
        await dashboard(page);
        await page.evaluate(async () => {
            const d = window.dashboardInstance;
            const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
            await api('/api/bookmarks/add', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ page: d.currentPageId, bookmark: {
                    name: 'Qwertyprobe notes', url: 'https://qwertyprobe.example/', category: '',
                } }),
            });
            await d.loadAllBookmarks?.();
        });
        await openSearch(page);
        await page.evaluate(() => {
            const sc = window.dashboardInstance.searchComponent;
            sc.settings.enableFuzzySuggestions = false;
            sc.interleaveMode = false;
        });
        await page.keyboard.type('qwertyprobe', { delay: 10 });

        const hint = page.locator('#search-matches .search-match', { hasText: 'Press / to search names' });
        await expect(hint).toBeVisible({ timeout: 10_000 });
        const errors = [];
        page.on('pageerror', (err) => errors.push(err.message));
        await hint.click();

        await expect.poll(() => query(page)).toBe('/qwertyprobe');
        await expect(page.locator('#shortcut-search.show')).toBeVisible();
        // A check that NO error follows the click: give a late throw the time to land.
        await page.waitForTimeout(250);
        expect(errors).toEqual([]);
    });

    /*
     * setScope took one character off the front, so `tag:` travelled as if it
     * had been typed: Shift+Tab from the tags opened finders on `?tag:`.
     */
    test('Shift+Tab from the tags lands on an empty finder line', async ({ page }) => {
        await dashboard(page);
        await openSearch(page);
        await page.evaluate(() => window.dashboardInstance.searchComponent.openInTagMode());
        await expect.poll(() => query(page)).toBe('tag:');

        await page.keyboard.press('Shift+Tab');

        await expect.poll(() => query(page)).toMatch(/^\?/);
        expect(await query(page)).not.toContain('tag:');
    });

    /*
     * The bookmarks heading counted rows: group headings, "N more" and filter
     * completions included, and the results inside a closed group left out.
     */
    test('the bookmarks heading counts results, not rows', async ({ page }) => {
        await dashboard(page);
        await openSearch(page);
        const count = await page.evaluate(() => {
            const sc = window.dashboardInstance.searchComponent;
            sc.currentQuery = 'zzcount';
            const bookmark = (i) => ({ type: 'bookmark', shortcut: '', bookmark: { name: `B${i}`, url: `https://b${i}.example/` } });
            const rows = [
                { type: 'command-group-header', groupId: 'search_strong', count: 4, expanded: true },
                ...[0, 1, 2, 3].map(bookmark),
                { type: 'command-group-header', groupId: 'search_contains', count: 20, expanded: true },
                ...[4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15].map(bookmark),
                { type: 'group-more', groupId: 'search_contains', count: 8 },
                { type: 'command-group-header', groupId: 'search_elsewhere', count: 5, expanded: false },
            ];
            const out = sc._composeScopedSections(rows);
            return out.find((row) => row.type === 'scope-section' && row.scope === 'bookmarks')?.count;
        });
        expect(count).toBe(4 + 20 + 5);
    });

    test('status completions offer untagged and unnoted', async ({ page }) => {
        await dashboard(page);
        await openSearch(page);
        const completions = await page.evaluate(() => window.dashboardInstance.searchComponent
            .getFilterAutocompleteMatches('status:un').map((m) => m.completion.trim()));
        expect(completions).toEqual(expect.arrayContaining(['status:untagged', 'status:unnoted']));
    });

    /*
     * A shortcut that opens as it is typed is not a search, and was filling the
     * recent searches with "gh".
     */
    test('a shortcut that opens as it is typed stays out of the search history', async ({ page, context }) => {
        await dashboard(page);
        await page.evaluate(async () => {
            const d = window.dashboardInstance;
            const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
            await api('/api/bookmarks/add', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ page: d.currentPageId, bookmark: {
                    name: 'Shortcut probe', url: 'https://shortcut-probe.example/', category: '', shortcut: 'qzx',
                } }),
            });
            await d.loadAllBookmarks?.();
        });
        await openSearch(page);
        await page.evaluate(() => {
            const sc = window.dashboardInstance.searchComponent;
            sc.settings.shortcutOpenMode = 'instant';
            sc.settings.openInNewTab = true;
            sc.searchHistory = [];
        });
        await context.route('https://shortcut-probe.example/**', (route) => route.fulfill({ status: 200, body: 'ok' }));
        const popup = context.waitForEvent('page');
        await page.keyboard.type('qzx', { delay: 20 });
        await (await popup).close();

        const history = await page.evaluate(() => window.dashboardInstance.searchComponent.searchHistory);
        expect(history).not.toContain('qzx');
        expect(history).not.toContain('QZX');
    });
});

/* ── inbox ───────────────────────────────────────────────────────────── */

async function openInbox(page, titles = []) {
    await dashboard(page);
    const stamp = Date.now();
    const ids = await page.evaluate(async ({ titles, stamp }) => {
        const d = window.dashboardInstance;
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        await api('/api/settings', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ inboxEnabled: true }),
        });
        d.settings.inboxEnabled = true;
        const made = [];
        for (let i = 0; i < titles.length; i += 1) {
            const res = await api('/api/inbox', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url: `https://review${i}-${stamp}.example/x`, title: titles[i] }),
            });
            made.push((await res.json()).item.id);
        }
        return made;
    }, { titles, stamp });
    await page.locator('#page-nav-inbox-btn').click();
    await expect(page.locator('.inbox-layout')).toBeVisible();
    await page.evaluate(() => window.dashboardInstance.inbox.instance.loadAndRender({ refresh: true }));
    return ids;
}

/** A write from somewhere else: straight to the server, past the view's own bookkeeping. */
const writeElsewhere = (page, body) => page.evaluate(async (payload) => {
    const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
    const res = await api('/api/inbox', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });
    return res.ok;
}, body);

const readAtAfterFetch = (page, id) => page.evaluate(async (itemId) => {
    const inbox = window.dashboardInstance.inbox.instance;
    await inbox.fetchItems();
    return Number(inbox.items.find((item) => item.id === itemId)?.readAt || 0);
}, id);

test.describe('inbox', () => {
    /*
     * Clear filters rendered without going through applyViewChange, so ib_q
     * stayed in the address and a reload put the search back.
     */
    test('Clear filters clears the address as well', async ({ page }) => {
        await openInbox(page, ['Review clear filters']);
        await page.locator('[data-inbox-search]').fill('zzznomatchreview');
        await expect(page.locator('[data-inbox-clear-filters]')).toBeVisible({ timeout: 5_000 });
        await expect.poll(() => page.url()).toContain('ib_q=');

        await page.locator('[data-inbox-clear-filters]').click();

        await expect.poll(() => page.url()).not.toContain('ib_q=');
        await page.reload();
        await page.waitForSelector('.inbox-layout', { timeout: 20_000 });
        await expect(page.locator('[data-inbox-search]')).toHaveValue('');
    });

    /*
     * The unread override had no end: marked unread here and read on another
     * device, the link stayed unread in this tab until a reload.
     */
    test('a read made elsewhere wins over an unread made here earlier', async ({ page }) => {
        const [id] = await openInbox(page, ['Review unread then read']);
        await page.evaluate(async (itemId) => {
            const inbox = window.dashboardInstance.inbox.instance;
            await inbox.markRead(itemId);
            await inbox.markUnread(itemId);
        }, id);
        expect(await writeElsewhere(page, { id, readAt: Date.now() })).toBe(true);

        expect(await readAtAfterFetch(page, id)).toBeGreaterThan(0);
    });

    test('an unread made elsewhere wins over a read made here earlier', async ({ page }) => {
        const [id] = await openInbox(page, ['Review read then unread']);
        await page.evaluate((itemId) => window.dashboardInstance.inbox.instance.markRead(itemId), id);
        expect(await writeElsewhere(page, { id, readAt: 0 })).toBe(true);

        expect(await readAtAfterFetch(page, id)).toBe(0);
    });

    /* The reason the override exists: a list read that left before the write. */
    test('an unread survives a list read that was already on the wire', async ({ page }) => {
        const [id] = await openInbox(page, ['Review unread in flight']);
        await page.evaluate((itemId) => window.dashboardInstance.inbox.instance.markRead(itemId), id);

        let release;
        const held = new Promise((resolve) => { release = resolve; });
        let first = true;
        await page.route('**/api/inbox', async (route) => {
            if (route.request().method() !== 'GET' || !first) return route.fallback();
            first = false;
            const stale = await route.fetch();
            const body = await stale.text();
            await held;
            await route.fulfill({ status: 200, contentType: 'application/json', body });
        });
        await page.evaluate(() => { window.__reviewFetch = window.dashboardInstance.inbox.instance.fetchItems(); });
        await expect.poll(() => first).toBe(false);
        await page.evaluate((itemId) => window.dashboardInstance.inbox.instance.markUnread(itemId), id);
        release();
        const readAt = await page.evaluate(async (itemId) => {
            await window.__reviewFetch;
            return Number(window.dashboardInstance.inbox.instance.items.find((i) => i.id === itemId)?.readAt || 0);
        }, id);
        expect(readAt).toBe(0);
    });

    test('the suggested filter, emptied, does not announce Inbox zero', async ({ page }) => {
        await openInbox(page, ['Review suggested empty']);
        await page.evaluate(() => window.dashboardInstance.inbox.instance
            .applyViewChange({ filter: 'suggested' }, { via: 'test', track: false }));
        await expect(page.locator('.inbox-empty-title')).toHaveText('No tags on offer');
    });

    test('opening a link that is already read sends no read mark', async ({ page }) => {
        const [id] = await openInbox(page, ['Review open read']);
        await page.evaluate((itemId) => window.dashboardInstance.inbox.instance.markRead(itemId), id);
        await page.evaluate(() => { window.open = () => null; });
        const patches = [];
        page.on('request', (req) => {
            if (req.method() === 'PATCH' && req.url().includes('/api/inbox')) patches.push(req.url());
        });

        await page.evaluate((itemId) => {
            const inbox = window.dashboardInstance.inbox.instance;
            inbox.openItem(inbox.items.find((item) => item.id === itemId));
        }, id);
        // A check that NO read mark is sent: give a PATCH the time it would take to go out.
        await page.waitForTimeout(400);
        expect(patches).toEqual([]);
    });

    /*
     * One PATCH per link with the whole tag list overwrote a tag written in
     * between; the batch adds on the server.
     */
    test('applying suggestions adds the tag through the batch', async ({ page }) => {
        const [id] = await openInbox(page, ['Review apply suggestions']);
        const requests = [];
        page.on('request', (req) => {
            if (req.url().includes('/api/inbox')) requests.push(`${req.method()} ${new URL(req.url()).pathname}`);
        });
        // Another tab tags the link after this one loaded it.
        expect(await writeElsewhere(page, { id, tags: ['fromelsewhere'] })).toBe(true);

        await page.evaluate(async (itemId) => {
            const inbox = window.dashboardInstance.inbox.instance;
            const item = inbox.items.find((entry) => entry.id === itemId);
            await inbox.applySuggestions([['reviewtag', [item]]]);
        }, id);

        expect(requests).toContain('POST /api/inbox/batch');
        const tags = await page.evaluate(async (itemId) => {
            const body = await (await fetch('/api/inbox', { cache: 'no-store' })).json();
            return (body.items || []).find((item) => item.id === itemId)?.tags || [];
        }, id);
        expect(tags).toEqual(expect.arrayContaining(['fromelsewhere', 'reviewtag']));
    });
});
