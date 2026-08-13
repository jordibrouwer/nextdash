// @ts-check
const { test, expect } = require('@playwright/test');
const { dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * Dry-run for a category save.
 *
 * The remap that follows a rename is driven entirely by originalId. A client
 * that omits it on a renamed category gets a silent no-op: the save succeeds,
 * the category list updates, and the bookmarks are quietly left pointing at an
 * id that no longer exists. Nothing in the response says so, and on the
 * dashboard an orphaned row is indistinguishable from an uncategorized one.
 *
 * POST /api/categories?dryRun=1 answers with what the save would do — which
 * bookmarks move, which are left behind — and writes nothing.
 */

async function seed(page, { categories, bookmarks }) {
    return page.evaluate(async ({ cats, bms }) => {
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        const pageId = Number(window.dashboardInstance.currentPageId);
        const catRes = await api(`/api/categories?page=${pageId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(cats),
        });
        if (!catRes.ok) throw new Error(`seed categories failed: ${catRes.status}`);
        for (const bm of bms) {
            const res = await api('/api/bookmarks/add', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ page: pageId, bookmark: { ...bm, createdAt: Date.now() } }),
            });
            if (!res.ok) throw new Error(`seed bookmark failed: ${res.status}`);
        }
        return pageId;
    }, { cats: categories, bms: bookmarks });
}

async function postCategories(page, pageId, categories, { dryRun = false } = {}) {
    return page.evaluate(async ({ id, cats, dry }) => {
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        const url = `/api/categories?page=${id}${dry ? '&dryRun=1' : ''}`;
        const res = await api(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(cats),
        });
        return { status: res.status, body: res.ok ? await res.json() : null };
    }, { id: pageId, cats: categories, dry: dryRun });
}

async function categoriesOf(page, pageId) {
    return page.evaluate(async (id) => {
        const res = await fetch(`/api/categories?page=${id}`);
        return res.ok ? res.json() : [];
    }, pageId);
}

async function bookmarksOf(page, pageId) {
    return page.evaluate(async (id) => {
        const res = await fetch(`/api/bookmarks?page=${id}`);
        return res.ok ? res.json() : [];
    }, pageId);
}

async function open(page) {
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
}

test.describe('category save dry-run', () => {
    test('a rename without originalId is reported as orphaning, and nothing is written', async ({ page }) => {
        const stamp = Date.now();
        const url = `https://example.com/preview-orphan-${stamp}.test`;

        await open(page);
        const pageId = await seed(page, {
            categories: [{ id: `work-${stamp}`, name: `Work ${stamp}` }],
            bookmarks: [{ name: `Job ${stamp}`, url, category: `work-${stamp}`, tags: [] }],
        });

        // The mistake the preview exists to catch: renamed, but no originalId
        // linking the new id back to the old one.
        const { status, body } = await postCategories(page, pageId, [
            { id: `job-${stamp}`, name: `Job ${stamp}` },
        ], { dryRun: true });

        expect(status).toBe(200);
        expect(body.orphaned.map((o) => o.url)).toContain(url);
        expect(body.missingOriginalId).toContain(`job-${stamp}`);
        expect(
            body.moved.map((m) => m.url),
            'nothing links the old id to the new one, so this bookmark cannot move',
        ).not.toContain(url);

        // And the dry run changed nothing.
        const cats = await categoriesOf(page, pageId);
        expect(cats.map((c) => c.id)).toContain(`work-${stamp}`);
        const bms = await bookmarksOf(page, pageId);
        expect(bms.find((b) => b.url === url).category).toBe(`work-${stamp}`);
    });

    test('a rename with originalId previews as a clean move', async ({ page }) => {
        const stamp = Date.now();
        const url = `https://example.com/preview-move-${stamp}.test`;

        await open(page);
        const pageId = await seed(page, {
            categories: [{ id: `work-${stamp}`, name: `Work ${stamp}` }],
            bookmarks: [{ name: `Job ${stamp}`, url, category: `work-${stamp}`, tags: [] }],
        });

        const { body } = await postCategories(page, pageId, [
            { id: `job-${stamp}`, name: `Job ${stamp}`, originalId: `work-${stamp}` },
        ], { dryRun: true });

        // Scoped to this test's own bookmark: replacing the category list also
        // orphans the fixture's bookmarks, which is correct and not what this
        // is about.
        expect(body.orphaned.map((o) => o.url), 'the bookmark follows its category').not.toContain(url);
        expect(body.missingOriginalId).toEqual([]);
        const moved = body.moved.find((m) => m.url === url);
        expect(moved.fromCategory).toBe(`work-${stamp}`);
        expect(moved.toCategory).toBe(`job-${stamp}`);
    });

    // The preview is only worth anything if applying the same payload does what
    // it said. Same request twice: once to look, once to commit.
    test('applying the previewed payload produces exactly what was previewed', async ({ page }) => {
        const stamp = Date.now();
        const url = `https://example.com/preview-apply-${stamp}.test`;

        await open(page);
        const pageId = await seed(page, {
            categories: [{ id: `work-${stamp}`, name: `Work ${stamp}` }],
            bookmarks: [{ name: `Job ${stamp}`, url, category: `work-${stamp}`, tags: [] }],
        });

        const next = [{ id: `job-${stamp}`, name: `Job ${stamp}`, originalId: `work-${stamp}` }];
        const { body: preview } = await postCategories(page, pageId, next, { dryRun: true });
        const predicted = preview.moved.find((m) => m.url === url).toCategory;

        const { status } = await postCategories(page, pageId, next);
        expect(status).toBe(200);

        const bms = await bookmarksOf(page, pageId);
        expect(bms.find((b) => b.url === url).category, 'the save disagreed with its own preview').toBe(predicted);
    });

    test('a save that would be refused previews as rejected rather than clean', async ({ page }) => {
        const stamp = Date.now();
        const url = `https://example.com/preview-reject-${stamp}.test`;

        await open(page);
        const pageId = await seed(page, {
            categories: [{ id: `work-${stamp}`, name: `Work ${stamp}` }],
            bookmarks: [{ name: `Job ${stamp}`, url, category: `work-${stamp}`, tags: [] }],
        });

        const { body } = await postCategories(page, pageId, [], { dryRun: true });
        expect(body.rejected).toBe(true);
        expect(body.reason).toBe('categories_still_referenced');

        // And the real save does refuse it, with the 409 the sentinel maps to.
        const { status } = await postCategories(page, pageId, []);
        expect(status).toBe(409);
    });
});
