// @ts-check
const { test, expect } = require('@playwright/test');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * The context menu could act on a bookmark from the wrong page, and pin could lie.
 *
 * resolveRowBookmark falls back to the URL for rows with no page-local index —
 * the shape smart collections render. It searched the current page first and
 * took the first hit, but the same URL legitimately sits on more than one page;
 * Health reports those as duplicates rather than as an error. So a row belonging
 * to another page resolved to the current page's copy, and the menu reached
 * delete holding a different bookmark than the one under the cursor.
 *
 * (Two copies on a *single* page cannot happen: the page write rejects them with
 * 409. Across pages is the reachable case, and the one these tests use.)
 *
 * Separately, all three pin routes flipped `pinned` in memory and fired a write
 * that swallowed every error, so a failed save left the badge claiming a state
 * the file did not have.
 */

const SHARED_URL = 'https://duplicate.example/same';
const HOME_NAME = 'E2E duplicate here';
const AWAY_NAME = 'E2E duplicate elsewhere';
const PROBE_PAGE = 'E2E duplicate page';

async function openDashboard(page) {
    await page.setViewportSize({ width: 1400, height: 900 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });
}

/**
 * Put the same URL on the current page and on a second page, under different
 * names — the shape Health calls a duplicate.
 */
async function addCrossPageDuplicate(page) {
    const ok = await page.evaluate(async ({ url, home, away, pageName }) => {
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        const d = window.dashboardInstance;

        const pagesRes = await api('/api/pages');
        if (!pagesRes.ok) return false;
        const pages = await pagesRes.json();
        let probe = (pages || []).find((p) => String(p?.name || '') === pageName);
        if (!probe) {
            const nextId = Math.max(0, ...(pages || []).map((p) => Number(p.id) || 0)) + 1;
            probe = { id: nextId, name: pageName };
            const write = await api('/api/pages', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify([...(pages || []), probe]),
            });
            if (!write.ok) return false;
        }

        const addTo = async (pageId, name) => {
            const res = await api(`/api/bookmarks?page=${pageId}`);
            if (!res.ok) return false;
            const list = await res.json();
            const kept = (Array.isArray(list) ? list : []).filter((b) => b.url !== url);
            const write = await api(`/api/bookmarks?page=${pageId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify([...kept, { name, url }]),
            });
            return write.ok;
        };

        if (!await addTo(d.currentPageId, home)) return false;
        if (!await addTo(probe.id, away)) return false;
        return true;
    }, { url: SHARED_URL, home: HOME_NAME, away: AWAY_NAME, pageName: PROBE_PAGE });

    await page.reload();
    await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });
    // allBookmarks is what the away copy lives in, and it loads separately.
    await page.evaluate(() => window.dashboardInstance.data.loadAllBookmarks?.());
    return ok;
}

async function cleanUp(page) {
    await page.evaluate(async ({ url, pageName }) => {
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        const pagesRes = await api('/api/pages');
        if (!pagesRes.ok) return;
        const pages = await pagesRes.json();
        for (const p of pages || []) {
            const res = await api(`/api/bookmarks?page=${p.id}`);
            if (!res.ok) continue;
            const list = await res.json();
            const keep = (Array.isArray(list) ? list : []).filter((b) => b.url !== url);
            if (keep.length !== (list || []).length) {
                await api(`/api/bookmarks?page=${p.id}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(keep),
                });
            }
        }
        const keepPages = (pages || []).filter((p) => String(p?.name || '') !== pageName);
        if (keepPages.length !== (pages || []).length) {
            await api('/api/pages', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(keepPages),
            });
        }
    }, { url: SHARED_URL, pageName: PROBE_PAGE }).catch(() => { /* page may be closed */ });
}

