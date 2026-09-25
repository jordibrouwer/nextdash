// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * Where a kept bookmark may and may not appear.
 *
 * It belongs to one view. Config's bookmark list, the tag cloud, the smart
 * collections and the health report are all about the filed library, and a row
 * that has not been filed yet only gets in the way there. Search is the single
 * exception — a bookmark nothing can find is a bookmark you have lost — and it
 * marks the row so the reader knows where it came from.
 */

/**
 * Whether the result row for this exact name carries the unsorted badge.
 *
 * Read out of the DOM rather than through a text locator: the name is rendered
 * with the matched part wrapped in a highlight, so its text node is split and a
 * whole-string locator match does not find it.
 */
async function badgeOnResult(page, name) {
    return page.evaluate((wanted) => {
        const rows = [...document.querySelectorAll('.search-match')];
        const row = rows.find((node) => {
            const label = node.querySelector('.search-match-name');
            if (!label) return false;
            // The name's own text, without the meta line the row may add.
            const meta = label.querySelector('.search-match-meta');
            const text = meta
                ? label.textContent.replace(meta.textContent, '')
                : label.textContent;
            return text.trim() === wanted;
        });
        if (!row) return null;
        return !!row.querySelector('.search-match-unsorted-badge');
    }, name);
}

/**
 * A kept bookmark of this test's own.
 *
 * The store is reset once per file, not per test, and two of these tests change
 * the row they act on for good -- one renames it, one deletes it. A shared
 * fixture made each test depend on which ones ran before it.
 */
function keptBookmark(slug) {
    return {
        name: `Iso ${slug}`,
        url: `https://iso-${slug}.example/a`,
        category: '',
        createdAt: 5000,
    };
}

async function bootstrap(page, kept) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });
    // How the kept list is read is a setting now, so it outlives a test and
    // the next one would inherit a grouping it never chose.
    await page.evaluate(async () => {
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        await api('/api/settings', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ unsortedSort: 'added-desc', unsortedGroup: 'none' }),
        });
        const s = window.dashboardInstance?.settings;
        if (s) { s.unsortedSort = 'added-desc'; s.unsortedGroup = 'none'; }
        const u = window.dashboardInstance?.unsorted;
        if (u) { u.sort = 'added-desc'; u.groupBy = 'none'; u.searchQuery = ''; u.brokenOnly = false; }
    });

    await page.evaluate(async (kept) => {
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        await api('/api/bookmarks/add', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ page: 999999, bookmark: kept }),
        });
        await window.dashboardInstance.loadAllBookmarks();
    }, kept);
}

test('the kept rows are held apart from the dashboard pool', async ({ page }) => {
    await bootstrap(page, keptBookmark('pool'));

    const pools = await page.evaluate(() => {
        const d = window.dashboardInstance;
        const countUnsorted = (list) => (list || []).filter((b) => Number(b.pageId) === 999999).length;
        return {
            all: countUnsorted(d.allBookmarks),
            split: (d.unsortedBookmarks || []).length,
            cloud: countUnsorted(window.DashboardTagCloud?.getBookmarkPool?.()),
            smart: countUnsorted(d.smartCollections?.getSmartCollectionSourceBookmarks?.()),
        };
    });

    expect(pools.all).toBe(0);
    expect(pools.cloud).toBe(0);
    expect(pools.smart).toBe(0);
    expect(pools.split).toBeGreaterThan(0);
});

test('config lists every page but never the unsorted one', async ({ page }) => {
    await bootstrap(page, keptBookmark('config'));
    await page.evaluate(() => window.dashboardInstance.config.openConfigView('bookmarks'));
    await expect(page.locator('#config-bm-list')).toBeVisible({ timeout: 15_000 });

    await expect(page.locator('#config-bm-list')).not.toContainText('Iso config');
    // The count beside the heading counts the same pool, so it has to agree.
    await expect(page.locator('.config-bm-header-badge')).toHaveText(
        String(await page.evaluate(() => window.dashboardInstance.allBookmarks.length)));
});

test('the health report leaves the unsorted page out', async ({ page }) => {
    await bootstrap(page, keptBookmark('health'));

    const report = await page.evaluate(async () => {
        const res = await fetch('/api/bookmark-health?refresh=1', { cache: 'no-store' });
        const data = await res.json();
        return {
            issues: (data.issues || []).length,
            unsorted: (data.issues || []).filter((i) => Number(i.pageId) === 999999).length,
        };
    });

    expect(report.unsorted).toBe(0);
});

