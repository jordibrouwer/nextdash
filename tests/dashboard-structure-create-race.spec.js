// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * DashboardStructureCreate's create/delete methods are read-the-list,
 * change-it, write-the-whole-list-back with no version check on the server.
 * Two overlapping calls against the same page used to race: whichever fetch
 * read the list last would win, silently dropping whatever the other call had
 * just added. Fixed by serializing writes per key (`categories:<pageId>` /
 * `pages`) inside DashboardStructureCreate itself, so it doesn't matter which
 * of the many UI entry points triggered the overlapping calls.
 */

async function loadDashboard(page) {
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
}

async function deleteCategoryByName(page, pageId, name) {
    await page.evaluate(async ({ pid, targetName }) => {
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        const res = await api(`/api/categories?page=${pid}`);
        if (!res.ok) return;
        const list = await res.json();
        const keep = (list || []).filter((c) => String(c?.name || '') !== targetName);
        if (keep.length === (list || []).length) return;
        await api(`/api/categories?page=${pid}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(keep),
        });
    }, { pid: pageId, targetName: name });
}

test.describe('structure-create — overlapping writes do not clobber each other', () => {
    test('two categories created back to back on the same page both persist', async ({ page }) => {
        await loadDashboard(page);
        const pageId = await page.evaluate(() => Number(window.dashboardInstance.currentPageId));
        const nameA = `E2E race A ${Date.now()}`;
        const nameB = `E2E race B ${Date.now()}`;

        const results = await page.evaluate(async ({ pid, a, b }) => {
            const sc = window.dashboardInstance.structureCreate;
            // Fired together, not awaited one after the other — this is what
            // reproduces the race: both reads the same starting list before
            // either write lands.
            const [ra, rb] = await Promise.all([
                sc.createCategoryFromForm(pid, a),
                sc.createCategoryFromForm(pid, b),
            ]);
            return { ra, rb };
        }, { pid: pageId, a: nameA, b: nameB });

        expect(results.ra.error, `create A errored: ${JSON.stringify(results.ra)}`).toBeUndefined();
        expect(results.rb.error, `create B errored: ${JSON.stringify(results.rb)}`).toBeUndefined();

        const stored = await page.evaluate(async (pid) => {
            const res = await fetch(`/api/categories?page=${pid}`);
            return res.ok ? await res.json() : [];
        }, pageId);

        expect(stored.some((c) => c.name === nameA), `A missing from ${JSON.stringify(stored)}`).toBe(true);
        expect(stored.some((c) => c.name === nameB), `B missing from ${JSON.stringify(stored)}`).toBe(true);

        await deleteCategoryByName(page, pageId, nameA);
        await deleteCategoryByName(page, pageId, nameB);
    });
});
