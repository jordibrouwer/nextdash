// @ts-check
const { test, expect } = require('@playwright/test');

async function dismissOnboardingIfPresent(page) {
    const card = page.locator('.onboarding-card');
    if (await card.count()) {
        await page.locator('.onboarding-skip').click();
        await expect(card).toHaveCount(0, { timeout: 5000 });
    }
}

async function markWhatsNewSeen(page) {
    await page.addInitScript(() => {
        try {
            const release = '2026.06-dashboard-release-v71';
            localStorage.setItem('nextdash:last-whats-new-dashboard-release', release);
            localStorage.setItem('nextdash:whats-new-search-promo-release', release);
            localStorage.setItem('nextdash:whats-new-search-promo-start', '0');
            localStorage.setItem('nextdash:dashboard-cheatsheet-promo-confirmed-v1', '1');
        } catch {
            // ignore
        }
    });
}

async function dismissWhatsNewIfPresent(page) {
    const modal = page.locator('#app-modal.show');
    if (await modal.count()) {
        await page.keyboard.press('Escape');
        await expect(modal).toHaveCount(0, { timeout: 5000 });
    }
}

async function expectDashboardNotInert(page) {
    await expect.poll(async () => page.evaluate(() => ({
        layoutInert: document.getElementById('dashboard-layout')?.hasAttribute('inert') ?? false,
        buttonsInert: document.querySelector('.button-container')?.hasAttribute('inert') ?? false,
        shouldTrap: window.FocusTrapUtils?.shouldTrapDashboardBackground?.() ?? false,
    }))).toEqual({
        layoutInert: false,
        buttonsInert: false,
        shouldTrap: false,
    });
}

test.describe('dashboard inert after overlays', () => {
    test.describe.configure({ mode: 'serial' });

    test.beforeEach(async ({ page }) => {
        await markWhatsNewSeen(page);
        await page.goto('/');
        await page.waitForSelector('.bookmark-link', { timeout: 15_000 });
        await dismissOnboardingIfPresent(page);
        await dismissWhatsNewIfPresent(page);
    });

    test('dashboard is clickable after closing search', async ({ page }) => {
        await page.keyboard.press('>');
        await expect(page.locator('#shortcut-search.show')).toBeVisible({ timeout: 3000 });
        await page.keyboard.press('Escape');
        await expect(page.locator('#shortcut-search.show')).toHaveCount(0, { timeout: 3000 });
        await expectDashboardNotInert(page);

        const link = page.locator('#dashboard-layout .bookmark-link a.bookmark-open').first();
        await expect(link).toBeVisible();
        await link.click({ timeout: 5000 });
    });

    test('dashboard is clickable after closing search opened multiple times', async ({ page }) => {
        for (let i = 0; i < 3; i += 1) {
            await page.keyboard.press('>');
            await expect(page.locator('#shortcut-search.show')).toBeVisible({ timeout: 3000 });
            await page.keyboard.press('Escape');
            await expect(page.locator('#shortcut-search.show')).toHaveCount(0, { timeout: 3000 });
        }
        await expectDashboardNotInert(page);
        await page.locator('#dashboard-layout .bookmark-link a.bookmark-open').first().click({ timeout: 5000 });
    });

    test('dashboard is clickable after closing cheat sheet modal', async ({ page }) => {
        await page.keyboard.press('!');
        const modal = page.locator('#app-modal.show');
        await expect(modal).toBeVisible({ timeout: 5000 });
        await page.evaluate(() => {
            if (window.DashboardFeaturePromos?.isPromoOpen?.('cheatsheet')) {
                window.DashboardFeaturePromos.dismissOpen?.();
            }
        });
        await page.keyboard.press('Escape');
        await expect(modal).toHaveCount(0, { timeout: 5000 });
        await expectDashboardNotInert(page);
        await page.locator('#dashboard-layout .bookmark-link a.bookmark-open').first().click({ timeout: 5000 });
    });

    test('dashboard stays inert while search open and clears after close', async ({ page }) => {
        await page.keyboard.press('>');
        await expect(page.locator('#shortcut-search.show')).toBeVisible({ timeout: 3000 });
        await expect.poll(async () => page.evaluate(() => (
            document.getElementById('dashboard-layout')?.hasAttribute('inert') === true
        ))).toBe(true);

        await page.keyboard.press('Escape');
        await expect(page.locator('#shortcut-search.show')).toHaveCount(0);
        await expectDashboardNotInert(page);
    });

    test('dashboard is clickable after closing page overview', async ({ page }) => {
        await page.keyboard.press(',');
        const overlay = page.locator('#page-overview-overlay');
        await expect(overlay).toBeVisible({ timeout: 3000 });
        await expect.poll(async () => page.evaluate(() => (
            document.getElementById('dashboard-layout')?.hasAttribute('inert') === true
        ))).toBe(true);

        await page.keyboard.press('Escape');
        await expect(overlay).toHaveCount(0, { timeout: 3000 });
        await expectDashboardNotInert(page);
        await page.locator('#dashboard-layout .bookmark-link a.bookmark-open').first().click({ timeout: 5000 });
    });

    test('dashboard is clickable after closing omnibox', async ({ page }) => {
        await page.keyboard.press('&');
        const overlay = page.locator('#omnibox-overlay');
        await expect(overlay).toBeVisible({ timeout: 3000 });
        await expect.poll(async () => page.evaluate(() => (
            document.getElementById('dashboard-layout')?.hasAttribute('inert') === true
        ))).toBe(true);

        await page.keyboard.press('Escape');
        await expect(overlay).toHaveCount(0, { timeout: 3000 });
        await expectDashboardNotInert(page);
        await page.locator('#dashboard-layout .bookmark-link a.bookmark-open').first().click({ timeout: 5000 });
    });

    test('dashboard is clickable after closing tag cloud', async ({ page }) => {
        const eligible = await page.evaluate(() => {
            const toggle = document.getElementById('tag-cloud-toggle');
            return Boolean(toggle?.classList.contains('is-eligible'));
        });
        test.skip(!eligible, 'tag cloud not eligible in this environment');

        await page.keyboard.press('/');
        const modal = page.locator('#tag-cloud-modal:not([hidden])');
        await expect(modal).toBeVisible({ timeout: 3000 });
        await expect.poll(async () => page.evaluate(() => (
            document.getElementById('dashboard-layout')?.hasAttribute('inert') === true
        ))).toBe(true);

        await page.keyboard.press('Escape');
        await expect(modal).toBeHidden({ timeout: 3000 });
        await expectDashboardNotInert(page);
        await page.locator('#dashboard-layout .bookmark-link a.bookmark-open').first().click({ timeout: 5000 });
    });
});
