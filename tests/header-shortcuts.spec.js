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
    // These specs measure the actions in the header; a fresh install docks
    // them at the bottom now.
    await page.evaluate(async () => {
        const d = window.dashboardInstance;
        d.settings.actionBarPosition = 'header';
        d.setupDOM?.();
        await d.saveSettings?.();
    });
}

/**
 * The plated header: every control in a box of its own.
 *
 * It is one of two answers now (headerButtonStyle) and the plain one ships by
 * default — bare glyphs with a rule under the current one. What this file
 * measures is the boxes, the plates and the hairline between the groups, so it
 * asks for the drawing it is about rather than testing whichever is default.
 */
async function usePlatedHeader(page) {
    await page.evaluate(async () => {
        const d = window.dashboardInstance;
        d.settings.headerButtonStyle = 'plated';
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        await api('/api/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(d.settings),
        });
        d.setupDOM?.();
    });
    await page.waitForTimeout(250);
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
    // The merged row, which is what "one row" means: an install now starts on
    // the classic placement, where the clock keeps a line of its own on
    // purpose (dashboard-merged-header.spec.js covers both).
    await page.evaluate(async () => {
        const d = window.dashboardInstance;
        d.settings.headerClockPlacement = 'beside-name';
        await d.saveSettings?.();
        d.setupDOM?.();
    });

    const fit = await page.evaluate(() => {
        const actions = document.querySelector('.header-actions');
        const header = document.querySelector('.header-top');
        const config = document.querySelector('.config-link');
        const r = config.getBoundingClientRect();
        return {
            overflow: Math.round(actions.scrollWidth - actions.clientWidth),
            // The row is a band with padding, so one row means one shared
            // centre line rather than one shared top edge.
            sameRow: Math.abs(
                (actions.getBoundingClientRect().top + actions.getBoundingClientRect().height / 2)
                - (header.getBoundingClientRect().top + header.getBoundingClientRect().height / 2),
            ) < 4,
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
 * Eight actions, and every one of them switchable.
 *
 * Commands, finders and fold-all spent a while with a setting that controlled
 * nothing: their buttons had gone with the floating bar while their toggles
 * stayed in config. They are back in the row, which is what makes those
 * settings mean something again.
 */
test('every action the settings offer is in the row', async ({ page }) => {
    await openDashboard(page);

    const ids = [
        'quick-add-toolbar-btn', 'search-button', 'commands-button', 'finders-button',
        'tag-cloud-toggle-btn', 'recent-bookmarks-button', 'collapse-all-button', 'help-button',
    ];
    const inHeader = await page.evaluate((list) =>
        list.filter((id) => !document.querySelector(`.header-shortcuts #${id}`)), ids);
    expect(inHeader, 'these actions are not in the header').toEqual([]);
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
            showAddBookmarkButton: true, showSearchButton: true, showCommandsButton: true,
            showFindersButton: true, showTagCloudButton: true, showRecentButton: true,
            showPagesButton: true, showCollapseAllButton: true, showCheatSheetButton: true,
            // Room for all nine on the bar: past the reader's cap the rest fold
            // behind one control, and this is about the order they stand in.
            maxHeaderActions: 9,
        });
        d.setupDOM?.();
        await d.saveSettings?.();
        window.DashboardTagCloud?.syncFromSettings?.();
        d.toolbar?.syncTagCloudButtonPlacement?.();
    });
    await page.waitForTimeout(400);
}

