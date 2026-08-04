// @ts-check
const { test, expect } = require('@playwright/test');
const { dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * Paging of the config bookmark list: 50 rows render, the rest arrive as you
 * scroll (setupBookmarkLoadMore).
 *
 * This went unnoticed in production because the observer was given
 * `.config-view-body` as its root — a class with no CSS behind it, so the div
 * grows to fit its rows instead of scrolling. The sentinel then never crossed
 * the root's bounds, no callback ran, and the list sat at 50 of 102 however far
 * you scrolled. The list only pages above 50 bookmarks, and the module-level
 * "config lazy load" spec covers a different thing entirely, so nothing caught
 * it. These cover the row paging itself.
 */

const TOTAL = 102;
const PAGE = 50;

async function openSeededBookmarks(page, total = TOTAL) {
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.allBookmarks?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => !window.dashboardInstance._deferredAllBookmarksLoadInFlight);
    await page.evaluate((n) => {
        const d = window.dashboardInstance;
        const pageId = d.pages[0].id;
        d.allBookmarks = Array.from({ length: n }, (_, i) => ({
            name: `Paged ${String(i).padStart(3, '0')}`,
            url: `https://paged${i}.example.com/`,
            pageId, category: '', tags: [],
        }));
    }, total);
    await page.evaluate(() => window.dashboardInstance.config.openConfigView('bookmarks'));
    await expect(page.locator('#config-bm-list')).toBeVisible();
    await page.evaluate(() => window.dashboardInstance.config.repaintBookmarksList());
    await expect(page.locator('.config-bm-row')).toHaveCount(PAGE);
}

const rowCount = (page) => page.locator('.config-bm-row').count();

async function scrollToBottom(page) {
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.mouse.wheel(0, 1200);
}

test.describe('config bookmark list paging', () => {
    test('the scroll host is one that really scrolls, never a static div', async ({ page }) => {
        await openSeededBookmarks(page);

        const host = await page.evaluate(() => {
            const el = window.dashboardInstance.config.bookmarkListScrollHost();
            if (!el) return null;
            return {
                overflowY: getComputedStyle(el).overflowY,
                scrollable: el.scrollHeight > el.clientHeight + 1,
            };
        });

        // Null means the viewport scrolls, which IntersectionObserver accepts as
        // a root. Anything else must genuinely be a scroller.
        if (host !== null) {
            expect(['auto', 'scroll', 'overlay']).toContain(host.overflowY);
            expect(host.scrollable).toBe(true);
        }
    });

    test('scrolling to the bottom loads the next page', async ({ page }) => {
        await openSeededBookmarks(page);

        await scrollToBottom(page);

        await expect.poll(() => rowCount(page), { timeout: 5_000 }).toBe(PAGE * 2);
    });

    test('repeated scrolling reaches the end of the list', async ({ page }) => {
        await openSeededBookmarks(page);

        await scrollToBottom(page);
        await expect.poll(() => rowCount(page), { timeout: 5_000 }).toBe(PAGE * 2);

        await scrollToBottom(page);
        await expect.poll(() => rowCount(page), { timeout: 5_000 }).toBe(TOTAL);

        // Everything is in, so the sentinel and its hint are gone.
        await expect(page.locator('[data-bm-load-more]')).toHaveCount(0);
        await expect(page.locator('.config-bm-load-hint')).toHaveCount(0);
    });

    test('an idle list does not page on its own', async ({ page }) => {
        await openSeededBookmarks(page);

        // Growing the list re-renders it and rebuilds the observer; without the
        // arming guard that cascades to the end of the library untouched.
        await page.waitForTimeout(1_200);

        expect(await rowCount(page)).toBe(PAGE);
    });

    test('a list that fits on one page shows no sentinel', async ({ page }) => {
        await openSeededBookmarks(page, PAGE);

        await expect(page.locator('[data-bm-load-more]')).toHaveCount(0);
        expect(await rowCount(page)).toBe(PAGE);
    });
});
