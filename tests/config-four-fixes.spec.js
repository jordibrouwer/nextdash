// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * Four config-view corrections, each a case of one list or key standing in for
 * another.
 */

async function openConfig(page) {
    await page.setViewportSize({ width: 1400, height: 900 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });
    await page.evaluate(() => window.dashboardInstance.config.openConfigView('pages-tags'));
    await page.waitForTimeout(800);
}

test.describe('config keyboard lists', () => {
    /*
     * The Collection sizes table is built from .config-crud-row like every
     * other list, but its rows are read-only and carry no key. Being first in
     * the DOM they took index 0, listRowKey answered null there, and the cursor
     * could never move off them -- so up/down, g/G and Enter were all dead on
     * the Collections tab.
     */
    test('only rows with a key are navigable', async ({ page }) => {
        await openConfig(page);
        const tab = page.locator('[data-pt-tab="collections"]').first();
        test.skip(!(await tab.count()), 'no collections tab');
        await tab.click();
        await page.waitForTimeout(900);

        const shape = await page.evaluate(() => {
            const cfg = window.dashboardInstance.config;
            const inDom = [...document.querySelectorAll('#config-pt-body .config-crud-list .config-crud-row')];
            const navigable = cfg.getListKeyboardRows();
            return {
                keylessInDom: inDom.filter((r) => cfg.listRowKey(r) === null).length,
                keylessNavigable: navigable.filter((r) => cfg.listRowKey(r) === null).length,
            };
        });

        // Whatever the tab holds, nothing keyless is offered to the cursor.
        expect(shape.keylessNavigable).toBe(0);
    });

    /*
     * The legend was attached to the first .config-crud-list on the panel,
     * which on Collections is that same read-only table -- promising keys under
     * something none of them drive.
     */
    test('the keyboard legend sits under the list the keys drive', async ({ page }) => {
        await openConfig(page);
        const tab = page.locator('[data-pt-tab="collections"]').first();
        test.skip(!(await tab.count()), 'no collections tab');
        await tab.click();
        await page.waitForTimeout(900);

        const ok = await page.evaluate(() => {
            const cfg = window.dashboardInstance.config;
            const body = document.getElementById('config-pt-body');
            const lists = [...body.querySelectorAll('.config-crud-list')];
            const keyedList = lists.find((el) => [...el.querySelectorAll('.config-crud-row')]
                .some((row) => cfg.listRowKey(row) !== null));
            const legend = body.querySelector('.config-list-keyboard-legend');
            return {
                // Only meaningful when this tab actually has a navigable list.
                hasKeyedList: Boolean(keyedList),
                legendFollowsKeyedList: Boolean(legend) && legend.previousElementSibling === keyedList,
            };
        });

        test.skip(!ok.hasKeyedList, 'this tab has no navigable list in the fixture');
        expect(ok.legendFollowsKeyedList).toBe(true);
    });
});

test.describe('config bookmarks', () => {
    /*
     * Statistics counts duplicates on a canonical URL key; the list counted them
     * on a plain lowercase string. A trailing slash or a fragment made the two
     * disagree about the same pair of links.
     */
    test('the duplicate set is keyed the way Statistics counts', async ({ page }) => {
        await openConfig(page);

        const agree = await page.evaluate(() => {
            const cfg = window.dashboardInstance.config;
            const d = window.dashboardInstance;
            const original = d.allBookmarks;
            // Two links that differ only by a trailing slash.
            d.allBookmarks = [
                { url: 'https://dupe.example/docs', pageId: 1, category: '' },
                { url: 'https://dupe.example/docs/', pageId: 1, category: '' },
            ];
            cfg._bmDuplicateUrls = null;
            const dupes = cfg.ensureDuplicateUrlSet();
            const statsKey = cfg.canonicalStatsUrlKey('https://dupe.example/docs/');
            const found = dupes.has(statsKey);
            d.allBookmarks = original;
            cfg._bmDuplicateUrls = null;
            return { size: dupes.size, found };
        });

        // One canonical URL, seen twice -- and the key Statistics would look up.
        expect(agree.size).toBe(1);
        expect(agree.found).toBe(true);
    });

    /*
     * The Statistics scope selector lives on the config instance for the whole
     * session. The Bookmarks tiles fell back to computeStats(), which honours
     * it, so they counted one page while the list beneath counted everything.
     */
    test('the summary tiles count the library, not the Statistics scope', async ({ page }) => {
        await openConfig(page);

        const counts = await page.evaluate(() => {
            const d = window.dashboardInstance;
            const cfg = d.config;
            const original = d.allBookmarks;
            const originalPages = d.pages;
            // Two real pages, so scoping to one is a genuine narrowing --
            // statsScopePage resolves the filter against d.pages, and the
            // fixture ships a single page where the bug cannot show itself.
            d.pages = [{ id: 1, name: 'One' }, { id: 2, name: 'Two' }];
            d.allBookmarks = [
                { url: 'https://a.example/1', pageId: 1, category: '', tags: [] },
                { url: 'https://a.example/2', pageId: 1, category: '', tags: [] },
                { url: 'https://b.example/1', pageId: 2, category: '', tags: [] },
            ];
            const total = d.allBookmarks.length;
            const read = () => {
                // computeStats caches on a key that does not include our stand-in
                // data, so clear it between reads.
                cfg._statsCache = null;
                cfg._statsCacheKey = '';
                return Number(cfg.bookmarksSummaryTiles(null).find((t) => t.key === 'total')?.value);
            };
            const before = read();
            cfg.statsPageFilter = '2';
            const after = read();
            cfg.statsPageFilter = '';
            cfg._statsCache = null;
            cfg._statsCacheKey = '';
            d.allBookmarks = original;
            d.pages = originalPages;
            return { total, before, after };
        });

        expect(counts.before).toBe(counts.total);
        // The Statistics scope does not move the Bookmarks tiles.
        expect(counts.after).toBe(counts.total);
    });
});