test('search finds a kept bookmark and says it is unsorted', async ({ page }) => {
    await bootstrap(page, keptBookmark('badge'));

    await page.evaluate(async () => {
        if (window.SearchLoader) await window.SearchLoader.ensureReady();
        // `/` is the name-search prefix: without it the palette answers about
        // shortcuts and offers a hint instead of the bookmark itself.
        window.dashboardInstance.searchComponent.openSearchWithQuery('/Iso badge');
    });

    await expect.poll(() => badgeOnResult(page, 'Iso badge'), { timeout: 10_000 }).toBe(true);
});

test('a dashboard bookmark carries no unsorted badge', async ({ page }) => {
    await bootstrap(page, keptBookmark('filedbadge'));
    await page.evaluate(async () => {
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        await api('/api/bookmarks/add', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                page: 1,
                bookmark: { name: 'Iso Filed', url: 'https://iso-filed-uvi.example/b', category: '' },
            }),
        });
        await window.dashboardInstance.loadAllBookmarks();
        if (window.SearchLoader) await window.SearchLoader.ensureReady();
        window.dashboardInstance.searchComponent.openSearchWithQuery('/Iso Filed');
    });

    await expect.poll(() => badgeOnResult(page, 'Iso Filed'), { timeout: 10_000 }).toBe(false);
});

/** The names search is currently willing to offer. */
function searchPoolNames(page) {
    return page.evaluate(() => (window.dashboardInstance.searchComponent?.bookmarks || [])
        .map((b) => b.name));
}

test('renaming a kept bookmark reaches search without a reload', async ({ page }) => {
    await bootstrap(page, keptBookmark('rename'));
    await page.evaluate(async () => {
        if (window.SearchLoader) await window.SearchLoader.ensureReady();
    });
    expect(await searchPoolNames(page)).toContain('Iso rename');

    // Through the editor, not by calling the sync helper: that helper lives in
    // the lazily-loaded inline-edit module, so a direct call before the module
    // lands is answered by the loader proxy and quietly does nothing. The row
    // menu loads it, which is what every real edit does too.
    await page.evaluate(() => window.dashboardInstance.unsorted.openUnsortedView());
    await expect(page.locator('.unsorted-view-search-input')).toBeVisible();
    await page.locator('.unsorted-view-search-input').fill('iso-rename.example');

    const row = page.locator('.bookmark-link[data-unsorted-key]').first();
    await expect(row).toHaveAttribute('data-context-menu-bound', '1');
    await row.evaluate((node) => {
        const rect = node.getBoundingClientRect();
        node.dispatchEvent(new MouseEvent('contextmenu', {
            bubbles: true, cancelable: true,
            clientX: Math.round(rect.left + 20), clientY: Math.round(rect.top + 5),
        }));
    });
    await page.locator('#bookmark-context-menu [data-action="edit"]').click();
    await expect(page.locator('.bookmark-inline-form')).toBeVisible();

    // The name field by name: the form opens with the address first now.
    await page.locator('.bookmark-inline-form [data-field="name"]').fill('Iso Renamed');
    await page.locator('.bookmark-inline-actions .bookmark-inline-save').click();
    await expect(page.locator('.bookmark-inline-form')).toHaveCount(0);

    await expect.poll(() => searchPoolNames(page), { timeout: 10_000 })
        .toContain('Iso Renamed');
    expect(await searchPoolNames(page)).not.toContain('Iso rename');
});

test('deleting a kept bookmark stops search offering it', async ({ page }) => {
    await bootstrap(page, keptBookmark('delete'));
    await page.evaluate(async () => {
        if (window.SearchLoader) await window.SearchLoader.ensureReady();
    });
    expect(await searchPoolNames(page)).toContain('Iso delete');

    await page.evaluate(() => {
        const d = window.dashboardInstance;
        d.removeBookmarkByUrl(999999, 'https://iso-delete.example/a');
        d.updateSearchComponent();
    });

    expect(await searchPoolNames(page)).not.toContain('Iso delete');
});

