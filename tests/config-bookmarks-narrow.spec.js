// @ts-check
const { test, expect } = require('./fixtures');
const { openBookmarks } = require('./config-bookmarks-helpers');

const locked = (page) => page.evaluate(() => window.ScrollLock.holders.size);

test.describe('the workbench on a narrow screen', () => {
    test('below 1200px the panel is a drawer that e opens and Escape closes', async ({ page }) => {
        await page.setViewportSize({ width: 1000, height: 800 });
        await openBookmarks(page);
        const panel = page.locator('#config-bm-panel');
        await expect(panel).toBeHidden();
        await page.locator('#config-bm-list').click({ position: { x: 5, y: 5 } });
        await page.keyboard.press('j');
        await page.keyboard.press('e');
        await expect(panel).toBeVisible();
        await expect(page.locator('[data-bm-scrim]')).toBeVisible();
        expect(await locked(page)).toBeGreaterThan(0);
        // The first Escape leaves the field for its row; the second closes.
        await page.keyboard.press('Escape');
        await expect(page.locator('#config-bm-panel [data-bm-field="name"]')).not.toBeFocused();
        await page.keyboard.press('Escape');
        await expect(panel).toBeHidden();
        expect(await locked(page)).toBe(0);
        // Escape closed the drawer, not the view.
        await expect(page.locator('#config-bm-list')).toBeVisible();
    });

    test('below 800px the rail is a sheet behind a Filters button', async ({ page }) => {
        await page.setViewportSize({ width: 700, height: 800 });
        await openBookmarks(page);
        await expect(page.locator('#config-bm-rail')).toBeHidden();
        await page.click('[data-bm-open-sheet]');
        await expect(page.locator('#config-bm-rail')).toBeVisible();
        expect(await locked(page)).toBeGreaterThan(0);
        // Right of the sheet, which covers the scrim's left edge.
        await page.click('[data-bm-scrim]', { position: { x: 680, y: 400 } });
        await expect(page.locator('#config-bm-rail')).toBeHidden();
        expect(await locked(page)).toBe(0);
    });

    test('the Filters button counts what is on', async ({ page }) => {
        await page.setViewportSize({ width: 700, height: 800 });
        await openBookmarks(page);
        await page.click('[data-bm-open-sheet]');
        await page.locator('#config-bm-rail [data-bm-rail="page"]').first().click();
        await page.keyboard.press('Escape');
        await expect(page.locator('[data-bm-open-sheet]')).toContainText('1');
    });

    test('leaving config releases the lock', async ({ page }) => {
        await page.setViewportSize({ width: 1000, height: 800 });
        await openBookmarks(page);
        await page.locator('#config-bm-list').click({ position: { x: 5, y: 5 } });
        await page.keyboard.press('j');
        await page.click('[data-bm-open-drawer]');
        expect(await locked(page)).toBeGreaterThan(0);
        await page.evaluate(() => window.dashboardInstance.config.closeConfigView());
        await expect.poll(() => locked(page)).toBe(0);
    });

    test('the drawer stays open while a field is saved', async ({ page }) => {
        let posts = 0;
        await page.route('**/api/bookmarks?page=*', async (route) => {
            if (route.request().method() !== 'POST') return route.fallback();
            posts += 1;
            return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
        });
        await page.setViewportSize({ width: 1000, height: 800 });
        await openBookmarks(page);
        await page.locator('#config-bm-list').click({ position: { x: 5, y: 5 } });
        await page.keyboard.press('j');
        await page.keyboard.press('e');
        const panel = page.locator('#config-bm-panel');
        await expect(panel).toBeVisible();
        await page.locator('#config-bm-panel [data-bm-field="note"]').fill('saved in the drawer');
        await page.keyboard.press('Tab');
        await expect.poll(() => posts).toBeGreaterThan(0);
        // The save returns only once the refresh after it has repainted.
        await expect.poll(() => page.evaluate(() => window.dashboardInstance.config._bmPanelSaving)).toBe(null);
        await expect(panel).toBeVisible();
        await expect(page.locator('[data-bm-scrim]')).toBeVisible();
        expect(await locked(page)).toBeGreaterThan(0);
    });

    test('Escape from a bulk control leaves it, then closes the drawer', async ({ page }) => {
        await page.setViewportSize({ width: 1000, height: 800 });
        await openBookmarks(page);
        await page.locator('#config-bm-list').click({ position: { x: 5, y: 5 } });
        for (let i = 0; i < 2; i += 1) {
            await page.keyboard.press('j');
            await page.keyboard.press('x');
        }
        await page.click('[data-bm-open-drawer]');
        const panel = page.locator('#config-bm-panel');
        await expect(panel).toHaveAttribute('data-bm-panel-mode', 'bulk');
        const tags = panel.locator('[data-bm-bulk-field="tags"]');
        await tags.click();
        // Suggestions, when they are up, take the first Escape.
        const suggestions = page.locator('.tag-ac-dropdown');
        if (await suggestions.isVisible()) {
            await page.keyboard.press('Escape');
            await expect(suggestions).toBeHidden();
            await expect(tags).toBeFocused();
        }
        await page.keyboard.press('Escape');
        await expect(tags).not.toBeFocused();
        await expect(panel).toBeVisible();
        await panel.locator('[data-bm-bulk-field="checkMode"]').focus();
        await page.keyboard.press('Escape');
        await expect(panel).toBeHidden();
        expect(await locked(page)).toBe(0);
    });
});
