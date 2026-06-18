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

async function closeSearch(page) {
    await page.evaluate(() => window.dashboardInstance?.searchComponent?.closeSearch?.());
    await expect(page.locator('#shortcut-search.show')).toHaveCount(0, { timeout: 3000 });
}

async function selectFirstBookmark(page) {
    await page.keyboard.press('ArrowDown');
    await expect.poll(async () => page.evaluate(() => (
        window.dashboardInstance?.keyboardNavigation?.currentIndex ?? -1
    ))).toBeGreaterThanOrEqual(0);
}

test.describe('dashboard grid shortcuts', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/');
        await page.waitForSelector('.bookmark-link', { timeout: 15_000 });
        await dismissOnboardingIfPresent(page);
        await dismissBlockingOverlays(page);
        await selectFirstBookmark(page);
    });

    test('Shift+M opens move popover without opening search', async ({ page }) => {
        await page.keyboard.press('Shift+M');
        await expect(page.locator('#move-popover')).toBeVisible({ timeout: 3000 });
        await expect(page.locator('#shortcut-search.show')).toHaveCount(0);
    });

    test('Shift+D opens delete popover without opening search', async ({ page }) => {
        await page.keyboard.press('Shift+D');
        await expect(page.locator('#delete-popover')).toBeVisible({ timeout: 3000 });
        await expect(page.locator('#shortcut-search.show')).toHaveCount(0);
    });

    test('semicolon opens inline edit for selected bookmark', async ({ page }) => {
        await page.keyboard.press(';');
        await expect(page.locator('.bookmark-inline-editing')).toBeVisible({ timeout: 3000 });
    });

    test('grid shortcuts work after closing search overlay', async ({ page }) => {
        await page.keyboard.press('>');
        await expect(page.locator('#shortcut-search.show')).toBeVisible({ timeout: 3000 });
        await closeSearch(page);

        await selectFirstBookmark(page);
        await page.keyboard.press('Shift+M');
        await expect(page.locator('#move-popover')).toBeVisible({ timeout: 3000 });
        await expect(page.locator('#shortcut-search.show')).toHaveCount(0);
    });

    test('dashboard stays inert while move popover open', async ({ page }) => {
        await page.keyboard.press('Shift+M');
        await expect(page.locator('#move-popover')).toBeVisible({ timeout: 3000 });
        await expect.poll(async () => page.evaluate(() => (
            document.getElementById('dashboard-layout')?.hasAttribute('inert') === true
        ))).toBe(true);

        await page.evaluate(() => window.dashboardInstance?._movePopoverCleanup?.());
        await expect(page.locator('#move-popover')).toHaveCount(0, { timeout: 3000 });
        await expect.poll(async () => page.evaluate(() => (
            document.getElementById('dashboard-layout')?.hasAttribute('inert') === false
        ))).toBe(true);
    });

    test('quick tap G opens shortcut search for g bookmarks', async ({ page }) => {
        await page.keyboard.press('g');
        await expect(page.locator('#shortcut-search.show')).toBeVisible({ timeout: 3000 });
        await expect.poll(async () => page.evaluate(() => (
            window.dashboardInstance?.searchComponent?.currentQuery || ''
        ))).toBe('G');
    });

    test('G then digit without hold feeds shortcut query, not category jump', async ({ page }) => {
        await page.keyboard.press('g');
        await expect(page.locator('#shortcut-search.show')).toBeVisible({ timeout: 3000 });
        await page.keyboard.press('1');
        await expect.poll(async () => page.evaluate(() => (
            window.dashboardInstance?.searchComponent?.currentQuery || ''
        ))).toBe('G1');
    });

    test('held G then digit jumps category without opening search', async ({ page }) => {
        const categoryCount = await page.locator('.category').count();
        test.skip(categoryCount < 1, 'needs at least one category');

        await page.keyboard.down('g');
        await page.waitForTimeout(350);
        await page.keyboard.press('1');
        await page.keyboard.up('g');

        await expect(page.locator('#shortcut-search.show')).toHaveCount(0);
        await expect.poll(async () => page.evaluate(() => (
            window.dashboardInstance?.keyboardNavigation?.currentIndex ?? -1
        ))).toBeGreaterThanOrEqual(0);
    });
});
