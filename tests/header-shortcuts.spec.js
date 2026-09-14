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
 * Commands, finders and fold-all are not in the header.
 *
 * Four buttons is a row you can read; seven was a strip. The keys of the three
 * that left are untouched — : and ? open their panel and . folds the categories
 * from anywhere — which is the same bargain every switched-off button already
 * makes.
 */
test('the row carries four actions, and not the other three', async ({ page }) => {
    await openDashboard(page);

    const gone = ['commands-button', 'finders-button', 'collapse-all-button'];
    const inHeader = await page.evaluate((ids) =>
        ids.map((id) => Boolean(document.querySelector(`.header-shortcuts #${id}`))), gone);
    expect(inHeader, 'a button that left the header is back in it').toEqual([false, false, false]);
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
            showAddBookmarkButton: true, showSearchButton: true,
            showRecentButton: true, showCheatSheetButton: true,
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
 * makes something, then search, then what you opened last, then the sheet that
 * says what every key does.
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

    expect(keys).toBe('+ > * !');
});

/*
 * An action looks like a header control, not like a dock button.
 *
 * They arrived wearing what they wore while floating over the grid — a filled
 * plate at 74% alpha, a word beside every icon, a wider box — which beside the
 * flat destination buttons read as two kinds of thing in one bar. Read off the
 * destinations rather than asserting literals: what matters is that the two
 * agree, not what either happens to be.
 *
 * The ink is what has to agree. The box does not: the actions stand inside a
 * surround of their own, so they sit tighter in it than a lone destination sits
 * on the bare header — which is the surround's own padding doing the spacing.
 */
test('an action is drawn like the destinations beside it', async ({ page }) => {
    await openDashboard(page);
    await showEveryAction(page);

    const [action, destination] = await page.evaluate(() => {
        const read = (el) => {
            const s = window.getComputedStyle(el);
            return { background: s.backgroundColor, color: s.color,
                     fontSize: s.fontSize, fontWeight: s.fontWeight, fontFamily: s.fontFamily };
        };
        return [read(document.querySelector('.header-shortcuts #search-button')),
                read(document.querySelector('.pages-link--icon .pages-link-anchor'))];
    });

    expect(action.background, 'the action still carries the dock plate').toBe(destination.background);
    expect(action.color).toBe(destination.color);
    expect(action.fontSize).toBe(destination.fontSize);
    expect(action.fontWeight).toBe(destination.fontWeight);
    expect(action.fontFamily).toBe(destination.fontFamily);
});

/*
 * The actions are one control, and the surround is what says so.
 *
 * Three bare glyphs beside the destinations read as six destinations; the
 * design draws a box around the three that do something, and leaves the places
 * you can go standing on the header itself.
 */
test('the actions stand in a surround, the destinations do not', async ({ page }) => {
    await openDashboard(page);
    await showEveryAction(page);

    const seen = await page.evaluate(() => {
        const read = (el) => {
            const s = window.getComputedStyle(el);
            return { width: s.borderTopWidth, style: s.borderTopStyle, radius: s.borderTopLeftRadius };
        };
        return {
            group: read(document.querySelector('.header-shortcuts')),
            destinations: read(document.querySelector('.header-destinations')),
        };
    });

    expect(parseFloat(seen.group.width), 'the actions have no surround').toBeGreaterThan(0);
    expect(seen.group.style, 'the surround is not drawn').not.toBe('none');
    expect(parseFloat(seen.group.radius), 'the surround has square corners').toBeGreaterThan(0);
    expect(parseFloat(seen.destinations.width), 'the destinations were boxed in too').toBe(0);
});

test('the surround goes when the last action does', async ({ page }) => {
    await openDashboard(page);

    await page.evaluate(async () => {
        const d = window.dashboardInstance;
        Object.assign(d.settings, {
            showAddBookmarkButton: false, showSearchButton: false,
            showRecentButton: false, showCheatSheetButton: false,
        });
        d.setupDOM?.();
        await d.saveSettings?.();
    });
    await page.waitForTimeout(300);

    const drawn = await page.evaluate(() =>
        window.getComputedStyle(document.querySelector('.header-shortcuts')).display);
    expect(drawn, 'an empty box is left standing in the header').toBe('none');
});

/*
 * Each action shows its key, then says what it is.
 *
 * They were three bare glyphs for a while, which asks the reader to already
 * know what +, > and ! do — the one thing a header is worst at teaching. The
 * key leads and the word explains it, the way the cheat sheet prints a row.
 */
test('an action shows its key and then names itself', async ({ page }) => {
    await openDashboard(page);
    await showEveryAction(page);

    const read = await page.evaluate(() => {
        const one = (id) => {
            const btn = document.querySelector(`.header-shortcuts #${id}`);
            const label = btn.querySelector('.search-button-label');
            const icon = btn.querySelector('.search-button-icon');
            return {
                word: label.textContent.trim(),
                key: icon.textContent.trim(),
                shown: window.getComputedStyle(label).display !== 'none',
                // The key is written before the word, in the DOM and so on screen.
                keyFirst: icon.compareDocumentPosition(label) & Node.DOCUMENT_POSITION_FOLLOWING,
                named: (btn.getAttribute('aria-label') || '').length > 0,
            };
        };
        return {
            add: one('quick-add-toolbar-btn'),
            search: one('search-button'),
            recents: one('recent-bookmarks-button'),
            cheat: one('help-button'),
        };
    });

    expect(read.add.word, 'the add button does not say what it adds').toBe('add bookmark');
    expect(read.search.word).toBe('search');
    expect(read.recents.word).toBe('recents');
    expect(read.cheat.word).toBe('cheat');
    expect([read.add.key, read.search.key, read.recents.key, read.cheat.key])
        .toEqual(['+', '>', '*', '!']);

    for (const [name, one] of Object.entries(read)) {
        expect(one.shown, `the ${name} button is a bare glyph again`).toBe(true);
        expect(Boolean(one.keyFirst), `the ${name} button shows its word before its key`).toBe(true);
        expect(one.named, `the ${name} button has no accessible name`).toBe(true);
    }
});
