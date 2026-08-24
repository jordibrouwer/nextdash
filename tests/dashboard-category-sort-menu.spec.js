const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissBlockingOverlays, dismissOnboardingIfPresent } = require('./e2e-helpers');

/**
 * Four sort buttons sat on every category header, and the header repeats per
 * category — together they took more width than the bookmark names beside them.
 * One button plus a ⋯ now, and in manual order (the default) not even that.
 */
async function load(page) {
    await page.setViewportSize({ width: 1400, height: 900 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('.bookmark-link', { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForSelector('.category-sort-controls', { timeout: 15_000 });
    // The icon prefetch overlay covers the page while it runs.
    await page.evaluate(() => document.getElementById('favicon-prefetch-overlay')?.remove());
}

const strip = (page) => page.evaluate(() => {
    const c = document.querySelector('.category-sort-controls');
    return { text: c.textContent.trim(), width: Math.round(c.getBoundingClientRect().width) };
});

test.describe('category sort menu', () => {
    test('manual order shows only the menu button', async ({ page }) => {
        await load(page);
        const s = await strip(page);
        expect(s.text).toBe('⋯');
        // The four buttons were around 90px; this is the whole point.
        expect(s.width).toBeLessThan(30);
    });

    test('the menu lists every mode and marks the active one', async ({ page }) => {
        await load(page);
        await page.locator('.category-sort-menu-btn').first().click();
        const menu = page.locator('.category-sort-menu');
        await expect(menu).toBeVisible();
        await expect(menu.locator('.category-sort-menu-item')).toHaveText(['Manual', 'A–Z', 'Rec', 'New', 'Top']);
        await expect(menu.locator('.category-sort-menu-item.is-active')).toHaveText('Manual');
    });

    test('choosing a mode puts that button in front of the menu', async ({ page }) => {
        await load(page);
        await page.locator('.category-sort-menu-btn').first().click();
        await page.locator('.category-sort-menu-item[data-sort-mode="opens"]').first().click();

        await expect.poll(async () => (await strip(page)).text, { timeout: 10_000 }).toBe('Top⋯');
        // Still far below the four-button strip it replaced.
        expect((await strip(page)).width).toBeLessThan(70);
    });

    test('Escape closes the menu and returns focus to its button', async ({ page }) => {
        await load(page);
        await page.locator('.category-sort-menu-btn').first().click();
        await expect(page.locator('.category-sort-menu')).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(page.locator('.category-sort-menu')).toHaveCount(0);
        const focused = await page.evaluate(() =>
            document.activeElement?.classList.contains('category-sort-menu-btn'));
        expect(focused).toBe(true);
    });

    test('only one menu is open at a time', async ({ page }) => {
        await load(page);
        const buttons = page.locator('.category-sort-menu-btn');
        if (await buttons.count() < 2) test.skip(true, 'needs two categories');
        await buttons.nth(0).click();
        await buttons.nth(1).click();
        await expect(page.locator('.category-sort-menu')).toHaveCount(1);
    });
});
