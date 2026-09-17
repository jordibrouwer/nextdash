// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * The appearance settings you try on belong in the palette.
 *
 * Depth, text contrast, the theme backdrop and its texture, favicon
 * harmonisation and how far a row lights up are all settings somebody picks,
 * looks at, and picks again. That is what a command palette is for, and it is
 * what a trip into config is bad at -- the panel covers the thing you are
 * judging.
 *
 * Applied through ThemeLoader, which is the door config uses too: the palette
 * must not become a second answer to what any of these mean. Harmonisation is
 * the exception and goes through the config module, because what a write to it
 * touches is stored per theme and that logic lives there.
 */

const KEY_COMMANDS = 'Shift+Semicolon';

async function dashboard(page) {
    await page.setViewportSize({ width: 1400, height: 900 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('.bookmark-link', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => window.dashboardInstance?.searchComponent != null, null, { timeout: 20_000 });
}

/**
 * Opens the palette on a command and returns what it offers.
 *
 * Waited on the count it should reach, not on "more than none": the list is
 * rebuilt per keystroke, so a poll that stops at the first row reads a list
 * that is still being typed into.
 */
async function rows(page, command, expected) {
    await page.evaluate(() => window.dashboardInstance.searchComponent.closeSearch());
    await page.keyboard.press(KEY_COMMANDS);
    await page.keyboard.type(command);
    // Waited on the command's own rows, not on a count: the palette shows a
    // recent-searches hint while the query is still being typed, and that is
    // one row too.
    const name = command.split(' ')[0].toUpperCase();
    await expect.poll(() => page.locator(`#search-matches .search-match:has-text(":${name}")`).count(),
        { message: `${command} never listed ${expected} of its own rows` }).toBe(expected);
    // textContent, not innerText: a row read the moment the count lands can
    // still be between layout passes, and innerText comes back empty there.
    return page.locator(`#search-matches .search-match:has-text(":${name}")`).evaluateAll((els) =>
        els.map((el) => (el.textContent || '').replace(/\s+/g, ' ').trim()));
}

/** Picks one option and waits for the palette to settle. */
async function pick(page, command, option) {
    await page.evaluate(() => window.dashboardInstance.searchComponent.closeSearch());
    await page.keyboard.press(KEY_COMMANDS);
    await page.keyboard.type(`${command} ${option}`);
    // One of the command's own rows: typed in full the option narrows to
    // exactly itself, and Enter must not land on whatever was listed a
    // keystroke ago.
    const name = command.toUpperCase();
    await expect.poll(() => page.locator(`#search-matches .search-match:has-text(":${name}")`).count()).toBe(1);
    await page.keyboard.press('Enter');
}

const settings = (page) => page.evaluate(() => window.dashboardInstance.settings);

test.describe('appearance in the command palette', () => {
    test('every one of them lists its choices and marks the current', async ({ page }) => {
        await dashboard(page);

        for (const [command, expected] of [
            ['depth', 4], ['contrast', 4], ['backdrop', 2], ['pattern', 6], ['rows', 2],
        ]) {
            const listed = await rows(page, command, expected);
            expect(listed.filter((r) => r.includes('✓')).length,
                `${command} marks no current value, or more than one`).toBe(1);
        }
    });

    test('and each one lands, live and saved', async ({ page }) => {
        await dashboard(page);

        await pick(page, 'depth', 'glass');
        await expect.poll(() => page.getAttribute('body', 'data-depth')).toBe('glass');

        await pick(page, 'backdrop', 'off');
        await expect.poll(() => page.getAttribute('body', 'data-theme-backdrop')).toBe('off');

        await pick(page, 'rows', 'strong');
        await expect.poll(() => page.getAttribute('body', 'data-row-highlight')).toBe('strong');

        await pick(page, 'pattern', 'hatch');
        await pick(page, 'contrast', 'high');

        const saved = await settings(page);
        expect(saved.themeDepth, 'depth did not reach the settings').toBe('glass');
        expect(saved.themeBackdrop).toBe('off');
        expect(saved.rowHighlight).toBe('strong');
        expect(saved.backgroundPattern).toBe('hatch');
        // The slider is a lightness step in OKLCH; the palette takes the middle
        // of the band the config view already names, so picking the same word
        // twice cannot drift.
        expect(saved.inkGap, 'contrast did not move into its band').toBeGreaterThan(0.48);
        expect(saved.inkGap).toBeLessThan(0.54);
    });

    test('harmonisation writes through config, not around it', async ({ page }) => {
        await dashboard(page);
        const entry = () => page.evaluate(() =>
            window.ThemeIconStyling.getThemeIconStylingEntry(window.dashboardInstance.settings));

        const before = await entry();
        await pick(page, 'harmonize', 'tinted');

        await expect.poll(async () => (await entry()).style).toBe('tinted');
        // Picking a style turns it on: choosing one while it is off is not a
        // thing anyone does on purpose.
        expect((await entry()).enabled).toBe(true);
        expect(before.style, 'the fixture already had this style, so this proved nothing')
            .not.toBe('tinted');
    });

    test('a typed prefix narrows the list', async ({ page }) => {
        await dashboard(page);

        const listed = await rows(page, 'pattern h', 1);
        expect(listed[0].toLowerCase()).toContain('hatch');
    });
});


/*
 * The rest of the same panel: the glow, the two drawings and the seven
 * toggles.
 *
 * Depth, contrast, the backdrop and the pattern were here from the start; the
 * settings added since sat only in config, so a reader working from the
 * keyboard had to open a view to answer a question the palette answers for
 * everything beside it.
 */
test.describe('the header and surfaces settings', () => {
    async function openPalette(page, query) {
        await dashboard(page);
        await page.evaluate((q) => {
            const sc = window.dashboardInstance.searchComponent;
            sc.currentQuery = q;
            sc.updateSearch();
        }, query);
        await page.waitForTimeout(250);
    }

    const rows = (page) => page.evaluate(
        () => (window.dashboardInstance.searchComponent.searchMatches || [])
            .map((m) => m.name || m.label || '').filter(Boolean),
    );

    const pick = (page, needle) => page.evaluate((text) => {
        const sc = window.dashboardInstance.searchComponent;
        const match = (sc.searchMatches || []).find((m) => (m.name || '').startsWith(text));
        if (!match?.action) throw new Error(`no row starting with ${text}`);
        return match.action();
    }, needle);

    test(':glow sets the glow, and says which one is on', async ({ page }) => {
        await openPalette(page, ':glow');

        // Rows carry the label, with a tick on the one in force.
        expect((await rows(page)).join(' ').toLowerCase()).toContain('off');
        expect((await rows(page)).join(' ').toLowerCase()).toContain('full');

        await pick(page, 'Full');
        await expect.poll(() => page.evaluate(
            () => document.body.getAttribute('data-glow')), { timeout: 5_000 }).toBe('full');
    });

    test(':buttonstyle switches the header drawing', async ({ page }) => {
        await openPalette(page, ':buttonstyle');

        await pick(page, 'Each in its own box');
        await expect.poll(() => page.evaluate(
            () => document.body.getAttribute('data-header-buttons')), { timeout: 5_000 }).toBe('plated');
    });

    test(':switcher picks how the pages are drawn', async ({ page }) => {
        await openPalette(page, ':switcher');

        await pick(page, 'Plain text');
        await expect.poll(() => page.evaluate(
            () => document.body.getAttribute('data-page-switcher')), { timeout: 5_000 }).toBe('text');
    });

    test(':maxtabs offers three to nine', async ({ page }) => {
        await openPalette(page, ':maxtabs');

        const listed = await rows(page);
        expect(listed).toHaveLength(7);

        await pick(page, '7');
        await expect.poll(() => page.evaluate(
            () => Number(window.dashboardInstance.settings.maxPageTabs)), { timeout: 5_000 }).toBe(7);
    });

    test(':header toggles the seven controls of the panel', async ({ page }) => {
        await openPalette(page, ':header');

        const listed = await rows(page);
        expect(listed).toHaveLength(7);
        expect(listed.join(' ')).toContain('inbox');

        await pick(page, 'inbox');
        await expect.poll(() => page.evaluate(
            () => document.body.getAttribute('data-show-inbox-button')), { timeout: 5_000 }).toBe('false');
    });

    test(':buttons reaches the pages and fold-all buttons too', async ({ page }) => {
        await openPalette(page, ':buttons');

        const listed = (await rows(page)).join(' ');
        expect(listed).toContain('pages');
        expect(listed).toContain('foldall');

        // On by default, so picking it switches it off.
        await pick(page, 'pages');
        await expect.poll(() => page.evaluate(
            () => window.dashboardInstance.settings.showPagesButton), { timeout: 5_000 }).toBe(false);
    });
});
