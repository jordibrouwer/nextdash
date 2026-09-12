// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * With one finder, "?" has nothing left to ask.
 *
 * Finder mode reads as `?<shortcut> <terms>`: everything after the "?" is the
 * shortcut until a space arrives. That is why a space cannot simply be put
 * there -- an empty shortcut matches no finder, so "? jordibrw.nl" searches
 * for nothing at all, and addToQuery carries a guard that swallows exactly
 * that space.
 *
 * But when one finder is configured the prompt is a question with a single
 * possible answer, and someone who types their terms straight after the "?"
 * is right to expect them to land. So the one finder is chosen on the way in
 * and brings its own space. Two or more and the question is real again.
 *
 * Driven through the key, the toolbar button and the mode tab, because all
 * three are ways into the same mode and the choice is made once for them.
 */

async function dashboard(page) {
    await page.setViewportSize({ width: 1400, height: 1000 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(
        () => window.dashboardInstance?.searchComponent?.findersComponent != null,
        null,
        { timeout: 20_000 },
    );
}

/** Replaces the configured finders, as the settings would. */
const setFinders = (page, shortcuts) => page.evaluate((keys) => {
    const finders = keys.map((shortcut) => ({
        shortcut,
        name: `Finder ${shortcut.toUpperCase()}`,
        searchUrl: `https://example.test/${shortcut}?q=%s`,
    }));
    const component = window.dashboardInstance.searchComponent.findersComponent;
    component.finders = finders;
    component.shortcuts = new Map(finders.map((finder) => [finder.shortcut, finder]));
}, shortcuts);

const query = (page) => page.evaluate(() => window.dashboardInstance.searchComponent.currentQuery);

const closeSearch = (page) => page.evaluate(() => window.dashboardInstance.searchComponent.closeSearch());

test.describe('typing into a finder', () => {
    /**
     * Past the space a finder query is the reader's search text.
     *
     * Until the space every character is part of the shortcut, which is
     * matched case-insensitively and shown uppercased. After it, this fell
     * through to the letters-and-digits branch that passes e.key.toUpperCase()
     * and admits only [A-Z0-9-._] -- so a search for a domain went out
     * shouting, and a query with a slash or an ampersand in it could not be
     * typed at all. Only really visible once "?" drops you straight into the
     * terms, which is why it is fixed alongside.
     */
    test('the terms keep the case they were typed in', async ({ page }) => {
        await dashboard(page);
        await setFinders(page, ['b']);

        await page.keyboard.type('?');
        await expect.poll(() => query(page)).toBe('?B ');
        await page.keyboard.type('Jordi Brouwer');

        expect(await query(page), 'the search text was shouted').toBe('?B Jordi Brouwer');
    });

    test('and punctuation a search needs gets through', async ({ page }) => {
        await dashboard(page);
        await setFinders(page, ['b']);

        await page.keyboard.type('?');
        await expect.poll(() => query(page)).toBe('?B ');
        await page.keyboard.type("site:nl a/b&c='d'");

        expect(await query(page), 'characters were dropped on the way in')
            .toBe("?B site:nl a/b&c='d'");
    });

    test('but the shortcut itself is still matched loosely', async ({ page }) => {
        await dashboard(page);
        await setFinders(page, ['b', 'g']);

        await page.keyboard.type('?');
        await page.keyboard.type('g');

        // Lower case in, upper case on screen: the shortcut is a key, not text.
        expect(await query(page)).toBe('?G ');
    });
});

test.describe('entering finder mode', () => {
    test('one finder: the key lands you ready to type', async ({ page }) => {
        await dashboard(page);
        await setFinders(page, ['b']);

        await page.keyboard.type('?');
        await expect.poll(() => query(page)).toBe('?B ');

        // And the terms go where they are meant to, rather than being read as
        // more of the shortcut.
        await page.keyboard.type('jordibrw.nl');
        await expect.poll(() => query(page)).toBe('?B jordibrw.nl');
    });

    test('two finders: the question is real, so it is still asked', async ({ page }) => {
        await dashboard(page);
        await setFinders(page, ['b', 'g']);

        await page.keyboard.type('?');
        await expect.poll(() => query(page)).toBe('?');

        // Picking one still completes with its space, as it always did.
        await page.keyboard.type('g');
        await expect.poll(() => query(page)).toBe('?G ');
    });

    test('no finders at all: nothing to choose, so nothing is chosen', async ({ page }) => {
        await dashboard(page);
        await setFinders(page, []);

        await page.keyboard.type('?');
        // The panel says there are none and offers the way to add one; putting
        // a shortcut there would be inventing a finder that does not exist.
        await expect.poll(() => query(page)).toBe('?');
    });

    test('the mode tab goes in the same way as the key', async ({ page }) => {
        await dashboard(page);
        await setFinders(page, ['b']);

        await page.keyboard.type('>');
        await page.waitForSelector('.search-mode-tab[data-mode="finder"]', { timeout: 10_000 });
        await page.click('.search-mode-tab[data-mode="finder"]');

        await expect.poll(() => query(page)).toBe('?B ');
        await closeSearch(page);
    });

    test('and so does opening in finder mode outright', async ({ page }) => {
        await dashboard(page);
        await setFinders(page, ['b']);

        // What the toolbar's finders button calls. Driven here rather than
        // through the button because the button is off by default.
        await page.evaluate(() => window.dashboardInstance.searchComponent._openInMode('?'));
        await expect.poll(() => query(page)).toBe('?B ');
    });
});
