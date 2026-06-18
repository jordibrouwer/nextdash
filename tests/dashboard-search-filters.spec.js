// @ts-check
const { test, expect } = require('@playwright/test');

async function dismissOnboardingIfPresent(page) {
    const card = page.locator('.onboarding-card');
    if (await card.count()) {
        await page.locator('.onboarding-skip').click();
        await expect(card).toHaveCount(0, { timeout: 5000 });
    }
}

async function dismissBlockingOverlays(page) {
    const whatsNew = page.locator('#app-modal.show');
    if (await whatsNew.count()) {
        await page.keyboard.press('Escape');
        await expect(whatsNew).toHaveCount(0, { timeout: 3000 });
    }
    const searchPromo = page.locator('.dashboard-search-promo');
    if (await searchPromo.count()) {
        await searchPromo.locator('button').first().click();
        await expect(searchPromo).toHaveCount(0, { timeout: 3000 });
    }
}

test.describe('dashboard search filters', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/');
        await page.waitForSelector('.bookmark-link', { timeout: 15_000 });
        await dismissOnboardingIfPresent(page);
        await dismissBlockingOverlays(page);
    });

    test('category: filter shows category completions', async ({ page }) => {
        const category = await page.evaluate(() => {
            const bm = window.dashboardInstance?.bookmarks?.find((b) => String(b.category || '').trim());
            return bm?.category || null;
        });
        test.skip(!category, 'No categorized bookmarks on first page');

        await page.keyboard.press('>');
        await page.keyboard.type(`category:`, { delay: 15 });
        await expect(page.locator('#shortcut-search.show')).toBeVisible({ timeout: 3000 });

        await expect.poll(async () => page.evaluate(() => {
            const sc = window.dashboardInstance?.searchComponent;
            return sc?.searchMatches?.some((m) => (
                m.type === 'filter-completion' && String(m.completion || '').toLowerCase().includes('category:')
            )) ?? false;
        })).toBe(true);
    });

    test('category filter lists bookmarks while typing', async ({ page }) => {
        const category = await page.evaluate(() => {
            const bm = window.dashboardInstance?.bookmarks?.find((b) => String(b.category || '').trim());
            return String(bm?.category || '').trim().toLowerCase() || null;
        });
        test.skip(!category, 'No categorized bookmarks on first page');

        await page.keyboard.press('>');
        await page.keyboard.type(`category:${category}`, { delay: 15 });

        await expect.poll(async () => page.evaluate(() => (
            window.dashboardInstance?.searchComponent?.searchMatches?.some((m) => m.type === 'bookmark') ?? false
        ))).toBe(true);
    });

    test('typing category name suggests category filter', async ({ page }) => {
        const category = await page.evaluate(() => {
            const bm = window.dashboardInstance?.bookmarks?.find((b) => String(b.category || '').trim());
            return String(bm?.category || '').trim().toLowerCase() || null;
        });
        test.skip(!category || category.length < 3, 'Need a category name with 3+ chars');

        const prefix = category.slice(0, 3);
        await page.keyboard.press('>');
        await page.keyboard.type(prefix, { delay: 15 });

        await expect.poll(async () => page.evaluate((catPrefix) => {
            const sc = window.dashboardInstance?.searchComponent;
            return sc?.searchMatches?.some((m) => (
                m.type === 'filter-completion'
                && String(m.completion || '').toLowerCase().startsWith(`category:${catPrefix}`)
            )) ?? false;
        }, prefix)).toBe(true);
    });
});