/*
 * One order, whatever the markup says.
 *
 * The buttons arrive in the two groups the dock split them into, and which of
 * them are drawn is a setting — so an order taken from the DOM would change as
 * buttons are switched on and off. Add comes first because it is the one that
 * makes something, then search, then what you opened last, then the pages, then
 * the sheet that says what every key does.
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

    // Pages sits after recents: both open a panel you came for, and the sheet
    // that lists every key stays last.
    expect(keys).toBe('+ > : ? / * , . !');
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

    const seen = await page.evaluate(() => {
        const read = (el) => {
            const s = window.getComputedStyle(el);
            return { background: s.backgroundColor, color: s.color, width: s.width, height: s.height,
                     fontSize: s.fontSize, fontWeight: s.fontWeight, fontFamily: s.fontFamily };
        };
        return {
            action: read(document.querySelector('.header-shortcuts #search-button')),
            group: read(document.querySelector('.header-shortcuts')),
            destination: read(document.querySelector('.header-destinations .config-link-anchor')),
        };
    });

    // The ink is shared: an action reads as the same kind of control.
    expect(seen.action.color).toBe(seen.destination.color);
    expect(seen.action.fontSize).toBe(seen.destination.fontSize);
    expect(seen.action.fontWeight).toBe(seen.destination.fontWeight);
    expect(seen.action.fontFamily).toBe(seen.destination.fontFamily);
    // Not the square: an action is 28px inside a surround that measures 40, and
    // a destination is the 40 -- see 'the destinations are as big as the action
    // group' below, which is where that comparison belongs.
    // The surface belongs to the group the actions stand in, not to each
    // button -- that is what makes four buttons read as one control -- and it
    // is made of the same material a destination is.
    expect(seen.action.background, 'an action carries a plate of its own').toBe('rgba(0, 0, 0, 0)');
    expect(seen.group.background, 'the group and the destinations are different materials')
        .toBe(seen.destination.background);
});

/*
 * The actions are one control, and the surround is what says so.
 *
 * Three bare glyphs beside the destinations read as six destinations; the
 * design draws a box around the three that do something, and leaves the places
 * you can go standing on the header itself.
 */
test('with plated buttons the actions stand bare, without a surround', async ({ page }) => {
    await openDashboard(page);
    await showEveryAction(page);
    await usePlatedHeader(page);

    const group = await page.evaluate(() => {
        const s = window.getComputedStyle(document.querySelector('.header-shortcuts'));
        return { border: s.borderTopColor, background: s.backgroundColor, shadow: s.boxShadow };
    });

    expect(group.border, 'the actions still have a surround').toBe('rgba(0, 0, 0, 0)');
    expect(group.background, 'the actions still sit on a plate').toBe('rgba(0, 0, 0, 0)');
    expect(group.shadow, 'the actions still cast a shadow').toBe('none');
});

/*
 * And the rule goes when either side of it does.
 *
 * One hairline stands between what you do and where you go. Empty the actions
 * and it was a line against the surround that was no longer there; empty the
 * destinations and it was a line against the edge of the band.
 */
test('the hairline needs something on both sides of it', async ({ page }) => {
    await openDashboard(page);
    await showEveryAction(page);
    await usePlatedHeader(page);

    const rules = () => page.evaluate(() => [...document.querySelectorAll('.header-zone-divider:not(.header-zone-divider--pages)')]
        .filter((el) => window.getComputedStyle(el).display !== 'none').length);
    const apply = (settings) => page.evaluate(async (patch) => {
        const d = window.dashboardInstance;
        Object.assign(d.settings, patch);
        d.setupDOM?.();
        await d.saveSettings?.();
        window.DashboardTagCloud?.syncFromSettings?.();
    }, settings);

    expect(await rules(), 'the band lost its hairline with both sides drawn').toBe(1);

    await apply({
        showAddBookmarkButton: false, showSearchButton: false, showTagCloudButton: false,
        showCommandsButton: false, showFindersButton: false, showRecentButton: false,
        showCollapseAllButton: false, showCheatSheetButton: false, showPagesButton: false,
    });
    await expect.poll(rules, { timeout: 5_000 }).toBe(0);

    // One action back is enough to give the rule a side again.
    await apply({ showSearchButton: true });
    await expect.poll(rules, { timeout: 5_000 }).toBe(1);

    // And the other way round: the actions stand, the destinations do not.
    await apply({
        showDashboardButton: false, showInboxButton: false,
        showConfigButton: false, showHealthDashboard: false,
    });
    await expect.poll(rules, { timeout: 5_000 }).toBe(0);

    // Settings live on the server for the whole file, so put the header back
    // the way the tests after this one expect to find it.
    await apply({
        showDashboardButton: true, showInboxButton: true,
        showConfigButton: true, showHealthDashboard: true,
    });
    await expect.poll(rules, { timeout: 5_000 }).toBe(1);
});

