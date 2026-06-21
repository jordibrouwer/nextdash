// @ts-check
const { test, expect } = require('@playwright/test');

const PROMO_KEYS = [
    'nextdash:dashboard-search-promo-search-v2',
    'nextdash:dashboard-search-promo-command-v1',
    'nextdash:dashboard-search-promo-finder-v1',
    'nextdash:dashboard-search-promo-filters-v1',
];

async function markWhatsNewSeen(page) {
    await page.addInitScript(() => {
        try {
            const release = '2026.06-dashboard-release-v71';
            localStorage.setItem('nextdash:last-whats-new-dashboard-release', release);
            localStorage.setItem('nextdash:whats-new-search-promo-release', release);
            localStorage.setItem('nextdash:whats-new-search-promo-start', '0');
        } catch {
            // ignore
        }
    });
}

async function seedPromoReset(page) {
    await page.addInitScript((keys) => {
        keys.forEach((key) => {
            try {
                localStorage.removeItem(key);
            } catch {
                // ignore
            }
        });
    }, PROMO_KEYS);
}

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
        await expect(whatsNew).toHaveCount(0, { timeout: 5000 });
    }
    await page.evaluate(() => window.dashboardInstance?.searchComponent?.closeSearch?.());
    const searchPromo = page.locator('.dashboard-search-promo');
    if (await searchPromo.count()) {
        await searchPromo.locator('button').first().click();
        await expect(searchPromo).toHaveCount(0, { timeout: 3000 });
    }
}

async function preparePromoPage(page, { dismissWhatsNew = true } = {}) {
    if (dismissWhatsNew) {
        await markWhatsNewSeen(page);
    }
    await seedPromoReset(page);
    await page.goto('/');
    await page.waitForSelector('.bookmark-link', { timeout: 15_000 });
    await resetSearchPromos(page);
    await dismissOnboardingIfPresent(page);
    if (dismissWhatsNew) {
        await dismissBlockingOverlays(page);
    }
}

test.describe('dashboard search promos', () => {
    test.describe.configure({ mode: 'serial' });

    test.describe('with whats-new dismissed', () => {
        test.beforeEach(async ({ page }) => {
            await preparePromoPage(page);
        });

        test('shows search promo on first >', async ({ page }) => {
            await page.keyboard.press('>');
            await expect(page.locator('#shortcut-search.show')).toBeVisible({ timeout: 3000 });
            await expect(page.locator('.dashboard-search-promo--search')).toBeVisible({ timeout: 3000 });
        });

        test('shows command promo on first :', async ({ page }) => {
            await page.keyboard.press(':');
            await expect(page.locator('#shortcut-search.show')).toBeVisible({ timeout: 3000 });
            await expect(page.locator('.dashboard-search-promo--command')).toBeVisible({ timeout: 3000 });
        });

        test('shows finder promo on first ?', async ({ page }) => {
            await page.keyboard.press('?');
            await expect(page.locator('#shortcut-search.show')).toBeVisible({ timeout: 3000 });
            await expect(page.locator('.dashboard-search-promo--finder')).toBeVisible({ timeout: 3000 });
        });
    });

    test.describe('whats-new gating', () => {
        test.beforeEach(async ({ page }) => {
            await preparePromoPage(page, { dismissWhatsNew: false });
        });

        test('shows search promo after whats-new modal is dismissed', async ({ page }) => {
            const whatsNew = page.locator('#app-modal.show');
            if (!(await whatsNew.count())) {
                test.skip(true, 'whats-new modal not shown on load');
            }

            await page.keyboard.press('>');
            await expect(page.locator('#shortcut-search.show')).toBeVisible({ timeout: 3000 });
            await expect(page.locator('.dashboard-search-promo--search')).toHaveCount(0, { timeout: 1200 });

            await page.keyboard.press('Escape');
            await expect(page.locator('#shortcut-search.show')).toHaveCount(0, { timeout: 3000 });
            await page.keyboard.press('Escape');
            await expect(whatsNew).toHaveCount(0, { timeout: 3000 });

            await page.keyboard.press('>');
            await expect(page.locator('#shortcut-search.show')).toBeVisible({ timeout: 3000 });
            await expect(page.locator('.dashboard-search-promo--search')).toBeVisible({ timeout: 3000 });
        });
    });
});
