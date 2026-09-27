// @ts-check
const { test, expect } = require('./fixtures');
const { prepareDashboardInteraction } = require('./e2e-helpers');

/**
 * Bookmarks left pointing at a category that no longer exists.
 *
 * Deleting one category from a page that still has others is allowed, and it
 * deliberately leaves that category's bookmarks alone rather than misfiling
 * them (see TestSaveCategoriesByPageDropWithoutOriginalIDDoesNotMisfileByPosition).
 * Nothing repairs them afterwards — the rebuild-from-refs recovery only runs
 * when a page has no categories at all. On the dashboard the result is
 * invisible, because an orphaned row renders in the same place as a genuinely
 * uncategorized one. The health report is where it surfaces, alongside the
 * other data-integrity issues.
 */

async function seedPageWithCategories(page, { categories, bookmarks }) {
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

async function fetchHealth(page) {
    return page.evaluate(async () => {
        const res = await fetch('/api/bookmark-health');
        return res.ok ? res.json() : null;
    });
}

test.describe('orphaned categories reach the health report', () => {
    test('deleting a category leaves its bookmarks flagged, and only those', async ({ page }) => {
        const stamp = Date.now();
        const orphanUrl = `https://example.com/orphan-${stamp}.test`;
        const keptUrl = `https://example.com/kept-${stamp}.test`;

        await page.goto('/');
        await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
        await prepareDashboardInteraction(page);

        const pageId = await seedPageWithCategories(page, {
            categories: [
                { id: `doomed-${stamp}`, name: `Doomed ${stamp}` },
                { id: `keeper-${stamp}`, name: `Keeper ${stamp}` },
            ],
            bookmarks: [
                { name: `Orphan ${stamp}`, url: orphanUrl, category: `doomed-${stamp}`, tags: [] },
                { name: `Kept ${stamp}`, url: keptUrl, category: `keeper-${stamp}`, tags: [] },
            ],
        });

        // Before the deletion nothing is orphaned — the control that keeps this
        // from passing against a check that flags everything.
        const before = await fetchHealth(page);
        const orphanBefore = before.issues.find((i) => i.url === orphanUrl);
        expect(orphanBefore, 'seeded bookmark missing from the report').toBeTruthy();
        expect(orphanBefore.flags || []).not.toContain('orphaned-category');

        // Drop the doomed category the way saving the category editor does:
        // POST the surviving list, without the deleted one.
        await page.evaluate(async ({ id, keeperId }) => {
            const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
            const res = await api(`/api/categories?page=${id}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify([{ id: keeperId, name: keeperId, originalId: keeperId }]),
            });
            if (!res.ok) throw new Error(`category delete failed: ${res.status}`);
        }, { id: pageId, keeperId: `keeper-${stamp}` });

        const after = await fetchHealth(page);
        const orphanAfter = after.issues.find((i) => i.url === orphanUrl);
        const keptAfter = after.issues.find((i) => i.url === keptUrl);

        expect(orphanAfter.flags, 'the bookmark whose category was deleted').toContain('orphaned-category');
        expect(keptAfter.flags, 'a bookmark in a surviving category').not.toContain('orphaned-category');
        expect(after.summary.orphanedCategoryCount).toBeGreaterThan(0);

        // The reason has to name the category, or the row says something is
        // wrong without saying what to look for.
        const reasonText = JSON.stringify(orphanAfter.reasonDetails || orphanAfter.reasons || []);
        expect(reasonText).toContain(`doomed-${stamp}`);
    });
});

test.describe('the reason names the missing category', () => {
    test('in the reader\'s language, with the category id the bookmark still points at', async ({ page }) => {
        await page.goto('/');
        await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
        const labels = await page.evaluate(async () => {
            const health = await window.dashboardInstance.health.load();
            const issue = {
                pageId: 1, index: 0, name: 'Orphaned row', url: 'https://example.com/orphaned',
                status: 'orphaned-category', flags: ['orphaned-category'],
                reasons: ['Category "ghost" no longer exists'],
                reasonDetails: [{ code: 'orphaned_category', params: { category: 'ghost' }, penalty: 15 }],
            };
            return health.reasonEntries(issue).map((entry) => entry.label).join(' | ');
        });
        // Translated through health-reason-utils rather than showing the raw code.
        expect(labels).toContain('ghost');
        expect(labels).not.toContain('orphaned_category');
    });
});
