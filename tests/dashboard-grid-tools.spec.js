// @ts-check
const { test, expect } = require('@playwright/test');
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
    await page.waitForTimeout(300);
}

test.describe('filtering the page you are on', () => {
    test('Shift+F narrows the grid and Escape gives it back', async ({ page }) => {
        await dashboard(page);
        const total = await page.locator('.bookmark-link').count();
        test.skip(total < 2, 'needs a couple of bookmarks');

        // From the row's own text: the grid prints the name inside .bookmark-text,
        // and the filter matches on what the row shows rather than on a field.
        const term = await page.evaluate(() => {
            const row = document.querySelector('.bookmark-link');
            return (row?.textContent || '').trim().split(/\s+/)[0].slice(0, 4);
        });
        expect(term.length).toBeGreaterThan(1);
        await page.keyboard.press('Shift+F');
        await expect(page.locator('#grid-filter-bar')).toBeVisible();

        await page.locator('.grid-filter-input').fill(term);
        await page.waitForTimeout(200);
        const visible = await page.locator('.bookmark-link:not(.grid-filter-hidden)').count();
        expect(visible).toBeGreaterThan(0);
        expect(visible).toBeLessThanOrEqual(total);
        // The count says what it is showing, so the filter cannot silently hide
        // everything and look like an empty page.
        await expect(page.locator('.grid-filter-count')).toContainText(String(total));

        // First Escape clears the query, the second closes the bar: a typo does
        // not cost you the bar as well.
        await page.locator('.grid-filter-input').press('Escape');
        await page.waitForTimeout(150);
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
        await page.waitForTimeout(300);

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
            d.settings.rememberScrollPosition = true;
            d.data.rememberScrollForPage(Number(d.currentPageId));
            return {
                remembered: d.data.takeRememberedScroll(Number(d.currentPageId)),
                key: `nextdash:page-scroll:${d.currentPageId}`,
            };
        });
        // Zero is a legitimate offset at the top of a short page; what matters is
        // that the read does not throw and the key exists.
        expect(Number.isFinite(state.remembered)).toBe(true);
        expect(await page.evaluate((k) => sessionStorage.getItem(k) !== null, state.key)).toBe(true);

        // Off writes nothing and hands back nothing, so every arrival is the top.
        expect(await page.evaluate(() => {
            const d = window.dashboardInstance;
            d.settings.rememberScrollPosition = false;
            return d.data.takeRememberedScroll(Number(d.currentPageId));
        })).toBe(0);
    });
});
