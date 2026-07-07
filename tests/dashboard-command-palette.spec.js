// @ts-check
const { test, expect } = require('@playwright/test');
const { markWhatsNewSeen, dismissOnboardingIfPresent } = require('./e2e-helpers');

const COMMAND_PALETTE_PROMO_KEYS = [
    'nextdash:dashboard-quick-tag-promo-confirmed-v1',
    'nextdash:dashboard-search-promo-command-v1',
];

async function dismissBlockingOverlays(page) {
    const whatsNew = page.locator('#app-modal.show');
    if (await whatsNew.count()) {
        await page.keyboard.press('Escape');
        await expect(whatsNew).toHaveCount(0, { timeout: 3000 });
    }
    await page.evaluate(() => window.dashboardInstance?.searchComponent?.closeSearch?.());
    const searchPromo = page.locator('.dashboard-search-promo');
    if (await searchPromo.count()) {
        await searchPromo.locator('button').first().click();
        await expect(searchPromo).toHaveCount(0, { timeout: 3000 });
    }
}

async function selectCommandMatch(page, { stateId, shortcut, meta } = {}) {
    await page.evaluate(({ stateId, shortcut, meta }) => {
        const sc = window.dashboardInstance?.searchComponent;
        const idx = sc?.selectableMatches?.findIndex((match) => {
            if (stateId && match?.stateId === stateId) return true;
            if (shortcut && String(match?.shortcut || '').toUpperCase() === String(shortcut).toUpperCase()) {
                if (meta == null) return match?.type === 'command';
                return String(match?.meta || '') === String(meta);
            }
            return false;
        }) ?? -1;
        if (idx < 0) {
            throw new Error(`command match not found (${stateId || shortcut || 'unknown'})`);
        }
        sc.selectedMatchIndex = idx;
        sc.updateSelectionHighlight();
    }, { stateId, shortcut, meta });
}

