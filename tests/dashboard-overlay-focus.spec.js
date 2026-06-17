// @ts-check
const { test, expect } = require('@playwright/test');

async function dismissOnboardingIfPresent(page) {
    const card = page.locator('.onboarding-card');
    if (await card.count()) {
        await page.locator('.onboarding-skip').click();
        await expect(card).toHaveCount(0, { timeout: 5000 });
    }
}

test.describe('dashboard overlay focus', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/');
        await page.waitForSelector('.bookmark-link', { timeout: 15_000 });
        await dismissOnboardingIfPresent(page);
    });

    test('search shortcut moves focus into search panel', async ({ page }) => {
        await page.keyboard.press('>');
        await expect(page.locator('#shortcut-search.show')).toBeVisible({ timeout: 5000 });

        await expect.poll(async () => {
            return page.evaluate(() => {
                const root = document.getElementById('shortcut-search');
                const active = document.activeElement;
                return Boolean(root && active instanceof Element && root.contains(active));
            });
        }).toBe(true);
    });

    test('cheat sheet shortcut moves focus into modal', async ({ page }) => {
        await page.keyboard.press('!');
        await expect(page.locator('#app-modal.show')).toBeVisible({ timeout: 5000 });

        await expect.poll(async () => {
            return page.evaluate(() => {
                const modal = document.getElementById('app-modal');
                const active = document.activeElement;
                return Boolean(modal && active instanceof Element && modal.contains(active));
            });
        }).toBe(true);

        await expect(page.locator('#cheat-sheet-filter')).toBeFocused({ timeout: 3000 });
    });

    test('recent bookmarks shortcut moves focus into modal', async ({ page }) => {
        await page.keyboard.press('*');
        await expect(page.locator('#app-modal.show')).toBeVisible({ timeout: 5000 });

        await expect.poll(async () => {
            return page.evaluate(() => {
                const modal = document.getElementById('app-modal');
                const active = document.activeElement;
                return Boolean(modal && active instanceof Element && modal.contains(active));
            });
        }).toBe(true);
    });

    test('page overview shortcut moves focus into overlay', async ({ page }) => {
        await page.keyboard.press(',');
        await expect(page.locator('#page-overview-overlay')).toBeVisible({ timeout: 5000 });

        await expect.poll(async () => {
            return page.evaluate(() => {
                const overlay = document.getElementById('page-overview-overlay');
                const active = document.activeElement;
                return Boolean(overlay && active instanceof Element && overlay.contains(active));
            });
        }).toBe(true);
    });

    test('omnibox shortcut moves focus into overlay input', async ({ page }) => {
        await page.keyboard.press('&');
        await expect(page.locator('#omnibox-overlay')).toBeVisible({ timeout: 5000 });
        await expect(page.locator('.omnibox-input')).toBeFocused({ timeout: 3000 });
    });

    test('tag cloud shortcut moves focus into modal', async ({ page }) => {
        const eligible = await page.evaluate(() => {
            const toggle = document.getElementById('tag-cloud-toggle');
            return Boolean(toggle?.classList.contains('is-eligible'));
        });
        test.skip(!eligible, 'tag cloud not eligible in this environment');

        await page.keyboard.press('/');
        await expect(page.locator('#tag-cloud-modal:not([hidden])')).toBeVisible({ timeout: 5000 });

        await expect.poll(async () => {
            return page.evaluate(() => {
                const modal = document.getElementById('tag-cloud-modal');
                const active = document.activeElement;
                return Boolean(modal && active instanceof Element && modal.contains(active));
            });
        }).toBe(true);
    });
});
