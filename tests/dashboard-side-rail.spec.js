// @ts-check
const { test, expect } = require('./fixtures');

test.describe('dashboard side rail discoverability (D7)', () => {
    test('shows legend and beside-rail hints when side-left is active', async ({ page }) => {
        await page.goto('/');
        await page.waitForSelector('.bookmark-link', { timeout: 15_000 });

        await page.evaluate(async () => {
            const d = window.dashboardInstance;
            localStorage.removeItem('nextdash:side-rail-legend-v1');
            localStorage.removeItem('nextdash:search-flow-hint-side-rail-v1');
            d.settings.buttonBarPosition = 'side-left';
            d.settings.showAddBookmarkButton = true;
            d.settings.showRecentButton = true;
            d.settings.showCheatSheetButton = true;
            d.settings.showTagCloudButton = true;
            d.settings.onboardingCompleted = true;
            d.onboardingStartedInSession = false;
            d.setupDOM?.();
        });

        await expect(page.locator('#side-rail-legend')).toBeVisible();
        const legendCount = await page.locator('#side-rail-legend .side-rail-legend-item').count();
        expect(legendCount).toBeGreaterThanOrEqual(4);
        await expect(page.locator('#search-flow-hint')).toBeVisible();

        const hintBox = await page.locator('#search-flow-hint').boundingBox();
        const railBox = await page.locator('.button-container').boundingBox();
        expect(hintBox && railBox).toBeTruthy();
        if (hintBox && railBox) {
            expect(hintBox.x).toBeGreaterThan(railBox.x + railBox.width - 2);
        }

        await page.locator('.side-rail-legend-dismiss').click();
        await expect(page.locator('#side-rail-legend')).toBeHidden();
    });

    test('hides legend when switching back to bottom bar', async ({ page }) => {
        await page.goto('/');
        await page.waitForSelector('.bookmark-link', { timeout: 15_000 });

        await page.evaluate(async () => {
            const d = window.dashboardInstance;
            localStorage.removeItem('nextdash:side-rail-legend-v1');
            d.settings.buttonBarPosition = 'side-left';
            d.settings.onboardingCompleted = true;
            d.onboardingStartedInSession = false;
            d.setupDOM?.();
            d.syncSideRailDiscoverability?.();
        });
        await expect(page.locator('#side-rail-legend')).toBeVisible();

        await page.evaluate(() => {
            const d = window.dashboardInstance;
            d.settings.buttonBarPosition = 'bottom';
            d.setupDOM?.();
            d.syncSideRailDiscoverability?.();
        });
        await expect(page.locator('#side-rail-legend')).toBeHidden();
    });

    test('tag cloud toggle stays visible when recent and help are hidden', async ({ page }) => {
        await page.goto('/');
        await page.waitForSelector('.bookmark-link', { timeout: 15_000 });

        await page.evaluate(async () => {
            const d = window.dashboardInstance;
            const bm = d.bookmarks?.[0] || d.allBookmarks?.[0];
            if (bm && (!Array.isArray(bm.tags) || bm.tags.length === 0)) {
                bm.tags = ['e2e'];
            }
            d.settings.buttonBarPosition = 'side-left';
            d.settings.showTagCloudButton = true;
            d.settings.showRecentButton = false;
            d.settings.showCheatSheetButton = false;
            d.setupDOM?.();
            window.DashboardTagCloud?.syncFromSettings?.();
        });

        await expect(page.locator('#tag-cloud-toggle-btn')).toBeVisible();
        const parentClass = await page.locator('#tag-cloud-toggle-btn').evaluate((el) => el.parentElement?.className || '');
        expect(parentClass).toContain('button-container');
    });
});