test('an undone delete puts a kept bookmark back where it came from', async ({ page }) => {
    await bootstrap(page, keptBookmark('undo'));
    // The add and the load that follows it are two round trips; without waiting
    // for the row to actually be in the array, the block below starts from a
    // bookmark it never found.
    await expect.poll(() => page.evaluate(() => (window.dashboardInstance.unsortedBookmarks || [])
        .some((b) => b.url === 'https://iso-undo.example/a')), { timeout: 10_000 }).toBe(true);

    const where = await page.evaluate(async () => {
        const d = window.dashboardInstance;
        const url = 'https://iso-undo.example/a';
        /*
         * The inline-edit module first.
         *
         * restoreBookmarkInAllBookmarks asks _shouldSyncBookmarkMutation
         * whether the bookmark is already in the list, and that helper lives in
         * the lazily-loaded module: before it lands, the loader answers with a
         * promise, which is truthy, so the restore concludes the row is already
         * there and does nothing. Every real undo follows an edit, so the
         * module is loaded by then -- this is the test standing where the app
         * already stands.
         */
        await d.inlineEdit?.load?.();
        // The arrays are captured and spliced in place rather than reassigned:
        // a background refresh can swap the properties for fresh arrays at any
        // moment, and the restore would then land in one while the check read
        // the other.
        const kept = d.unsortedBookmarks;
        const filed = d.allBookmarks || [];
        const bookmark = { ...kept.find((b) => b.url === url) };
        const drop = (list) => {
            for (let i = list.length - 1; i >= 0; i -= 1) {
                if (list[i]?.url === url) list.splice(i, 1);
            }
        };
        drop(kept);
        drop(filed);
        // The undo path: restore by page id, the way a failed save rolls back.
        d.restoreBookmarkInAllBookmarks(bookmark, 999999);
        return {
            kept: kept.filter((b) => b.url === url).length,
            filed: filed.filter((b) => b.url === url).length,
        };
    });

    // Back in the kept array, and not smuggled onto every dashboard surface.
    expect(where.kept).toBe(1);
    expect(where.filed).toBe(0);
});

test('a URL that is both filed and kept answers search once', async ({ page }) => {
    await bootstrap(page, keptBookmark('dupe'));
    // The same address on a page as well: keeping one from the inbox does not
    // check whether it is already filed somewhere.
    await page.evaluate(async () => {
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        await api('/api/bookmarks/add', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                page: 1,
                bookmark: { name: 'Iso Dupe Filed', url: 'https://iso-dupe.example/a', category: '' },
            }),
        });
        const d = window.dashboardInstance;
        // Both halves of the pool: the filed copy reaches search through the
        // current page's own array when global shortcuts are off.
        await d.data.loadPageBookmarks(d.currentPageId, { forceFetch: true, skipRender: true });
        await d.loadAllBookmarks();
        if (window.SearchLoader) await window.SearchLoader.ensureReady();
        d.updateSearchComponent();
    });

    // One row in the pool the palette actually holds.
    const rows = await page.evaluate(() => (window.dashboardInstance.searchComponent?.bookmarks || [])
        .filter((b) => String(b.url || '').trim() === 'https://iso-dupe.example/a')
        .map((b) => b.name));
    expect(rows).toHaveLength(1);

    // And when the filed copy is in the base pool, that is the one that
    // survives: a bookmark with a home is presented as being in that home.
    // Called with a base of its own, because which pool the palette starts from
    // depends on the global-shortcuts setting and is not what this pins.
    const picked = await page.evaluate(() => window.dashboardInstance.setup
        .searchBookmarkPool([{ name: 'Iso Dupe Filed', url: 'https://iso-dupe.example/a', pageId: 1 }])
        .filter((b) => String(b.url || '').trim() === 'https://iso-dupe.example/a')
        .map((b) => b.name));
    expect(picked).toEqual(['Iso Dupe Filed']);
});

test('the setting takes the kept rows out of search and puts them back', async ({ page }) => {
    await bootstrap(page, keptBookmark('setting'));

    const poolCounts = async () => page.evaluate(() => {
        const list = window.dashboardInstance.searchComponent?.bookmarks || [];
        return list.filter((b) => Number(b.pageId) === 999999).length;
    });

    await page.evaluate(async () => {
        if (window.SearchLoader) await window.SearchLoader.ensureReady();
    });
    expect(await poolCounts()).toBeGreaterThan(0);

    // Through the switch the reader uses, not by writing the setting: what is
    // under test is that flipping it reaches the pool without a reload.
    await page.evaluate(() => window.dashboardInstance.config.openConfigView('behavior'));
    await page.locator('button', { hasText: 'Keyboard & search' }).first().click();
    const box = page.locator('input[data-behavior-field="searchUnsorted"]');
    await expect(box).toBeChecked();

    await box.uncheck();
    await expect.poll(poolCounts, { timeout: 10_000 }).toBe(0);

    await page.locator('input[data-behavior-field="searchUnsorted"]').check();
    await expect.poll(poolCounts, { timeout: 10_000 }).toBeGreaterThan(0);
});