test('the surround goes when the last action does', async ({ page }) => {
    await openDashboard(page);
    await usePlatedHeader(page);

    await page.evaluate(async () => {
        const d = window.dashboardInstance;
        Object.assign(d.settings, {
            showAddBookmarkButton: false, showSearchButton: false, showTagCloudButton: false,
            showCommandsButton: false, showFindersButton: false,
            showRecentButton: false, showCollapseAllButton: false, showCheatSheetButton: false,
            showPagesButton: false,
        });
        d.setupDOM?.();
        await d.saveSettings?.();
        window.DashboardTagCloud?.syncFromSettings?.();
    });
    await page.waitForTimeout(300);

    const drawn = await page.evaluate(() =>
        window.getComputedStyle(document.querySelector('.header-shortcuts')).display);
    expect(drawn, 'an empty box is left standing in the header').toBe('none');
});

/*
 * Each action is an icon with its key on the corner.
 *
 * This is the draft's own action group: five 28px squares in one box, each
 * marked with the key that does the same thing. The word is still the button's
 * accessible name and its tooltip — it is how the icon is learned — but it is
 * not printed beside it, because four words in a row is the strip this header
 * was drawn to replace.
 */
test('an action shows its key and names itself to a screen reader', async ({ page }) => {
    await openDashboard(page);
    await showEveryAction(page);

    const read = await page.evaluate(() => {
        const one = (id) => {
            const btn = document.querySelector(`.header-shortcuts #${id}`);
            const label = btn.querySelector('.search-button-label');
            const icon = btn.querySelector('.search-button-icon');
            const glyph = btn.querySelector('.header-action-glyph');
            const labelStyle = window.getComputedStyle(label);
            return {
                word: label.textContent.trim(),
                key: icon.textContent.trim(),
                // Clipped rather than display:none, so it still reaches a
                // screen reader while taking no room in the row.
                readable: labelStyle.display !== 'none' && labelStyle.clipPath !== 'none',
                drawn: Boolean(glyph),
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
        expect(one.drawn, `the ${name} button has no icon`).toBe(true);
        expect(one.readable, `the ${name} button's word is hidden from a screen reader`).toBe(true);
        expect(one.named, `the ${name} button has no accessible name`).toBe(true);
    }
});

/*
 * One plate, wherever it stands in the band.
 *
 * The action group and the page tabs were drawn with two different casts — the
 * group's read as a raised plate, the tabs' as a hairline — so half the band
 * looked pressed into it and half looked printed on it. Read the three off the
 * page rather than asserting a literal shadow: what matters is that they agree.
 */
test('the groups in the band are all the same plate', async ({ page }) => {
    await openDashboard(page);
    await showEveryAction(page);
    await usePlatedHeader(page);
    /*
     * The segmented switcher, asked for rather than assumed.
     *
     * It used to be the only one, and the comment below still describes it —
     * but the page switcher is a choice of four now and a fresh install starts
     * on `classic`, which draws numbers beside the destinations and no shell at
     * all. This test is about the shell's plate, so it pins the style that has
     * one.
     */
    await page.evaluate(async () => {
        await window.dashboardInstance.config.setBehavior('pageSwitcherStyle', 'segmented', 'chrome');
    });
    await page.waitForTimeout(300);
    // A second page, so there is a tab that is not the one you are on: the
    // active tab carries the bloom on top of the plate and would not compare.
    await page.evaluate(async () => {
        const d = window.dashboardInstance;
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        const pages = [...d.pages, { id: 4242, name: 'elsewhere' }];
        await api('/api/pages', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(pages),
        });
        await d.loadData();
        d.pageNav?.renderPageNavigation?.();
    });
    await page.waitForTimeout(400);

    const seen = await page.evaluate(() => {
        const shadow = (sel) => {
            const el = document.querySelector(sel);
            return el ? window.getComputedStyle(el).boxShadow : null;
        };
        return {
            group: shadow('.header-shortcuts'),
            // The default switcher is one segmented control, so the box in the
            // middle of the band is the shell -- the segments inside it are
            // flat, the way the buttons inside the action group are.
            switcher: shadow('#page-navigation'),
            tab: shadow('.header-track .page-nav-btn:not(.active)'),
            destination: shadow('.config-link-anchor'),
        };
    });

    // The actions stand bare under plated buttons; the switcher and the
    // destinations are the plates, and they agree with each other.
    expect(seen.group, 'the action group still carries a plate').toBe('none');
    expect(seen.switcher, 'the page switcher has no plate at all').not.toBe('none');
    expect(seen.destination, 'a destination is drawn flatter than the switcher').toBe(seen.switcher);
    expect(seen.tab, 'a segment carries a plate of its own inside the shell').toBe('none');
});


/*
 * The destination you are in is lit.
 *
 * Health, config and the inbox tab have carried `active` while their view is
 * open for as long as they have existed, and the header read none of it — the
 * bar looked the same on the grid as three views deep, which is the one thing
 * a destination is for.
 */
test('the destination you are in is the lit one', async ({ page }) => {
    await openDashboard(page);
    // Measured on the plated header, where the mark is a wash and an edge; the
    // plain one says the same thing with the rule under the icon, which
    // header-button-style.spec.js covers.
    await usePlatedHeader(page);

    const read = (sel) => page.evaluate((s) => {
        const el = document.querySelector(s);
        if (!el) return null;
        const c = window.getComputedStyle(el);
        return { active: el.classList.contains('active'), background: c.backgroundColor, border: c.borderTopColor };
    }, sel);

    const resting = await read('.health-link-anchor');
    expect(resting.active, 'health is marked active on the dashboard').toBe(false);

    await page.evaluate(() => {
        window.DiscoverabilityState?.markTipSeen?.('healthTutorialV2', { persist: false });
    });
    await page.keyboard.press('Shift+H');
    await expect.poll(() => page.evaluate(() => window.dashboardInstance?.activeView)).toBe('health');
    await page.waitForTimeout(400);

    const lit = await read('.health-link-anchor');
    expect(lit.active, 'health is not marked active in its own view').toBe(true);
    expect(lit.background, 'the health icon looks the same inside health as outside it')
        .not.toBe(resting.background);
    expect(lit.border, 'the lit destination keeps the resting border').not.toBe(resting.border);
});

/*
 * The tag cloud is one of the actions.
 *
 * It was a corner FAB, fixed to the bottom-left of the window and gone
 * entirely outside the grid. It stands between search and recents now — find
 * something, browse by tag, then what you opened last — and it is in the row in
 * every view, because a control that comes and goes moves everything beside it.
 */
test('the tag cloud stands between search and recents', async ({ page }) => {
    await openDashboard(page);
    await showEveryAction(page);

    const seen = await page.evaluate(() => {
        const btn = document.querySelector('.header-shortcuts #tag-cloud-toggle-btn');
        if (!btn) return null;
        const c = window.getComputedStyle(btn);
        return {
            inRow: true,
            fixed: c.position === 'fixed',
            key: btn.querySelector('.search-button-icon')?.textContent.trim(),
            glyph: Boolean(btn.querySelector('.header-action-glyph')),
        };
    });

    expect(seen, 'the tag cloud button is not in the action row').not.toBeNull();
    expect(seen.fixed, 'it is still pinned to the corner of the window').toBe(false);
    expect(seen.key, 'it does not show its key').toBe('/');
    expect(seen.glyph, 'it has no icon like the actions beside it').toBe(true);
});

/*
 * A destination is the size of the actions beside it.
 *
 * They were 28px squares next to a group that measures 40 — the same button
 * drawn smaller, because one of them had a surround and the other did not. The
 * outer size is what the eye compares, so that is what has to match.
 */
test('the destinations are as big as the action group', async ({ page }) => {
    await openDashboard(page);
    await showEveryAction(page);
    await usePlatedHeader(page);

    const seen = await page.evaluate(() => {
        const height = (sel) => {
            const el = document.querySelector(sel);
            return el ? Math.round(el.getBoundingClientRect().height) : null;
        };
        return {
            group: height('.header-shortcuts'),
            health: height('.health-link-anchor'),
            config: height('.config-link-anchor'),
            // One hairline, between what you do and where you go. The one in
            // front of the actions went with the standalone pages button: a
            // rule needs something on both sides of it.
            dividers: document.querySelectorAll('.header-zone-divider:not(.header-zone-divider--pages)').length,
            // And the pages button is an action, in the group with the rest.
            pagesInGroup: Boolean(document.querySelector('.header-shortcuts #page-overview-header-btn')),
            pagesStandalone: document.querySelectorAll('.pages-link').length,
        };
    });

    expect(seen.health).toBe(seen.group);
    expect(seen.config).toBe(seen.group);
    expect(seen.dividers, 'the header kept a rule with nothing on one side of it').toBe(1);
    expect(seen.pagesInGroup, 'the pages button is not in the action group').toBe(true);
    expect(seen.pagesStandalone, 'the standalone pages button is still drawn').toBe(0);
});
