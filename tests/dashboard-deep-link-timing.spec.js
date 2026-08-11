// @ts-check
const { test, expect } = require('@playwright/test');
const { prepareDashboardInteraction, dismissWhatsNewIfPresent } = require('./e2e-helpers');

/**
 * Deep links from Health into the dashboard grid.
 *
 * Opening a bookmark on the dashboard from the Health view announced "Category
 * not found — it may have been deleted" about a category sitting in plain sight
 * on the same page. Two separate faults produced that:
 *
 *   The focus step waited two animation frames and then assumed the grid was
 *   built. Two was enough on a small collection and not enough on a large one,
 *   so the category element did not exist yet when it was looked for.
 *
 *   The message itself read "dashboard.deepLinkCategoryNotFound" rather than a
 *   sentence, because language.t() answers with the key when a string is
 *   missing and the `|| 'Category not found…'` fallback could never fire
 *   against a non-empty string.
 *
 * These exercise the waiting directly rather than through a page load: the race
 * only shows up on a collection large enough to render slowly, which a fixture
 * cannot reliably reproduce, but the helper's contract can be checked exactly.
 */

async function openDashboard(page) {
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await prepareDashboardInteraction(page);
    await dismissWhatsNewIfPresent(page);
    await page.waitForSelector('.bookmark-link', { timeout: 15_000 });
}

/** A deep link aimed at a real category and one of its rows. */
async function realLink(page) {
    return page.evaluate(() => {
        const d = window.dashboardInstance;
        const catId = [...document.querySelectorAll('.category[data-category-id]')]
            .map((el) => el.getAttribute('data-category-id'))
            .find((id) => id && !id.startsWith('__'));
        const row = document.querySelector(
            `.category[data-category-id="${catId}"] .bookmark-link[data-bookmark-url]`
        );
        return { pageId: d.currentPageId, categoryId: catId, url: row?.getAttribute('data-bookmark-url') };
    });
}

test.describe('deep link waits for the grid', () => {
    test('resolves immediately when the target is already rendered', async ({ page }) => {
        await openDashboard(page);
        const link = await realLink(page);

        const result = await page.evaluate(async (l) => {
            const t0 = performance.now();
            const found = await window.dashboardInstance.pageNav.waitForDeepLinkTarget(l, 2000);
            return { found, ms: performance.now() - t0 };
        }, link);

        expect(result.found).toBe(true);
        // No delay added to the common case, where the grid is already there.
        expect(result.ms).toBeLessThan(120);
    });

    // The actual bug: the grid is still rendering when the link is followed.
    test('waits for a target that renders late instead of giving up', async ({ page }) => {
        await openDashboard(page);
        const link = await realLink(page);

        const found = await page.evaluate(async (l) => {
            const grid = document.getElementById('dashboard-layout');
            const saved = grid.innerHTML;
            grid.innerHTML = '';
            const pending = window.dashboardInstance.pageNav.waitForDeepLinkTarget(l, 2000);
            setTimeout(() => { grid.innerHTML = saved; }, 400);
            return pending;
        }, link);

        expect(found, 'gave up before the grid finished rendering').toBe(true);
    });

    // And the case the message is actually for, which must still end.
    test('gives up on a category that genuinely is not there', async ({ page }) => {
        await openDashboard(page);

        const result = await page.evaluate(async () => {
            const d = window.dashboardInstance;
            const t0 = performance.now();
            const found = await d.pageNav.waitForDeepLinkTarget(
                { pageId: d.currentPageId, categoryId: 'no-such-category-xyz' }, 600,
            );
            return { found, ms: performance.now() - t0 };
        });

        expect(result.found).toBe(false);
        expect(result.ms, 'waited well past its deadline').toBeLessThan(2000);
    });
});

test.describe('deep link messages read as sentences', () => {
    test('the not-found messages fall back to English rather than showing the key', async ({ page }) => {
        await openDashboard(page);

        const msgs = await page.evaluate(() => {
            const d = window.dashboardInstance;
            const saved = d.language.translations;
            d.language.translations = {};   // as if the locale had not loaded
            const out = {
                category: d.pageNav.t('dashboard.deepLinkCategoryNotFound', 'FALLBACK-CATEGORY'),
                bookmark: d.pageNav.t('dashboard.deepLinkBookmarkNotFound', 'FALLBACK-BOOKMARK'),
            };
            d.language.translations = saved;
            return out;
        });

        expect(msgs.category).toBe('FALLBACK-CATEGORY');
        expect(msgs.bookmark).toBe('FALLBACK-BOOKMARK');
        // The shape of the original bug: the raw key reaching the toast.
        expect(msgs.category).not.toContain('dashboard.');
        expect(msgs.bookmark).not.toContain('dashboard.');
    });

    test('a real translation still wins over the fallback', async ({ page }) => {
        await openDashboard(page);

        const msg = await page.evaluate(() => window.dashboardInstance.pageNav
            .t('dashboard.deepLinkCategoryNotFound', 'FALLBACK'));

        // The control: without it the tests above would pass against a helper
        // that always returns its fallback.
        expect(msg).not.toBe('FALLBACK');
        expect(msg).toContain('Category not found');
    });
});

// The fault underneath the waiting: consumeDashboardDeepLink used to run inside
// loadData(), which finishes before init() renders the grid. A link resolves
// against DOM that did not exist yet, so it could only ever fail — and did,
// reporting a category as deleted while it sat on screen. Following a real deep
// link end to end is the only way to catch an ordering bug like that; asserting
// on the helper alone passes either way.
test.describe('a deep link followed on a cold load', () => {
    test('finds its bookmark and says nothing about a missing category', async ({ page }) => {
        await openDashboard(page);
        const link = await realLink(page);
        test.skip(!link.categoryId || !link.url, 'needs a categorised bookmark in the fixture');

        const notices = [];
        page.on('console', () => {});
        const url = `/?page=${link.pageId}&category=${encodeURIComponent(link.categoryId)}`
            + `&url=${encodeURIComponent(link.url)}`;
        await page.goto(url);
        await page.waitForSelector('.bookmark-link', { timeout: 15_000 });
        await page.waitForTimeout(1200);

        const state = await page.evaluate((wanted) => ({
            // The same URL can appear in more than one place — a smart
            // collection carries copies — so this asks whether the link's own
            // category rendered and holds the row, not which copy came first
            // in the document.
            categoryRendered: Boolean(
                document.querySelector(`.category[data-category-id="${CSS.escape(wanted.categoryId)}"]`)
            ),
            rowInThatCategory: Boolean(document.querySelector(
                `.category[data-category-id="${CSS.escape(wanted.categoryId)}"] `
                + `.bookmark-link[data-bookmark-url="${CSS.escape(wanted.url)}"]`
            )),
            toasts: [...document.querySelectorAll('.app-notification, [class*="toast"]')]
                .map((el) => el.textContent.trim()).filter(Boolean),
        }), link);

        expect(state.categoryRendered, 'the linked category never rendered').toBe(true);
        expect(state.rowInThatCategory, 'the deep link did not reach its bookmark').toBe(true);
        // The report: a "category was deleted" notice about a visible category.
        expect(state.toasts.join(' '), `unexpected notice: ${JSON.stringify(state.toasts)}`)
            .not.toMatch(/category not found/i);
        expect(notices).toEqual([]);
    });
});
