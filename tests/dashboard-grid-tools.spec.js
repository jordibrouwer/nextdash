// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissBlockingOverlays, dismissOnboardingIfPresent } = require('./e2e-helpers');

/**
 * Four things the grid could not do, each of which cost a detour: coming back
 * to where you were, acting on a selection the way a single row can be acted
 * on, re-filing a bookmark from the keyboard, and narrowing the page you are
 * already looking at.
 */

async function dashboard(page) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 20_000 });
    await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });
    await expect(page.locator('.bookmark-link').first()).toBeAttached();
}

test.describe('filtering the page you are on', () => {
    test('Shift+F narrows the grid and Escape gives it back', async ({ page }) => {
        await dashboard(page);
        const total = await page.locator('.bookmark-link').count();
        test.skip(total < 2, 'needs a couple of bookmarks');

        // From the row's own text: the grid prints the name inside .bookmark-text,
        // and the filter matches on what the row shows rather than on a field.
        const term = await page.evaluate(() => {
            // The name, not the whole row: a letter icon prints its letter
            // in front of the name, and "YYou" is in the row but not the name.
            const name = document.querySelector('.bookmark-link .bookmark-text');
            return (name?.textContent || '').trim().split(/\s+/)[0].slice(0, 4);
        });
        expect(term.length).toBeGreaterThan(1);
        await page.keyboard.press('Shift+F');
        await expect(page.locator('#grid-filter-bar')).toBeVisible();

        await page.locator('.grid-filter-input').fill(term);
        // The count says what it is showing, so the filter cannot silently hide
        // everything and look like an empty page. It only says "N of M" once
        // the filter has been applied, so it is also what is waited on.
        await expect(page.locator('.grid-filter-count')).toContainText(String(total));
        const visible = await page.locator('.bookmark-link:not(.grid-filter-hidden)').count();
        expect(visible).toBeGreaterThan(0);
        expect(visible).toBeLessThanOrEqual(total);

        // The bar says which mode it is, and what Escape does here.
        await expect(page.locator('#grid-filter-bar .grid-filter-prefix')).toHaveText('FILTER');
        await expect(page.locator('#grid-filter-bar .grid-filter-keys kbd')).toHaveCount(3);

        // The term is marked in the names that are left — painted over the
        // row, never written into it, so the row's own text is unchanged.
        const marked = () => page.evaluate(() => {
            const hl = globalThis.CSS?.highlights?.get('grid-filter-hit');
            return hl ? [...hl].map((r) => r.toString()) : [];
        });
        const hits = await marked();
        expect(hits.length).toBeGreaterThan(0);
        for (const hit of hits) expect(hit.toLowerCase()).toBe(term.toLowerCase());
        expect(await page.locator('.bookmark-link mark').count()).toBe(0);

        // First Escape clears the query, the second closes the bar: a typo does
        // not cost you the bar as well.
        await page.locator('.grid-filter-input').press('Escape');
        await expect(page.locator('.grid-filter-count')).toHaveText('');
        expect(await marked()).toEqual([]);
        expect(await page.locator('.bookmark-link:not(.grid-filter-hidden)').count()).toBe(total);
        await page.locator('.grid-filter-input').press('Escape');
        await expect(page.locator('#grid-filter-bar')).toHaveCount(0);
    });
});

test.describe('the selection can do what a row can', () => {
    test('the bar offers pinning and checking', async ({ page }) => {
        await dashboard(page);
        await page.keyboard.press('ArrowDown');
        await page.keyboard.press('x');

        const bar = page.locator('.multi-select-toolbar, .bookmark-multi-select-bar, [aria-label="Selection actions"]').first();
        await expect(bar).toBeVisible({ timeout: 5_000 });
        const labels = await bar.locator('button').allTextContents();
        expect(labels.join(' ')).toMatch(/Pin|Unpin/);
        expect(labels.join(' ')).toMatch(/Checking/);

        // The checking popover lists the three modes rather than cycling one.
        await bar.locator('button', { hasText: /Checking/ }).first().click();
        await expect(page.locator('#multi-select-check-popover')).toBeVisible({ timeout: 5_000 });
        expect(await page.locator('#multi-select-check-popover .move-popover-item').count()).toBe(3);
        await page.keyboard.press('Escape');
    });
});

test.describe('scroll position', () => {
    test('is remembered per page while the setting is on', async ({ page }) => {
        await dashboard(page);
        const state = await page.evaluate(() => {
            const d = window.dashboardInstance;
            const key = `nextdash:page-scroll:${d.currentPageId}`;
            d.settings.rememberScrollPosition = true;
            d.data.rememberScrollForPage(Number(d.currentPageId));
            // Read before taking: takeRememberedScroll consumes from the Map
            // and from sessionStorage, which is the whole point of it — an
            // offset that survived being restored sent every later visit to
            // that page back to where you once left it.
            const storedBefore = sessionStorage.getItem(key) !== null;
            const remembered = d.data.takeRememberedScroll(Number(d.currentPageId));
            return { remembered, key, storedBefore, storedAfter: sessionStorage.getItem(key) !== null };
        });
        // Zero is a legitimate offset at the top of a short page; what matters is
        // that the read does not throw and the key was written.
        expect(Number.isFinite(state.remembered)).toBe(true);
        expect(state.storedBefore).toBe(true);
        expect(state.storedAfter).toBe(false);

        // Off writes nothing and hands back nothing, so every arrival is the top.
        expect(await page.evaluate(() => {
            const d = window.dashboardInstance;
            d.settings.rememberScrollPosition = false;
            return d.data.takeRememberedScroll(Number(d.currentPageId));
        })).toBe(0);
    });
});