test.describe('resolving the row a right-click landed on', () => {
    test.afterEach(async ({ page }) => {
        await cleanUp(page);
    });

    test('a row from another page resolves to that page\'s bookmark', async ({ page }) => {
        await openDashboard(page);
        const ready = await addCrossPageDuplicate(page);
        test.skip(!ready, 'could not place the same URL on two pages');

        // A row shaped the way a smart collection renders one from another page:
        // the shared URL, no page-local index, identified by what it displays.
        const resolved = await page.evaluate(({ url, away }) => {
            const d = window.dashboardInstance;
            const row = document.createElement('div');
            row.className = 'bookmark-link';
            row.setAttribute('data-bookmark-url', url);
            const text = document.createElement('span');
            text.className = 'bookmark-text';
            text.textContent = away;
            row.appendChild(text);

            const ref = d.contextMenu.resolveRowBookmark(row);
            return {
                name: ref?.bookmark?.name || null,
                url: ref?.bookmark?.url || null,
                copies: (d.allBookmarks || []).filter((b) => b.url === url).length,
            };
        }, { url: SHARED_URL, away: AWAY_NAME });

        expect(resolved.copies).toBeGreaterThan(1);
        expect(resolved.url).toBe(SHARED_URL);
        // Not HOME_NAME, which is the copy on the page currently open.
        expect(resolved.name).toBe(AWAY_NAME);
    });

    test('a row on the current page still resolves to the current page', async ({ page }) => {
        await openDashboard(page);
        const ready = await addCrossPageDuplicate(page);
        test.skip(!ready, 'could not place the same URL on two pages');

        const resolved = await page.evaluate(({ url, home }) => {
            const d = window.dashboardInstance;
            const row = document.createElement('div');
            row.className = 'bookmark-link';
            row.setAttribute('data-bookmark-url', url);
            const text = document.createElement('span');
            text.className = 'bookmark-text';
            text.textContent = home;
            row.appendChild(text);
            const ref = d.contextMenu.resolveRowBookmark(row);
            return ref?.bookmark?.name || null;
        }, { url: SHARED_URL, home: HOME_NAME });

        expect(resolved).toBe(HOME_NAME);
    });

    test('with no label to go on it still resolves, preferring the current page', async ({ page }) => {
        await openDashboard(page);
        const ready = await addCrossPageDuplicate(page);
        test.skip(!ready, 'could not place the same URL on two pages');

        const resolved = await page.evaluate(({ url }) => {
            const d = window.dashboardInstance;
            const row = document.createElement('div');
            row.className = 'bookmark-link';
            row.setAttribute('data-bookmark-url', url);
            const ref = d.contextMenu.resolveRowBookmark(row);
            return ref?.bookmark?.name || null;
        }, { url: SHARED_URL });

        expect(resolved).toBe(HOME_NAME);
    });

    test('the ordinary single-match case is unchanged', async ({ page }) => {
        await openDashboard(page);

        const resolved = await page.evaluate(() => {
            const d = window.dashboardInstance;
            const source = d.bookmarks.find((b) =>
                d.bookmarks.filter((other) => other.url === b.url).length === 1);
            if (!source) return { skipped: true };
            const row = document.createElement('div');
            row.className = 'bookmark-link';
            row.setAttribute('data-bookmark-url', source.url);
            const ref = d.contextMenu.resolveRowBookmark(row);
            return { expected: source.name, got: ref?.bookmark?.name || null };
        });

        test.skip(resolved.skipped === true, 'fixture has no bookmark with a unique URL');
        expect(resolved.got).toBe(resolved.expected);
    });
});

test.describe('pinning a bookmark', () => {
    test('a failed write puts the flag back and says so', async ({ page }) => {
        await openDashboard(page);

        const result = await page.evaluate(async () => {
            const d = window.dashboardInstance;
            const commands = d.searchComponent?.commandsComponent;
            if (typeof commands?._persistBookmarkField !== 'function') return { skipped: true };

            const bookmark = d.bookmarks[0];
            const before = Boolean(bookmark.pinned);

            // The write refusing, the way a locked file or a stale token does.
            const realFetch = window.nextDashFetch;
            window.nextDashFetch = async (url, init) => (init?.method === 'POST'
                ? new Response('nope', { status: 500 })
                : realFetch(url, init));

            let errorShown = '';
            const realError = d.showErrorNotification.bind(d);
            d.showErrorNotification = (message, ...rest) => {
                errorShown = String(message || '');
                return realError(message, ...rest);
            };

            const ok = await commands._persistBookmarkField(bookmark, { pinned: !before });

            window.nextDashFetch = realFetch;
            d.showErrorNotification = realError;
            return { ok, before, after: Boolean(bookmark.pinned), errorShown };
        });

        test.skip(result.skipped === true, 'command palette bundle not loaded');
        expect(result.ok).toBe(false);
        // Reverted, so the badge cannot disagree with the file.
        expect(result.after).toBe(result.before);
        expect(result.errorShown).not.toBe('');
    });

    test('a successful write reports success and keeps the change', async ({ page }) => {
        await openDashboard(page);

        const result = await page.evaluate(async () => {
            const d = window.dashboardInstance;
            const commands = d.searchComponent?.commandsComponent;
            if (typeof commands?._persistBookmarkField !== 'function') return { skipped: true };

            const bookmark = d.bookmarks[0];
            const before = Boolean(bookmark.pinned);
            const ok = await commands._persistBookmarkField(bookmark, { pinned: !before });
            const after = Boolean(bookmark.pinned);

            // Put it back so the fixture is unchanged.
            await commands._persistBookmarkField(bookmark, { pinned: before });
            return { ok, before, after };
        });

        test.skip(result.skipped === true, 'command palette bundle not loaded');
        expect(result.ok).toBe(true);
        expect(result.after).toBe(!result.before);
    });

    test('the flip is applied before the first await, so the palette label is right', async ({ page }) => {
        await openDashboard(page);

        const applied = await page.evaluate(() => {
            const d = window.dashboardInstance;
            const commands = d.searchComponent?.commandsComponent;
            if (typeof commands?._persistBookmarkField !== 'function') return null;

            const bookmark = d.bookmarks[0];
            const before = Boolean(bookmark.pinned);
            // Not awaited: the callers refresh their UI on the next line, so the
            // optimistic update has to be synchronous.
            const promise = commands._persistBookmarkField(bookmark, { pinned: !before });
            const immediately = Boolean(bookmark.pinned);
            return promise.then(() => commands._persistBookmarkField(bookmark, { pinned: before }))
                .then(() => ({ before, immediately }));
        });

        test.skip(applied === null, 'command palette bundle not loaded');
        expect(applied.immediately).toBe(!applied.before);
    });
});
