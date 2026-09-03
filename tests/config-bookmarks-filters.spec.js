// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissBlockingOverlays, dismissOnboardingIfPresent, markConfigSettingPromosSeen } = require('./e2e-helpers');

/**
 * The bookmark list could be narrowed five ways and said almost nothing about
 * it: the address bar knew only the page, an empty result blamed your search
 * whatever was actually filtering, a selection was dropped the moment you
 * changed a filter, and the three orders people use were hidden in a menu of
 * eight.
 */

async function openBookmarks(page) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    // The page-filter promo is anchored in this very panel and arrives half a
    // second after it opens, on top of the quick bar. Marked seen before the
    // section is opened, so it is never scheduled rather than dismissed once it
    // has already covered the button under the pointer.
    await markConfigSettingPromosSeen(page);
    await page.evaluate(() => window.dashboardInstance.config.openConfigView('bookmarks'));
    await page.waitForSelector('#config-bm-list', { timeout: 15_000 });
}

test.describe('what the bookmark list is narrowed to', () => {
    test('the filters are in the address bar, and survive a reload', async ({ page }) => {
        await openBookmarks(page);
        await page.fill('#config-bm-search', 'github');
        await expect.poll(() => page.evaluate(() => window.location.hash), { timeout: 10_000 })
            .toContain('q=github');

        // The link is the list: arriving by it lands on the same rows.
        const hash = await page.evaluate(() => window.location.hash);
        await page.goto(`/${hash}`);
        await page.waitForSelector('#config-bm-list', { timeout: 15_000 });
        await expect.poll(() => page.evaluate(() => window.dashboardInstance.config.bmQuery), { timeout: 10_000 })
            .toBe('github');
    });

    test('an empty list says which filter emptied it', async ({ page }) => {
        await openBookmarks(page);
        await page.fill('#config-bm-search', 'zzzznothingmatches');
        await expect(page.locator('#config-bm-list .config-panel-empty')).toContainText('zzzznothingmatches');

        // A cleanup filter with nothing in it is not a failed search, and used
        // to be described as one.
        await page.evaluate(() => {
            const c = window.dashboardInstance.config;
            c.bmQuery = '';
            c.bmCleanupFilter = 'insecure';
            c.render();
        });
        const empty = page.locator('#config-bm-list .config-panel-empty');
        if (await empty.count()) {
            await expect(empty).not.toContainText(/search/i);
        }
    });

    test('a selection survives a filter change, and says what it is hiding', async ({ page }) => {
        await openBookmarks(page);
        await page.locator('#config-bm-list .config-bm-row input[type="checkbox"]').first().check();
        await expect.poll(() => page.evaluate(() => window.dashboardInstance.config.bmSelected.size)).toBe(1);

        // Through the toolbar, as a reader changes a filter — this is the path
        // that used to empty the selection.
        await page.selectOption('#config-bm-sort', 'name');
        await page.waitForTimeout(300);
        expect(await page.evaluate(() => window.dashboardInstance.config.bmSelected.size),
            'the selection was dropped by a filter change').toBe(1);

        await page.evaluate(() => {
            const c = window.dashboardInstance.config;
            // A filter that cannot contain the ticked row.
            c.bmQuery = 'zzzznothingmatches';
            c.render();
        });

        // Kept, not dropped — and the bar is honest about what is behind the
        // filter, which is what the clearing was there to prevent.
        expect(await page.evaluate(() => window.dashboardInstance.config.bmSelected.size)).toBe(1);
        expect(await page.evaluate(() => window.dashboardInstance.config.hiddenSelectionCount())).toBe(1);
    });

    test('the quick bar sorts, and asks what changed this week', async ({ page }) => {
        await openBookmarks(page);
        await page.click('[data-bm-sort-chip="opens"]');
        await expect.poll(() => page.evaluate(() => window.dashboardInstance.config.bmSort)).toBe('opens');
        await expect(page.locator('[data-bm-sort-chip="opens"]')).toHaveAttribute('aria-pressed', 'true');

        await page.click('[data-bm-changed-toggle]');
        await expect.poll(() => page.evaluate(() => window.dashboardInstance.config.bmCleanupFilter)).toBe('changed');
        // A toggle, so the second press puts the whole list back.
        await page.click('[data-bm-changed-toggle]');
        await expect.poll(() => page.evaluate(() => window.dashboardInstance.config.bmCleanupFilter)).toBe('');
    });

    test('a search keeps how far you had scrolled', async ({ page }) => {
        await openBookmarks(page);
        const kept = await page.evaluate(async () => {
            const c = window.dashboardInstance.config;
            c.bmVisibleLimit = 200;
            c.bmQuery = 'e';
            c.repaintBookmarksList();
            await new Promise((r) => setTimeout(r, 300));
            return c.bmVisibleLimit;
        });
        // Refining a query is a narrowing of what you are already looking at,
        // so it does not throw you back to the first batch.
        expect(kept).toBe(200);
    });
});
