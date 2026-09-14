// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * The actions live in the header, not on a bar floating over the grid.
 *
 * They sat in .button-container, a slab pinned to a corner of the viewport, so
 * the things you do here were somewhere else entirely from the places you go.
 * They are one control beside the destinations now.
 *
 * Two things had to survive the move, and both are the point of these tests:
 * which buttons are drawn is still the reader's, through the same settings;
 * and a button switched off never takes its keyboard shortcut with it. The
 * handlers are on the document and were never asked which buttons are shown —
 * that is worth pinning, because moving the markup is exactly the kind of
 * change that quietly couples them.
 */
const IDS = [
    'quick-add-toolbar-btn', 'search-button', 'commands-button', 'finders-button',
    'recent-bookmarks-button', 'help-button', 'collapse-all-button',
];

async function openDashboard(page) {
    await page.setViewportSize({ width: 1500, height: 900 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('.bookmark-link', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
}

test('every action button is in the header', async ({ page }) => {
    await openDashboard(page);

    const placed = await page.evaluate((ids) => ids.map((id) =>
        [id, Boolean(document.querySelector(`.header-shortcuts #${id}`))]), IDS);
    for (const [id, inHeader] of placed) {
        expect(inHeader, `${id} is not in the header`).toBe(true);
    }
});

test('the header stays one row, and nothing is pushed off it', async ({ page }) => {
    await openDashboard(page);

    const fit = await page.evaluate(() => {
        const actions = document.querySelector('.header-actions');
        const header = document.querySelector('.header-top');
        const config = document.querySelector('.config-link');
        const r = config.getBoundingClientRect();
        return {
            overflow: Math.round(actions.scrollWidth - actions.clientWidth),
            sameRow: Math.round(actions.getBoundingClientRect().top) === Math.round(header.getBoundingClientRect().top),
            configOnScreen: r.width > 0 && r.right <= window.innerWidth,
        };
    });

    // The seven buttons overflowed the actions by 120px when it was content-
    // sized, and the config icon left the screen with free space beside it.
    expect(fit.overflow, 'the action row overflows').toBe(0);
    expect(fit.sameRow, 'the actions dropped onto a second row').toBe(true);
    expect(fit.configOnScreen, 'the config button was pushed off screen').toBe(true);
});

test('switching a button off does not switch off its key', async ({ page }) => {
    await openDashboard(page);

    // Recent bookmarks is on * and has a button. Turn the button off.
    await page.evaluate(async () => {
        const d = window.dashboardInstance;
        d.settings.showRecentButton = false;
        d.setupDOM?.();
        await d.saveSettings?.();
    });
    await expect(page.locator('#recent-bookmarks-button')).toBeHidden();

    // The key still opens it: the button is a way in, not the only one.
    await page.keyboard.press('Shift+Digit8');
    await expect(page.locator('#app-modal.show .recent-bookmarks-modal'))
        .toBeVisible({ timeout: 15_000 });
});

test('the buttons the reader turned off are not drawn', async ({ page }) => {
    await openDashboard(page);

    // Commands and finders default to off since the three doors became one.
    const hidden = await page.evaluate(() => ['commands-button', 'finders-button']
        .map((id) => window.getComputedStyle(document.getElementById(id)).display));
    expect(hidden, 'a button the setting hides is drawn anyway').toEqual(['none', 'none']);
});
