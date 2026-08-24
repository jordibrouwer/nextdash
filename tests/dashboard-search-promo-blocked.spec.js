// @ts-check
const { test, expect } = require('./fixtures');

const PROMO_KEYS = [
    'nextdash:dashboard-search-promo-search-v2',
    'nextdash:dashboard-search-promo-command-v1',
    'nextdash:dashboard-search-promo-finder-v1',
];

async function resetSearchPromos(page) {
    await page.evaluate((keys) => {
        keys.forEach((key) => {
            try {
                localStorage.removeItem(key);
            } catch {
                // ignore
            }
        });
        window.DashboardSearchPromo?.clearPromoSeen?.();
    }, PROMO_KEYS);
}

test('search promo appears while whats-new blocks, after modal closes', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.bookmark-link', { timeout: 15_000 });
    await resetSearchPromos(page);

    const whatsNew = page.locator('#app-modal.show');
    if (!(await whatsNew.count())) {
        test.skip(true, 'whats-new modal not shown on load');
    }

    await page.keyboard.press('>');
    await expect(page.locator('#shortcut-search.show')).toBeVisible({ timeout: 3000 });
    await page.waitForTimeout(1500);
    await expect(page.locator('.dashboard-search-promo--search')).toHaveCount(0);

    await page.keyboard.press('Escape');
    await expect(page.locator('#shortcut-search.show')).toHaveCount(0, { timeout: 3000 });
    await page.keyboard.press('Escape');
    await expect(whatsNew).toHaveCount(0, { timeout: 3000 });

    await page.keyboard.press('>');
    await expect(page.locator('.dashboard-search-promo--search')).toBeVisible({ timeout: 3000 });
});
