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
const IDS = ['quick-add-toolbar-btn', 'search-button', 'help-button'];

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

    // The cheat sheet is on ! and has a button. Turn the button off.
    await page.evaluate(async () => {
        const d = window.dashboardInstance;
        d.settings.showCheatSheetButton = false;
        d.setupDOM?.();
        await d.saveSettings?.();
    });
    await expect(page.locator('#help-button')).toBeHidden();

    // The key still opens it: the button is a way in, not the only one.
    await page.keyboard.press('Shift+Digit1');
    await expect(page.locator('#app-modal.show .keyboard-cheat-sheet-modal'))
        .toBeVisible({ timeout: 15_000 });
});

/*
 * Commands, finders, fold-all and recent bookmarks are not in the header.
 *
 * Three buttons is a row you can read; seven was a strip. Their keys are
 * untouched — : and ? open the panel, . folds the categories and * opens the
 * recents, from anywhere — which is the same bargain every switched-off button
 * already makes.
 */
test('the row carries three actions, and not the other four', async ({ page }) => {
    await openDashboard(page);

    const gone = ['commands-button', 'finders-button', 'collapse-all-button', 'recent-bookmarks-button'];
    const inHeader = await page.evaluate((ids) =>
        ids.map((id) => Boolean(document.querySelector(`.header-shortcuts #${id}`))), gone);
    expect(inHeader, 'a button that left the header is back in it').toEqual([false, false, false, false]);
});

test('the buttons the reader turned off are not drawn', async ({ page }) => {
    await openDashboard(page);

    /*
     * Switched off here rather than leaning on the default: these specs share a
     * data directory, and a sibling turns every action on to read their order,
     * so a test that reads the default reads whatever ran before it.
     */
    await page.evaluate(async () => {
        const d = window.dashboardInstance;
        d.settings.showAddBookmarkButton = false;
        d.settings.showCheatSheetButton = false;
        d.setupDOM?.();
        await d.saveSettings?.();
    });
    await page.waitForTimeout(300);

    const hidden = await page.evaluate(() => ['quick-add-toolbar-btn', 'help-button']
        .map((id) => window.getComputedStyle(document.getElementById(id)).display));
    expect(hidden, 'a button the setting hides is drawn anyway').toEqual(['none', 'none']);
});


/** Turn every action on, so the row can be read in full. */
async function showEveryAction(page) {
    await page.evaluate(async () => {
        const d = window.dashboardInstance;
        Object.assign(d.settings, {
            showAddBookmarkButton: true, showSearchButton: true, showCheatSheetButton: true,
        });
        d.setupDOM?.();
        await d.saveSettings?.();
    });
    await page.waitForTimeout(400);
}

/*
 * One order, whatever the markup says.
 *
 * The buttons arrive in the two groups the dock split them into, and which of
 * them are drawn is a setting — so an order taken from the DOM would change as
 * buttons are switched on and off. Add comes first because it is the one that
 * makes something, then search, then the sheet that says what every key does.
 */
test('the actions are always in the same order', async ({ page }) => {
    await openDashboard(page);
    await showEveryAction(page);

    const keys = await page.evaluate(() =>
        [...document.querySelectorAll('.header-shortcuts .search-button')]
            .filter((b) => window.getComputedStyle(b).display !== 'none')
            .map((b) => ({ x: b.getBoundingClientRect().left,
                           key: b.querySelector('.search-button-icon')?.textContent.trim() }))
            .sort((a, b) => a.x - b.x)
            .map((b) => b.key)
            .join(' '));

    expect(keys).toBe('+ > !');
});

/*
 * An action looks like a header control, not like a dock button.
 *
 * They arrived wearing what they wore while floating over the grid — a filled
 * plate at 74% alpha, a word beside every icon, a wider box — which beside the
 * flat destination buttons read as two kinds of thing in one bar. Read off the
 * destinations rather than asserting literals: what matters is that the two
 * agree, not what either happens to be.
 */
test('an action is drawn like the destinations beside it', async ({ page }) => {
    await openDashboard(page);
    await showEveryAction(page);

    const [action, destination] = await page.evaluate(() => {
        const read = (el) => {
            const s = window.getComputedStyle(el);
            return { background: s.backgroundColor, color: s.color, radius: s.borderTopLeftRadius,
                     padding: s.padding, fontSize: s.fontSize, fontWeight: s.fontWeight };
        };
        return [read(document.querySelector('.header-shortcuts #search-button')),
                read(document.querySelector('.pages-link--icon .pages-link-anchor'))];
    });

    expect(action.background, 'the action still carries the dock plate').toBe(destination.background);
    expect(action.color).toBe(destination.color);
    expect(action.radius).toBe(destination.radius);
    expect(action.padding).toBe(destination.padding);
    expect(action.fontSize).toBe(destination.fontSize);
    expect(action.fontWeight).toBe(destination.fontWeight);
});

test('an action shows its key, not a word', async ({ page }) => {
    await openDashboard(page);
    await showEveryAction(page);

    // The word survives for a screen reader, in the button's own aria-label.
    const label = await page.evaluate(() => {
        const btn = document.querySelector('.header-shortcuts #help-button');
        return { wordShown: window.getComputedStyle(btn.querySelector('.search-button-label')).display,
                 named: (btn.getAttribute('aria-label') || '').length > 0 };
    });
    expect(label.wordShown, 'the labels are back beside the icons').toBe('none');
    expect(label.named, 'the button has no accessible name').toBe(true);
});
