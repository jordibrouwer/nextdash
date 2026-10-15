// @ts-check
const { test, expect } = require('./fixtures');
const { prepareDashboardInteraction, dismissWhatsNewIfPresent } = require('./e2e-helpers');

/**
 * The page filter on a phone.
 *
 * On a desktop the filter is summoned with Shift+F. A phone has no Shift+F, so
 * the phone layout keeps the bar at the top of the bookmarks view -- there from
 * the first paint, without stealing focus, and emptied rather than removed by
 * its x.
 */

async function openDashboard(page) {
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await prepareDashboardInteraction(page);
    await dismissWhatsNewIfPresent(page);
    await page.waitForSelector('.bookmark-link', { timeout: 15_000 });
}

test.describe('page filter on a phone', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

    test('the bar is at the top without being opened, and is not focused', async ({ page }) => {
        await openDashboard(page);
        expect(await page.evaluate(() => document.body.getAttribute('data-mobile-layout'))).toBe('true');

        const bar = page.locator('#grid-filter-bar');
        await expect(bar).toBeVisible();
        // Focus would pop the keyboard up on every load.
        await expect(page.locator('.grid-filter-input')).not.toBeFocused();
        // Above the grid, not somewhere further down the page.
        const above = await page.evaluate(() => {
            const b = document.getElementById('grid-filter-bar').getBoundingClientRect();
            const g = document.getElementById('dashboard-layout').getBoundingClientRect();
            return b.bottom <= g.top + 1;
        });
        expect(above).toBe(true);
        // Nothing to clear yet, so no x.
        await expect(page.locator('.grid-filter-clear')).toBeHidden();
    });

    test('typing filters the page, and the x empties the bar without removing it', async ({ page }) => {
        await openDashboard(page);
        const total = await page.locator('.bookmark-link').count();
        const name = (await page.locator('.bookmark-link .bookmark-text').first().textContent())?.trim() || '';
        expect(name.length).toBeGreaterThan(0);

        await page.locator('.grid-filter-input').tap();
        await page.locator('.grid-filter-input').fill(name);
        await expect(page.locator('.bookmark-link.grid-filter-hidden').first()).toBeAttached();
        const hidden = await page.locator('.bookmark-link.grid-filter-hidden').count();
        expect(hidden).toBeLessThan(total);

        await page.locator('.grid-filter-clear').tap();
        await expect(page.locator('#grid-filter-bar')).toBeVisible();
        await expect(page.locator('.grid-filter-input')).toHaveValue('');
        await expect(page.locator('.bookmark-link.grid-filter-hidden')).toHaveCount(0);
    });
});

test('a desktop window does not get the bar until Shift+F', async ({ page }) => {
    await openDashboard(page);
    await expect(page.locator('#grid-filter-bar')).toHaveCount(0);
});