test.describe('grid filter reads the address and the tags', () => {
    test('a term found only in the URL or a tag still matches', async ({ page }) => {
        await dashboard(page);
        const pageId = await page.evaluate(() => window.dashboardInstance.currentPageId);
        await page.evaluate(async (pageId) => {
            const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
            await api('/api/bookmarks/add', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ page: pageId, bookmark: { name: 'Plain row', url: 'https://urlonlyqwx.example/', tags: ['tagonlyqwy'] } }),
            });
        }, pageId);
        await dashboard(page);
        await page.keyboard.press('Shift+F');
        await expect(page.locator('#grid-filter-bar')).toBeVisible();
        // Counted outside the smart collections: Today ranks by the hour, and
        // in daytime the new row made its top eight and was shown twice.
        const rows = page.locator('.category:not([data-smart-collection="true"]) .bookmark-link:not(.grid-filter-hidden)');
        for (const term of ['urlonlyqwx', 'tagonlyqwy']) {
            await page.locator('.grid-filter-input').fill(term);
            await expect(rows).toHaveCount(1);
        }
    });
});

test.describe('grid filter: words, collapsed categories and the keyboard', () => {
    const N = `${Date.now()}${Math.random().toString(36).slice(2, 6)}`;
    const ONE = `https://gfone-${N}.example/`;
    const TWO = `https://gftwo-${N}.example/`;

    test.beforeEach(async ({ page }) => {
        await dashboard(page);
        const pageId = await page.evaluate(() => window.dashboardInstance.currentPageId);
        await page.evaluate(async ({ pageId, rows }) => {
            const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
            for (const bookmark of rows) {
                await api('/api/bookmarks/add', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ page: pageId, bookmark }),
                });
            }
        }, { pageId, rows: [{ name: `Gfword ${N} one`, url: ONE }, { name: `Gfword ${N} two`, url: TWO }] });
        await dashboard(page);
    });

    const ownRow = (page, url) => page.locator(`.category:not([data-smart-collection="true"]) .bookmark-link[data-bookmark-url="${url}"]`);

    test('every word must match, in any order', async ({ page }) => {
        await page.keyboard.press('Shift+F');
        const rows = page.locator('.category:not([data-smart-collection="true"]) .bookmark-link:not(.grid-filter-hidden)');
        await page.locator('.grid-filter-input').fill(`one gfword ${N}`);
        await expect(rows).toHaveCount(1);
        await expect(ownRow(page, ONE)).toBeVisible();
        await page.locator('.grid-filter-input').fill(`gfword ${N}`);
        await expect(rows).toHaveCount(2);
        await page.locator('.grid-filter-input').fill(`gfword ${N} three`);
        await expect(rows).toHaveCount(0);
    });

    test('a hit in a collapsed category shows, and the category folds back after', async ({ page }) => {
        const category = page.locator('.category:not([data-smart-collection="true"])', { has: page.locator(`.bookmark-link[data-bookmark-url="${ONE}"]`) });
        await category.locator('.category-title').first().click();
        await expect(category).toHaveAttribute('data-collapsed', 'true');
        const listOpacity = () => ownRow(page, ONE).evaluate((el) => getComputedStyle(el.closest('.bookmarks-list')).opacity);
        await expect.poll(listOpacity).toBe('0');

        await page.locator('body').click({ position: { x: 5, y: 5 } });
        await page.keyboard.press('Shift+F');
        await page.locator('.grid-filter-input').fill(`gfword ${N} one`);
        await expect(category).toHaveClass(/grid-filter-open/);
        await expect.poll(listOpacity).toBe('1');
        // The saved state is not touched.
        await expect(category).toHaveAttribute('data-collapsed', 'true');

        await page.locator('.grid-filter-input').fill('');
        await expect(category).not.toHaveClass(/grid-filter-open/);
        await category.locator('.category-title').first().click();
        await expect(category).toHaveAttribute('data-collapsed', 'false');
    });

    test('Down hands the keys to the first row left; Enter on a single hit opens it', async ({ page }) => {
        await page.evaluate(() => {
            window.__opened = [];
            document.addEventListener('click', (e) => {
                const a = e.target.closest?.('a.bookmark-open, a.bookmark-link');
                if (a) { window.__opened.push(a.getAttribute('href')); e.preventDefault(); }
            }, true);
        });
        await page.keyboard.press('Shift+F');
        const input = page.locator('.grid-filter-input');
        await input.fill(`gfword ${N}`);
        await expect(ownRow(page, TWO)).toBeVisible();
        await input.press('ArrowDown');
        await expect(input).not.toBeFocused();
        const selectedUrl = () => page.evaluate(() => document.querySelector('.bookmark-link.keyboard-selected')?.getAttribute('data-bookmark-url'));
        await expect.poll(selectedUrl).toMatch(/gf(one|two)-/);
        // Two hits: Enter selects, but opens nothing.
        await input.focus();
        await input.press('Enter');
        expect(await page.evaluate(() => window.__opened)).toEqual([]);

        await input.focus();
        await input.fill(`gfword ${N} two`);
        await expect(page.locator('.category:not([data-smart-collection="true"]) .bookmark-link:not(.grid-filter-hidden)')).toHaveCount(1);
        await input.press('Enter');
        await expect.poll(() => page.evaluate(() => window.__opened)).toEqual([TWO]);
    });
});
