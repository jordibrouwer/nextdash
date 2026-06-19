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
    const gridPromoClose = page.locator('.dashboard-grid-kbd-promo-close');
    if (await gridPromoClose.count()) {
        await page.evaluate(() => window.DashboardGridKeyboardPromo?.confirmPromo?.());
        await expect(page.locator('.dashboard-grid-kbd-promo')).toHaveCount(0, { timeout: 3000 });
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

    test('closing action popovers restores keyboard selection on same bookmark', async ({ page }) => {
        const count = await page.locator('.bookmark-link:not(.recent-bookmark-link)').count();
        test.skip(count < 2, 'needs at least two bookmarks');

        await page.keyboard.press('ArrowDown');
        const idxBefore = await page.evaluate(() => (
            window.dashboardInstance?.keyboardNavigation?.currentIndex ?? -1
        ));
        expect(idxBefore).toBeGreaterThan(0);

        for (const { key, cleanup } of [
            { key: 'Shift+T', cleanup: '_tagPopoverCleanup' },
            { key: 'Shift+M', cleanup: '_movePopoverCleanup' },
            { key: 'Shift+D', cleanup: '_deletePopoverCleanup' },
        ]) {
            await page.keyboard.press(key);
            await expect(page.locator('#tag-popover, #move-popover, #delete-popover').first()).toBeVisible({ timeout: 3000 });
            await page.evaluate((fn) => window.dashboardInstance?.[fn]?.(), cleanup);
            await expect(page.locator('#tag-popover, #move-popover, #delete-popover')).toHaveCount(0, { timeout: 3000 });
            await expect.poll(async () => page.evaluate(() => (
                window.dashboardInstance?.keyboardNavigation?.currentIndex ?? -1
            ))).toBe(idxBefore);
            await expect.poll(async () => page.evaluate(() => (
                document.querySelectorAll('.bookmark-link.keyboard-selected').length
            ))).toBe(1);
        }
    });

    test('Shift+T opens tag popover without opening search', async ({ page }) => {
        await page.keyboard.press('Shift+T');
        await expect(page.locator('#tag-popover')).toBeVisible({ timeout: 3000 });
        await expect(page.locator('#shortcut-search.show')).toHaveCount(0);
        await expect.poll(async () => page.evaluate(() => (
            document.activeElement?.id === 'tag-popover'
        ))).toBe(true);
    });

    test('tag popover marks current bookmark tags with is-current', async ({ page }) => {
        const tagName = `pw-tag-${Date.now()}`;
        await page.evaluate(async (tag) => {
            const d = window.dashboardInstance;
            const kn = d?.keyboardNavigation;
            const row = kn?.navigableElements?.[kn.currentIndex];
            const bookmark = kn?.getSelectedBookmark?.();
            if (!bookmark || !row) throw new Error('no bookmark selected');
            bookmark.tags = [...(bookmark.tags || []), tag];
            const ref = d.resolveBookmarkReference(bookmark);
            d.syncEditedBookmarkAcrossCollections(ref, bookmark.url || '');
            await d.saveBookmarkOrder();
            row.setAttribute('data-bookmark-tags', (bookmark.tags || []).join(','));
        }, tagName);

        await page.keyboard.press('Shift+T');
        const currentItem = page.locator(`#tag-popover .move-popover-item[data-tag="${tagName}"]`);
        await expect(currentItem).toBeVisible({ timeout: 3000 });
        await expect(currentItem).toHaveClass(/is-current/);
        await expect(currentItem.locator('.move-popover-check')).toHaveText('✓');
        await expect(page.locator('.tag-popover-current-chip')).toContainText(`#${tagName}`);

        await page.evaluate(() => window.dashboardInstance?._tagPopoverCleanup?.());
    });

    test('tag popover arrow keys move focus inside list', async ({ page }) => {
        await page.keyboard.press('Shift+T');
        await expect(page.locator('#tag-popover')).toBeVisible({ timeout: 3000 });
        await expect.poll(async () => page.evaluate(() => (
            document.activeElement?.id === 'tag-popover'
        ))).toBe(true);

        const itemCount = await page.locator('#tag-popover .move-popover-item').count();
        if (itemCount > 1) {
            const before = await page.evaluate(() => (
                document.getElementById('tag-popover')?.getAttribute('aria-activedescendant') || ''
            ));
            await page.keyboard.press('ArrowDown');
            await expect.poll(async () => page.evaluate(() => (
                document.getElementById('tag-popover')?.getAttribute('aria-activedescendant') || ''
            ))).not.toBe(before);
        }

        await page.evaluate(() => window.dashboardInstance?._tagPopoverCleanup?.());
    });

    test('dashboard stays inert while tag popover open', async ({ page }) => {
        await page.keyboard.press('Shift+T');
        await expect(page.locator('#tag-popover')).toBeVisible({ timeout: 3000 });
        await expect.poll(async () => page.evaluate(() => (
            document.getElementById('dashboard-layout')?.hasAttribute('inert') === true
        ))).toBe(true);

        await page.evaluate(() => window.dashboardInstance?._tagPopoverCleanup?.());
        await expect(page.locator('#tag-popover')).toHaveCount(0, { timeout: 3000 });
        await expect.poll(async () => page.evaluate(() => (
            document.getElementById('dashboard-layout')?.hasAttribute('inert') === false
        ))).toBe(true);
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

    test('held G shows first-time g-jump promo balloon', async ({ page }) => {
        await page.evaluate(() => {
            localStorage.removeItem('nextdash:dashboard-g-jump-promo-confirmed-v1');
        });
        await dismissBlockingOverlays(page);

        await page.keyboard.down('g');
        await page.waitForTimeout(350);
        await expect(page.locator('.dashboard-g-jump-promo')).toBeVisible({ timeout: 3000 });
        await page.keyboard.up('g');
        await page.evaluate(() => window.DashboardGJumpPromo?.confirmPromo?.());
        await expect(page.locator('.dashboard-g-jump-promo')).toHaveCount(0, { timeout: 3000 });
    });
});
