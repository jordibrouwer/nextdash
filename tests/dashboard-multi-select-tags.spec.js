// @ts-check
const { test, expect } = require('./fixtures');
const {
    markWhatsNewSeen,
    dismissOnboardingIfPresent,
    dismissBlockingOverlays,
    WRITE_TOKEN,
} = require('./e2e-helpers');

const writeHeaders = { 'X-NextDash-Token': WRITE_TOKEN };

/**
 * Bulk tagging from the grid's multi-select toolbar.
 *
 * Category already had a route here — it lives inside the Move popover — but
 * tags did not: the row's own Shift+T popover is single-bookmark, so tagging
 * eight rows meant eight rounds.
 */

async function openDashboard(page) {
    await page.setViewportSize({ width: 1400, height: 900 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.evaluate(() => {
        const o = document.getElementById('favicon-prefetch-overlay');
        if (o) o.hidden = true;
    });
    await page.waitForFunction(() => !!window.dashboardInstance?.multiSelect, null, { timeout: 20_000 });
}

/** Ticks the first `n` bookmarks through the module's own key path. */
async function selectFirst(page, n) {
    return page.evaluate((count) => {
        const d = window.dashboardInstance;
        const ms = d.multiSelect;
        ms.clear();
        (d.bookmarks || []).slice(0, count).forEach((bm) => {
            ms.selected.add(ms.keyFor(bm, d.currentPageId));
        });
        ms.sync();
        return ms.selected.size;
    }, n);
}

/** Gives the first `n` bookmarks a known tag so the library is not empty. */
async function seedTag(page, tag, n) {
    await page.evaluate(async ({ name, count }) => {
        const d = window.dashboardInstance;
        (d.bookmarks || []).slice(0, count).forEach((bm) => {
            const tags = (bm.tags || []).map((t) => String(t).toLowerCase());
            if (!tags.includes(name)) bm.tags = [...tags, name];
        });
        await d.saveBookmarkOrder();
        d.renderDashboard({ incremental: false });
    }, { name: tag, count: n });
}

async function tagsOf(page, index) {
    return page.evaluate((i) => {
        const bm = window.dashboardInstance.bookmarks[i];
        return (bm?.tags || []).map((t) => String(t).toLowerCase());
    }, index);
}

test.describe('bulk tagging from the multi-select toolbar', () => {
    // Strip the tags these tests add, so the shared server stays clean. Written
    // straight through the API rather than saveBookmarkOrder(): that goes via the
    // in-page reorder snapshot, which is not in a sane state once the page is
    // being torn down, and hung the hook.
    test.afterEach(async ({ page, request }) => {
        const pageId = await page.evaluate(
            () => Number(window.dashboardInstance?.currentPageId) || 1
        ).catch(() => 1);
        const res = await request.get(`/api/bookmarks?page=${pageId}`);
        if (!res.ok()) return;
        const list = await res.json();
        const cleaned = (list || []).map((bm) => ({
            ...bm,
            tags: (bm.tags || []).filter((t) => !String(t).startsWith('e2ems')),
        }));
        await request.post(`/api/bookmarks?page=${pageId}`, {
            data: cleaned,
            headers: writeHeaders,
        });
    });

    test('the toolbar carries a Tags button', async ({ page }) => {
        await openDashboard(page);
        await selectFirst(page, 1);
        await expect(page.locator('.multi-select-toolbar .multi-select-tags-btn')).toBeVisible();
    });

    test('the popover lists the tags already in use', async ({ page }) => {
        await openDashboard(page);
        await seedTag(page, 'e2emsknown', 1);
        await selectFirst(page, 1);
        await page.locator('.multi-select-tags-btn').click();
        const pop = page.locator('#multi-select-tags-popover');
        await expect(pop).toBeVisible();
        await expect(pop.locator('[data-tag="e2emsknown"]')).toHaveCount(1);
    });

    test('clicking an unset tag adds it to every selected bookmark', async ({ page }) => {
        await openDashboard(page);
        await seedTag(page, 'e2emsadd', 1);
        const n = await selectFirst(page, 3);
        expect(n).toBe(3);

        await page.locator('.multi-select-tags-btn').click();
        await page.locator('#multi-select-tags-popover [data-tag="e2emsadd"]').click();

        await expect.poll(async () => {
            const all = await Promise.all([0, 1, 2].map((i) => tagsOf(page, i)));
            return all.filter((t) => t.includes('e2emsadd')).length;
        }, { timeout: 10_000 }).toBe(3);
    });

    test('a tag on every selected row is removed instead', async ({ page }) => {
        await openDashboard(page);
        await seedTag(page, 'e2emsdrop', 3);
        await selectFirst(page, 3);

        await page.locator('.multi-select-tags-btn').click();
        // Shown as fully applied, so the click takes it away.
        const item = page.locator('#multi-select-tags-popover [data-tag="e2emsdrop"]');
        await expect(item).toHaveClass(/is-current/);
        await item.click();

        await expect.poll(async () => {
            const all = await Promise.all([0, 1, 2].map((i) => tagsOf(page, i)));
            return all.filter((t) => t.includes('e2emsdrop')).length;
        }, { timeout: 10_000 }).toBe(0);
    });

    test('a partly applied tag says so and fills the rest in', async ({ page }) => {
        await openDashboard(page);
        await seedTag(page, 'e2emspart', 1);
        await selectFirst(page, 3);

        await page.locator('.multi-select-tags-btn').click();
        const item = page.locator('#multi-select-tags-popover [data-tag="e2emspart"]');
        await expect(item).toContainText('on 1 of 3');
        // Not fully applied, so it must add rather than remove.
        await expect(item).not.toHaveClass(/is-current/);
        await item.click();

        await expect.poll(async () => {
            const all = await Promise.all([0, 1, 2].map((i) => tagsOf(page, i)));
            return all.filter((t) => t.includes('e2emspart')).length;
        }, { timeout: 10_000 }).toBe(3);
    });

    test('bookmarks outside the selection keep their tags', async ({ page }) => {
        await openDashboard(page);
        await seedTag(page, 'e2emsscope', 1);
        const before = await tagsOf(page, 4);
        await selectFirst(page, 2);

        await page.locator('.multi-select-tags-btn').click();
        await page.locator('#multi-select-tags-popover [data-tag="e2emsscope"]').click();

        await expect.poll(async () => (await tagsOf(page, 1)).includes('e2emsscope'), { timeout: 10_000 })
            .toBe(true);
        expect(await tagsOf(page, 4)).toEqual(before);
    });

    test('the change survives a reload, so it really persisted', async ({ page }) => {
        await openDashboard(page);
        await seedTag(page, 'e2emspersist', 1);
        await selectFirst(page, 2);
        await page.locator('.multi-select-tags-btn').click();
        await page.locator('#multi-select-tags-popover [data-tag="e2emspersist"]').click();
        await expect.poll(async () => (await tagsOf(page, 1)).includes('e2emspersist'), { timeout: 10_000 })
            .toBe(true);

        await page.reload();
        await page.waitForFunction(() => window.dashboardInstance?.bookmarks?.length > 0, null, { timeout: 20_000 });
        expect(await tagsOf(page, 1)).toContain('e2emspersist');
    });

    test('Escape closes the popover without tagging anything', async ({ page }) => {
        await openDashboard(page);
        await seedTag(page, 'e2emsesc', 1);
        await selectFirst(page, 2);
        const before = await tagsOf(page, 1);

        await page.locator('.multi-select-tags-btn').click();
        await expect(page.locator('#multi-select-tags-popover')).toBeVisible();
        await page.keyboard.press('Escape');

        await expect(page.locator('#multi-select-tags-popover')).toHaveCount(0);
        expect(await tagsOf(page, 1)).toEqual(before);
    });

    test('the selection stays open after tagging, for a second tag', async ({ page }) => {
        await openDashboard(page);
        await seedTag(page, 'e2emsstay', 1);
        await selectFirst(page, 2);
        await page.locator('.multi-select-tags-btn').click();
        await page.locator('#multi-select-tags-popover [data-tag="e2emsstay"]').click();

        await expect.poll(async () => (await tagsOf(page, 1)).includes('e2emsstay'), { timeout: 10_000 })
            .toBe(true);
        // Tagging is not a terminal action the way delete is.
        await expect(page.locator('.multi-select-toolbar')).toBeVisible();
    });

    /*
     * The card counts the three sources that need no round trip, and not the
     * fourth.
     *
     * Page text is the source a scan round has to be asked for, so a card that
     * counted it would be asking for one sideways -- and the count is what
     * decides whether the card appears at all. Proved by handing the engine
     * the same bookmarks *with* keywords: the two answers have to differ.
     */
    test('the corner card counts only what needs no scan round', async ({ page }) => {
        await openDashboard(page);
        const seen = await page.evaluate(async () => {
            const N = window.TagSuggestionsNotice;
            const d = window.dashboardInstance;
            const catalogue = await N.ensureCatalogue();
            const items = (d.allBookmarks || []).map((b, index) => ({
                key: `${b.pageId}::${b.url}::${index}`,
                url: b.url,
                tags: Array.isArray(b.tags) ? b.tags : [],
            }));
            const options = {
                rules: d.settings?.tagRules || [],
                catalogue,
                dismissed: d.settings?.dismissedTagSuggestions || [],
            };
            const base = window.TagSuggestions.suggest(items, options);
            // Three bookmarks nothing else reaches, so the group the keywords
            // produce is a group that was not there before rather than one
            // taking a slot from a stronger source.
            const spoken = new Set(base.flatMap((group) => group.keys));
            const free = items.filter((item) => !spoken.has(item.key)).slice(0, 3);
            const keywords = {};
            // Two words of one subject each, which is the floor the page-text
            // source asks for.
            free.forEach((item) => { keywords[item.key] = ['peer-reviewed', 'doi']; });
            const withText = window.TagSuggestions.suggest(items, { ...options, keywords });
            return {
                free: free.length,
                card: N.proposalCount(),
                base: base.length,
                withText: withText.length,
                textGroups: withText.filter((group) => group.pattern === 'page-text').length,
                min: N.MIN_TO_OFFER,
            };
        });

        expect(seen.free).toBe(3);
        // The keywords produce a group; the card's own count does not have it.
        // That difference is the whole claim — page text is the source a scan
        // round has to be asked for, and a card counting it would be asking
        // for one sideways.
        expect(seen.textGroups).toBe(1);
        expect(seen.withText).toBe(seen.base + 1);
        expect(seen.card).toBe(seen.base);
        // Ten is the floor the design named for saying anything at all.
        expect(seen.min).toBe(10);
    });
});