test.describe('config, second round', () => {
    /*
     * The context menu hands focus back to its row on close, and then Select
     * repainted the whole list -- destroying that row without putting focus
     * anywhere. j/k then walked the section rail instead of the list.
     */
    test('a full list repaint keeps focus on the row it was on', async ({ page }) => {
        await openConfig(page);
        await page.evaluate(() => window.dashboardInstance.config.openConfigView('bookmarks'));
        await page.waitForTimeout(1200);

        const kept = await page.evaluate(() => {
            const cfg = window.dashboardInstance.config;
            const row = document.querySelector('#config-bm-list .config-bm-row');
            if (!row) return null;
            const key = cfg.bookmarkRowKey(row);
            row.focus({ preventScroll: true });
            const focusedBefore = document.activeElement === row;
            cfg.repaintBookmarksList();
            const active = document.activeElement;
            return {
                focusedBefore,
                stillOnARow: Boolean(active?.classList?.contains('config-bm-row')),
                sameRow: cfg.bookmarkRowKey(active) === key,
            };
        });

        test.skip(kept === null, 'no bookmark rows in the fixture');
        expect(kept.focusedBefore).toBe(true);
        expect(kept.stillOnARow).toBe(true);
        expect(kept.sameRow).toBe(true);
    });

    /*
     * ensureHelpTranslations held one in-flight promise with no record of the
     * language it was fetching, so a request for another language joined it and
     * merged the wrong prose in.
     */
    test('a help fetch in flight is not reused for another language', async ({ page }) => {
        await openConfig(page);

        const shape = await page.evaluate(async () => {
            const lang = window.dashboardInstance.language;
            if (!lang || typeof lang.ensureHelpTranslations !== 'function') return null;
            // Stand in for a slow fetch that never settles during the test.
            const realFetch = window.fetch;
            let asked = [];
            window.fetch = (url, ...rest) => {
                if (String(url).includes('help')) {
                    asked.push(String(url));
                    return new Promise(() => {});
                }
                return realFetch(url, ...rest);
            };
            lang._helpLoadedFor = null;
            lang._helpLoading = null;
            lang._helpLoadingFor = null;
            void lang.ensureHelpTranslations('en');
            void lang.ensureHelpTranslations('de');
            window.fetch = realFetch;
            return { asked: asked.length, urls: asked };
        });

        test.skip(shape === null, 'language module not available');
        // Two languages asked for means two requests, not one shared answer.
        expect(shape.asked).toBe(2);
        expect(shape.urls.some((u) => u.includes('/en'))).toBe(true);
        expect(shape.urls.some((u) => u.includes('/de'))).toBe(true);
    });
});

test.describe('config sync', () => {
    /*
     * The revision poll compares the server's settingsRevision against what
     * this tab last saw. Nothing recorded a save made *here*, so the next focus
     * read the tab's own change as another device's and ran a full settings
     * refresh -- which replaces d.settings wholesale and re-renders, throwing
     * away a field typed but not yet committed.
     */
    test('a settings save is not seen as somebody else’s change', async ({ page }) => {
        await openConfig(page);

        const seen = await page.evaluate(async () => {
            const d = window.dashboardInstance;
            // Whatever the poll would find right now.
            await d.data.fetchDataRevision();
            const before = d.data._lastSettingsRevision;
            d._serverSettingsRevision = before;

            // A real change: writing the value back unchanged leaves the file
            // byte-identical, so the fingerprint never moves and the test would
            // pass whether the fix is there or not.
            const originalColumns = Number(d.settings.columnsPerRow || 4);
            d.settings.columnsPerRow = originalColumns === 5 ? 4 : 5;
            await d.data.saveSettings();

            // What the poll would compare against on the next focus.
            const adopted = d._serverSettingsRevision;
            await d.data.fetchDataRevision();
            const serverNow = d.data._lastSettingsRevision;
            // Put it back, so the fixture is left as it was found.
            d.settings.columnsPerRow = originalColumns;
            await d.data.saveSettings();
            return { before, adopted, serverNow, moved: before !== serverNow };
        });

        // The save really did move the server's fingerprint...
        expect(seen.moved).toBe(true);
        // ...and the tab adopted it, so the poll's settingsChanged test is false
        // and no refresh runs against this tab's own change.
        expect(seen.adopted).toBe(seen.serverNow);
    });

    /*
     * The drain sat after the try/finally, but both branches return from inside
     * the try -- and a return runs finally and then leaves the function. A
     * second edit arriving while a refresh held the guard was stranded until
     * the next pageshow.
     */
    test('the sync drain is reachable from every branch', async ({ page }) => {
        await openConfig(page);

        const src = await page.evaluate(async () => {
            const res = await fetch('/static/js/dashboard/dashboard-config-sync.js');
            return res.ok ? res.text() : '';
        });
        expect(src).not.toBe('');

        // The drain has to sit inside the finally block, where a return from
        // the try still runs it. Placed after the block it is dead code on the
        // branches that return -- which is every branch that matters.
        const handler = src.slice(src.indexOf("addEventListener('storage'"));
        const finallyAt = handler.indexOf('} finally {');
        expect(finallyAt).toBeGreaterThan(-1);
        // Where that finally block ends: the first line that closes it.
        const finallyEnd = handler.indexOf('\n            }', finallyAt);
        const drainAt = handler.indexOf('maybeRefreshAfterConfigReturn();', finallyAt);
        expect(drainAt).toBeGreaterThan(finallyAt);
        expect(drainAt).toBeLessThan(finallyEnd);
    });
});