test.describe('dashboard command palette', () => {
    test.describe.configure({ mode: 'serial' });

    test.beforeEach(async ({ page }) => {
        await markWhatsNewSeen(page, { extraPromoConfirmedKeys: COMMAND_PALETTE_PROMO_KEYS });
        await page.goto('/');
        await page.waitForSelector('.bookmark-link', { timeout: 15_000 });
        await dismissOnboardingIfPresent(page);
        await page.evaluate(() => {
            document.dispatchEvent(new CustomEvent('nextdash:find', { detail: { query: '' } }));
            window.dashboardInstance?._tagPopoverCleanup?.();
            window.dashboardInstance?._movePopoverCleanup?.();
            window.dashboardInstance?._deletePopoverCleanup?.();
            window.dashboardInstance?.searchComponent?.closeSearch?.();
        });
        await dismissBlockingOverlays(page);
    });

    test(':buttons add toggles add button on Enter', async ({ page }) => {
        const visibleBefore = await page.locator('#quick-add-toolbar-btn').isVisible();

        await page.keyboard.press(':');
        await page.keyboard.type('buttons add', { delay: 20 });
        await expect(page.locator('#shortcut-search.show')).toBeVisible({ timeout: 5000 });
        await selectCommandMatch(page, { stateId: 'buttons:add' });
        await page.keyboard.press('Enter');

        await expect.poll(async () => page.locator('#quick-add-toolbar-btn').isVisible(), {
            timeout: 10_000,
        }).not.toBe(visibleBefore);
    });

    test('Enter after command completion executes on next press', async ({ page }) => {
        const visibleBefore = await page.locator('#quick-add-toolbar-btn').isVisible();

        await page.keyboard.press(':');
        await page.keyboard.type('button', { delay: 20 });
        await expect(page.locator('#shortcut-search.show')).toBeVisible({ timeout: 3000 });
        await page.keyboard.press('Enter');
        await page.keyboard.press('Enter');

        await expect.poll(async () => page.locator('#quick-add-toolbar-btn').isVisible()).not.toBe(visibleBefore);
    });

    test('Enter works when match row has focus', async ({ page }) => {
        const visibleBefore = await page.locator('#quick-add-toolbar-btn').isVisible();

        await page.keyboard.press(':');
        await page.keyboard.type('buttons add', { delay: 20 });
        await page.locator('.search-match.command-entry').first().focus();
        await page.keyboard.press('Enter');

        await expect.poll(async () => page.locator('#quick-add-toolbar-btn').isVisible()).not.toBe(visibleBefore);
    });

    test(':tips off disables tips on Enter', async ({ page }) => {
        await page.keyboard.press(':');
        await page.keyboard.type('tips off', { delay: 20 });
        await expect(page.locator('#shortcut-search.show')).toBeVisible({ timeout: 3000 });
        await page.keyboard.press('Enter');

        await expect.poll(async () => page.evaluate(() => (
            window.dashboardInstance?.settings?.showTips === false
        ))).toBe(true);
    });

    test(':buttons cheatsheet stays open and label updates after toggle', async ({ page }) => {
        await page.keyboard.press(':');
        await page.keyboard.type('buttons cheatsheet', { delay: 20 });
        await expect(page.locator('#shortcut-search.show')).toBeVisible({ timeout: 3000 });

        const row = page.locator('.search-match.command-entry').first();
        const before = await row.innerText();
        await page.keyboard.press('Enter');

        await expect(page.locator('#shortcut-search.show')).toBeVisible();
        await expect.poll(async () => row.innerText()).not.toBe(before);
    });

    test(':page switches page and keeps palette open', async ({ page }) => {
        const pageCount = await page.evaluate(() => window.dashboardInstance?.pages?.length || 0);
        test.skip(pageCount < 2, 'needs at least two pages');

        const targetName = await page.evaluate(() => {
            const dash = window.dashboardInstance;
            const other = dash.pages.find((p) => !dash.samePageId(p.id, dash.currentPageId));
            return other?.name || '';
        });
        test.skip(!targetName, 'no alternate page');

        await page.keyboard.press(':');
        await page.keyboard.type(`page ${targetName}`, { delay: 15 });
        await page.keyboard.press('Enter');

        await expect(page.locator('#shortcut-search.show')).toBeVisible();
        await expect.poll(async () => page.evaluate((name) => {
            const dash = window.dashboardInstance;
            const current = dash.pages.find((p) => dash.samePageId(p.id, dash.currentPageId));
            return current?.name === name;
        }, targetName)).toBe(true);
    });

    test(':cheat closes palette and opens cheat sheet', async ({ page }) => {
        await page.keyboard.press(':');
        await page.keyboard.type('cheat', { delay: 20 });
        await expect(page.locator('#shortcut-search.show')).toBeVisible({ timeout: 3000 });
        await page.keyboard.press('Enter');

        await expect(page.locator('#shortcut-search.show')).toHaveCount(0);
        await expect(page.locator('#app-modal.show .keyboard-cheat-sheet-modal')).toBeVisible({ timeout: 3000 });
    });

    test(':overview closes palette and opens page overview', async ({ page }) => {
        const pageCount = await page.evaluate(() => window.dashboardInstance?.pages?.length || 0);
        test.skip(pageCount < 1, 'needs at least one page');

        await page.keyboard.press(':');
        await page.keyboard.type('overview', { delay: 20 });
        await expect(page.locator('#shortcut-search.show')).toBeVisible({ timeout: 3000 });
        await page.keyboard.press('Enter');

        await expect(page.locator('#shortcut-search.show')).toHaveCount(0);
        await expect(page.locator('#page-overview-overlay')).toBeVisible({ timeout: 5000 });
    });

    test(':find clear removes find-hidden tiles', async ({ page }) => {
        await page.keyboard.press(':');
        await page.keyboard.type('find test-filter-xyz', { delay: 15 });
        await page.keyboard.press('Enter');

        await page.waitForFunction(() => (
            document.querySelectorAll('#dashboard-layout .bookmark-link.find-hidden').length > 0
        ), null, { timeout: 3000 });

        await page.keyboard.press('Escape');
        await page.keyboard.press(':');
        await page.keyboard.type('find clear', { delay: 15 });
        await page.keyboard.press('Enter');

        await expect.poll(async () => page.evaluate(() => (
            document.querySelectorAll('#dashboard-layout .bookmark-link.find-hidden').length
        ))).toBe(0);
    });

    test(':category jumps to first category', async ({ page }) => {
        const categoryCount = await page.evaluate(() => (
            document.querySelectorAll('.category[data-category-id]:not([data-collapsed="true"])').length
        ));
        test.skip(categoryCount < 1, 'needs at least one expanded category');

        await page.keyboard.press(':');
        await page.keyboard.type('category 1', { delay: 15 });
        await expect(page.locator('#shortcut-search.show')).toBeVisible({ timeout: 5000 });
        await selectCommandMatch(page, { shortcut: ':CATEGORY', meta: '1' });
        await page.keyboard.press('Enter');

        await expect(page.locator('#shortcut-search.show')).toHaveCount(0, { timeout: 5000 });
        await expect.poll(async () => {
            const index = await page.evaluate(() => (
                window.dashboardInstance?.keyboardNavigation?.currentIndex ?? -1
            ));
            return index >= 0;
        }, { timeout: 10_000 }).toBe(true);
    });

    test(':buttons health toggles health link visibility', async ({ page }) => {
        const visibleBefore = await page.locator('.health-link').count();

        await page.keyboard.press(':');
        await page.keyboard.type('buttons health', { delay: 15 });
        await expect(page.locator('#shortcut-search.show')).toBeVisible({ timeout: 3000 });
        await page.keyboard.press('Enter');

        await expect.poll(async () => page.locator('.health-link').count()).not.toBe(visibleBefore);
    });

    test('lone colon shows five command groups', async ({ page }) => {
        await page.keyboard.press(':');
        await expect(page.locator('#shortcut-search.show')).toBeVisible({ timeout: 3000 });
        await expect(page.locator('.search-command-group-header')).toHaveCount(5);
    });

    test(':dark toggles auto dark mode', async ({ page }) => {
        const before = await page.evaluate(() => window.dashboardInstance?.settings?.autoDarkMode === true);

        await page.keyboard.press(':');
        await page.keyboard.type(before ? 'dark off' : 'dark on', { delay: 15 });
        await page.keyboard.press('Enter');

        await expect.poll(async () => page.evaluate(() => (
            window.dashboardInstance?.settings?.autoDarkMode === true
        ))).toBe(!before);
    });

    test(':collections toggles start today collection', async ({ page }) => {
        const before = await page.evaluate(() => (
            window.dashboardInstance?.settings?.showSmartTodayCollection !== false
        ));

        await page.keyboard.press(':');
        await page.keyboard.type(before ? 'collections today off' : 'collections today on', { delay: 15 });
        await page.keyboard.press('Enter');

        await expect.poll(async () => page.evaluate(() => (
            window.dashboardInstance?.settings?.showSmartTodayCollection !== false
        ))).toBe(!before);
    });
});
