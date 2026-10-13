// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * What one page shows must not leak onto the next.
 *
 * A switch renders the incremental way when it can, and the check for "can"
 * compared category ids only. Every new page has a category called "others",
 * so between two such pages the grid of the page being left was kept and only
 * its rows replaced: a category folded there was folded on the page opened.
 */

async function openDashboard(page) {
    await page.setViewportSize({ width: 1600, height: 900 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });
}

/** A new page holding one bookmark in its "others" category; its id. */
async function pageWithOthers(page, name) {
    return page.evaluate(async (pageName) => {
        const d = window.dashboardInstance;
        const created = await d.structureCreate.createPageFromForm(pageName);
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        await api('/api/bookmarks/add', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ page: created.id, bookmark: {
                name: `${pageName} row`, url: `https://${pageName.replace(/\W+/g, '-').toLowerCase()}.example/`, category: 'others',
            } }),
        });
        return Number(created.id);
    }, name);
}

async function openPageByTab(page, id) {
    const index = await page.evaluate(
        (pid) => (window.dashboardInstance.pages || []).findIndex((p) => Number(p.id) === Number(pid)),
        id,
    );
    await page.locator('#page-navigation .page-nav-btn:not([data-view-tab])').nth(index).click();
    await page.waitForFunction(
        (pid) => Number(window.dashboardInstance.currentPageId) === Number(pid),
        id,
        { timeout: 10_000 },
    );
}

test.describe('switching pages', () => {
    test('a category folded on one page is not folded on the next', async ({ page }) => {
        await openDashboard(page);
        const folded = await pageWithOthers(page, 'Fold left');
        const opened = await pageWithOthers(page, 'Fold right');
        // A bare reload, so both pages are ordinary ones that have been there a while.
        await page.reload();
        await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });

        await openPageByTab(page, folded);
        const others = page.locator('#dashboard-layout .category[data-category-id="others"]');
        await others.locator('.category-title').click();
        await expect(others).toHaveAttribute('data-collapsed', 'true');

        await openPageByTab(page, opened);
        await expect(page.locator('#dashboard-layout .bookmark-link[data-bookmark-url*="fold-right"]').first())
            .toBeAttached();
        await expect(others, 'the fold of the page left behind came along').toHaveAttribute('data-collapsed', 'false');
    });
});

test.describe('the all-pages list', () => {
    /**
     * Several callers do not wait for it, so two loads can be in flight. The
     * older one answering last used to win, and a bookmark just added was not
     * in the list search reads.
     */
    test('an older answer arriving last does not replace a newer one', async ({ page }) => {
        await openDashboard(page);

        let calls = 0;
        await page.route('**/api/bookmarks?all=true', async (route) => {
            calls += 1;
            if (calls === 1) {
                // The older answer: before the bookmark existed, and late.
                await new Promise((resolve) => setTimeout(resolve, 1500));
                return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
            }
            return route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify([{ name: 'Newest', url: 'https://newest.example/', pageId: 1, category: '' }]),
            });
        });

        const urls = await page.evaluate(async () => {
            const d = window.dashboardInstance;
            const older = d.loadAllBookmarks();
            await new Promise((resolve) => setTimeout(resolve, 100));
            const newer = d.loadAllBookmarks();
            await Promise.all([older, newer]);
            return (d.allBookmarks || []).map((b) => b.url);
        });
        expect(calls).toBe(2);
        expect(urls).toContain('https://newest.example/');
    });
});
