// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissBlockingOverlays, dismissOnboardingIfPresent } = require('./e2e-helpers');

/**
 * The key legend under the dashboard grid.
 *
 * Three lines -- the cursor, finding things, adding and pages -- on for a fresh
 * install. The rows that presume the keyboard is in use stay hidden until the
 * first cursor move. Shift+Z switches the whole legend off and on, and it only
 * shows while the dashboard view itself is open: the grid's container outlives
 * a switch to the Bookmarks view, and the legend used to sit under whatever
 * replaced the grid.
 */

async function dashboard(page) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 15_000 });
    await expect(page.locator('.bookmark-link').first()).toBeAttached();
}

const legend = (page) => page.locator('.dashboard-legend');
const stored = (page) => page.evaluate(async () => {
    const response = await fetch('/api/settings');
    return (await response.json()).showGridKeyLegend;
});

test.describe('the dashboard key legend on touch screens', () => {
    for (const [name, viewport] of [['a phone', { width: 390, height: 844 }], ['a tablet', { width: 820, height: 1180 }]]) {
        test.describe(name, () => {
            test.use({ viewport, hasTouch: true, isMobile: true });

            test('is not shown: there is no keyboard to teach', async ({ page }) => {
                await dashboard(page);
                await expect(page.locator('body')).toHaveAttribute('data-touch-layout', 'true');
                await expect(page.locator('body')).toHaveAttribute('data-active-view', 'bookmarks');
                await expect(legend(page)).toBeHidden();
            });
        });
    }
});

test.describe('the dashboard key legend', () => {
    test('a fresh install shows three lines, with the keyboard rows held back', async ({ page }) => {
        await dashboard(page);
        await expect(legend(page)).toBeVisible();
        await expect(legend(page).locator('.dashboard-legend-line')).toHaveCount(3);
        // Every group names the keys a first visit needs, without a keystroke.
        const text = await legend(page).innerText();
        for (const key of ['!', '>', '/', '*', '?', ':', '1–9', 'Shift+B', 'Shift+N', 'Shift+Z']) {
            expect(text).toContain(key);
        }
        // The rows that act on a row wait until the keyboard is in use.
        const more = legend(page).locator('.dashboard-legend-more');
        expect(await more.count()).toBeGreaterThan(0);
        await expect(more.first()).toBeHidden();
        // Decorative: every key is in the cheat sheet.
        await expect(legend(page)).toHaveAttribute('aria-hidden', 'true');

        await page.keyboard.press('ArrowDown');
        await expect(more.first()).toBeVisible({ timeout: 5_000 });
        await expect(legend(page)).toContainText('Shift+E');

        await page.evaluate(() => { window.open = () => null; });
        await page.keyboard.press('Enter');
        // Opening is the end of the trip those rows were there for.
        await expect(more.first()).toBeHidden({ timeout: 5_000 });
        await expect(legend(page)).toBeVisible();
    });

    test('Shift+Z switches it off and on, and the choice is stored', async ({ page }) => {
        await dashboard(page);
        await expect(legend(page)).toBeVisible();

        await page.keyboard.press('Shift+Z');
        await expect(legend(page)).toHaveCount(0);
        await expect.poll(() => stored(page)).toBe(false);

        // Still off after a reload: it is the setting, not the screen.
        await page.reload();
        await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 15_000 });
        await expect(legend(page)).toHaveCount(0);

        await page.keyboard.press('Shift+Z');
        await expect(legend(page)).toBeVisible();
        await expect.poll(() => stored(page)).toBe(true);
    });

    test('it is gone while another view is open, and back with the dashboard', async ({ page }) => {
        await dashboard(page);
        await expect(legend(page)).toBeVisible();
        await expect(page.locator('body')).toHaveAttribute('data-active-view', 'bookmarks');

        // Shift+H opens the Bookmarks view in place; the grid's container stays.
        await page.keyboard.press('Shift+H');
        await expect(page.locator('body')).toHaveAttribute('data-active-view', 'library', { timeout: 10_000 });
        await expect(legend(page)).toBeHidden();

        await page.evaluate(() => window.dashboardInstance.setActiveView('bookmarks'));
        await expect(page.locator('body')).toHaveAttribute('data-active-view', 'bookmarks');
        await expect(legend(page)).toBeVisible();
    });
});
