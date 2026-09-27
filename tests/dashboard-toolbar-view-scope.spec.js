// @ts-check
const { test, expect } = require('./fixtures');
const {
    dismissOnboardingIfPresent,
    dismissBlockingOverlays,
    markInboxTutorialSeen,
} = require('./e2e-helpers');

/**
 * The quick-action toolbar (+add / >search / :commands / ?finders /
 * *recent / !help / .fold, plus the search-flow-hint that advertises their
 * keys) belongs to the bookmarks dashboard. A full-container view (config,
 * health, inbox) owns the whole screen instead, so the toolbar -- and six of
 * its seven shortcuts -- go inert there and come back the moment the view
 * closes. What's New sits outside .button-container and is left alone in
 * every view.
 *
 * ! is the one button shortcut that stays live everywhere: it opens the
 * keyboard cheat sheet, which is exactly the kind of thing you want reachable
 * from inside a view with no other way out. Shift+<letter> view switches and
 * the 1-9 page switch are not buttons at all and were never disabled --
 * these tests just confirm the toolbar change did not catch them too.
 */

async function loadDashboard(page) {
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
}

async function openConfig(page) {
    await loadDashboard(page);
    await page.keyboard.press('Shift+S');
    await expect.poll(() => page.evaluate(() => window.dashboardInstance?.activeView)).toBe('config');
}

/** Shift+H: the Bookmarks view, on its broken ones. */
async function openBookmarksView(page) {
    await loadDashboard(page);
    await page.keyboard.press('Shift+H');
    await expect.poll(() => page.evaluate(() => window.dashboardInstance?.activeView)).toBe('library');
}

async function openInbox(page) {
    await loadDashboard(page);
    await markInboxTutorialSeen(page);
    await page.evaluate(() => { window.dashboardInstance.settings.inboxEnabled = true; });
    await page.locator('#page-nav-inbox-btn').click();
    await expect.poll(() => page.evaluate(() => window.dashboardInstance?.activeView)).toBe('inbox');
}

const VIEWS = [
    { name: 'config', open: openConfig, layoutClass: 'config-layout' },
    { name: 'the Bookmarks view', open: openBookmarksView, layoutClass: 'library-layout' },
    { name: 'inbox', open: openInbox, layoutClass: 'inbox-layout' },
];

test.describe('the header actions, and what the keys do inside a view', () => {
    test('the four actions stand in the header on the dashboard', async ({ page }) => {
        await loadDashboard(page);
        // Two of the four are off on a fresh install (see
        // settings_defaults_test.go): Recent and Help, from when the bar would
        // have been crowded. Switch them on to check each can appear.
        await page.evaluate(() => {
            const d = window.dashboardInstance;
            d.settings.showRecentButton = true;
            d.settings.showCheatSheetButton = true;
            d.setupDOM();
        });
        await expect(page.locator('.header-shortcuts')).toBeVisible();
        await expect(page.locator('#quick-add-toolbar-btn')).toBeVisible();
        await expect(page.locator('#search-button')).toBeVisible();
        await expect(page.locator('#recent-bookmarks-button')).toBeVisible();
        await expect(page.locator('#help-button')).toBeVisible();
        await expect(page.locator('#whats-new-btn')).toBeVisible();
    });

    /*
     * They stay in every view.
     *
     * While they were a dock pinned over the grid they belonged to the grid,
     * and config, health and inbox hid them. In the header they are chrome like
     * the destinations beside them — and hiding them left a hole in the row,
     * because everything to their right kept its place.
     */
    for (const { name, open, layoutClass } of VIEWS) {
        test(`the actions stay in the header in ${name}`, async ({ page }) => {
            await open(page);
            await expect(page.locator(`#dashboard-layout.${layoutClass}`)).toBeVisible();
            await expect(page.locator('.header-shortcuts')).toBeVisible();
            await expect(page.locator('#search-button')).toBeVisible();
            await expect(page.locator('#whats-new-btn')).toBeVisible();
        });
    }

    // Search, commands, finders and recents open from every view now; quick
    // add is the one that stays with the bookmark grid.
    test('> opens search inside a view', async ({ page }) => {
        await openConfig(page);
        await page.keyboard.press('>');
        await expect(page.locator('#shortcut-search.show')).toBeVisible();
        expect(await page.evaluate(() => window.dashboardInstance.activeView)).toBe('config');
    });

    test('a disabled shortcut (+) does nothing inside a view', async ({ page }) => {
        await openConfig(page);
        await page.keyboard.press('+');
        // Nothing to poll for -- the point is that nothing happens. A fixed
        // wait is the only way to see a key that is supposed to do nothing.
        await page.waitForTimeout(300);
        const opened = await page.evaluate(
            () => document.getElementById('shortcut-search')?.classList.contains('show') === true
                || Boolean(document.querySelector('.modal-overlay.show')),
        );
        expect(opened).toBe(false);
        expect(await page.evaluate(() => window.dashboardInstance.activeView)).toBe('config');
    });

    test('! still opens the keyboard cheat sheet inside a view', async ({ page }) => {
        await openConfig(page);
        await page.keyboard.press('!');
        await expect(page.locator('.keyboard-cheat-sheet')).toBeVisible({ timeout: 10_000 });
    });

    test('a Shift view-switch and a digit page-switch both still work from inside a view', async ({ page }) => {
        await openConfig(page);

        // Shift+H switches views even while sitting inside a different one.
        await page.keyboard.press('Shift+H');
        await expect.poll(() => page.evaluate(() => window.dashboardInstance?.activeView)).toBe('library');

        // A digit switches pages, which also returns to the bookmarks grid --
        // the actions should be back too. They live in the header band now;
        // .button-container is the empty anchor the flow hint hangs from and
        // has no box of its own to be visible by.
        await page.keyboard.press('1');
        await expect.poll(() => page.evaluate(() => window.dashboardInstance?.activeView)).toBe('bookmarks');
        await expect(page.locator('.header-shortcuts')).toBeVisible();
    });
});
