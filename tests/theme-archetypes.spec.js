// @ts-check
const { test, expect } = require('./fixtures');
const {
    markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays,
    waitForConfigReady, markConfigSettingPromosSeen,
} = require('./e2e-helpers');

/**
 * Archetypes: what a theme is, besides its palette.
 *
 * A theme used to be thirteen colours, and 218 of the 242 entries said nothing
 * about how they were drawn — so most of the collection rendered flat and
 * matte whatever the palette was. Each one now names a character, and the
 * character answers the nine surface fields the theme leaves blank.
 *
 * These tests are about what a reader can see and do: the browser filters and
 * searches on it, the surfaces follow the theme, a change belongs to the theme
 * it was made on, and Reset puts it back.
 */

async function openDashboard(page) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('.bookmark-link', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.evaluate(() => {
        ['healthTutorialV2', 'inboxTutorialV2', 'changesTourV1', 'widgetsTutorialV1']
            .forEach((id) => window.DiscoverabilityState?.markTipSeen?.(id, { persist: true }));
    });
}

async function openAppearance(page) {
    await waitForConfigReady(page);
    await markConfigSettingPromosSeen(page);
    await page.evaluate(() => window.dashboardInstance.config.openConfigView('appearance'));
    await page.waitForSelector('.config-view', { timeout: 20_000 });
}

/** The surfaces the page is actually drawn with. */
const drawn = (page) => page.evaluate(() => ({
    depth: document.body.getAttribute('data-depth'),
    glow: document.body.getAttribute('data-glow'),
    effects: document.body.getAttribute('data-effects'),
}));

const prefs = (page) => page.evaluate(
    () => JSON.parse(JSON.stringify(window.dashboardInstance.settings.themeSurfacePrefs || {})));

test('every packaged theme names a character the browser can filter on', async ({ page, request }) => {
    const meta = await (await request.get('/api/themes/meta')).json();

    expect(meta.archetypes.length, 'the server offers no archetypes').toBeGreaterThan(5);
    const themes = Object.values(meta.themes);
    const withCharacter = themes.filter((t) => t.character);
    // Custom themes have none, so this is "almost all" rather than "all".
    expect(withCharacter.length, 'hardly any theme has a character')
        .toBeGreaterThan(themes.length * 0.9);
    // And every one of them is a word the browser knows how to label.
    for (const theme of withCharacter) {
        expect(meta.archetypes, `${theme.character} is not in the catalogue`)
            .toContain(theme.character);
    }
});

test('the character chips narrow the browser, and search reaches the written line', async ({ page }) => {
    await openDashboard(page);
    await page.keyboard.press('Shift+A');
    await page.waitForSelector('[data-theme-browser]', { timeout: 20_000 });

    const cards = page.locator('[data-theme-card]');
    const all = await cards.count();
    expect(all, 'the browser opened empty').toBeGreaterThan(20);

    await page.locator('[data-theme-character="velvet"]').click();
    await expect.poll(() => cards.count(), { message: 'the velvet chip did not narrow the grid' })
        .toBeLessThan(all);
    const velvet = await cards.count();
    expect(velvet, 'the velvet chip left nothing').toBeGreaterThan(0);
    // Every card left is velvet, which is the difference between a filter and
    // a sort.
    const badges = await page.locator('[data-theme-card] [data-theme-badge]').evaluateAll(
        (els) => els.map((el) => el.getAttribute('data-theme-badge')));
    expect(new Set(badges), 'the grid kept cards of other characters').toEqual(new Set(['velvet']));

    // The same chip again is the way back to everything.
    await page.locator('[data-theme-character="velvet"]').click();
    await expect.poll(() => cards.count()).toBe(all);

    // A word that appears only in a theme's written line still finds it.
    await page.locator('[data-theme-search]').fill('phosphor');
    await expect.poll(() => cards.count(), { message: 'the written line is not searchable' })
        .toBeGreaterThan(0);
    await expect.poll(() => cards.count()).toBeLessThan(all);
});

test('a theme brings its own surfaces, and a change belongs to the theme it was made on', async ({ page }) => {
    await openDashboard(page);
    await openAppearance(page);

    const pick = (id) => page.evaluate(
        (theme) => window.dashboardInstance.config.applyThemeChoice(theme), id);

    // Two themes drawn for different depths: brushed sits at rich, terminal at
    // soft. Both on Follow the theme, which is where an install now starts.
    await pick('tarnished-brass-dark');
    await expect.poll(async () => (await drawn(page)).depth,
        { message: 'a brushed theme did not bring its own depth' }).toBe('rich');

    await pick('retro-crt-dark');
    await expect.poll(async () => (await drawn(page)).depth).toBe('soft');

    // A change made on one theme stays on that theme.
    await pick('tarnished-brass-dark');
    await page.selectOption('[data-appearance-select="themeDepth"]', 'flat');
    await expect.poll(async () => (await drawn(page)).depth).toBe('flat');
    expect(await prefs(page), 'the change was not stored against the theme')
        .toHaveProperty('tarnished-brass-dark');

    // The other theme is untouched by it -- this is the whole point of storing
    // it per theme rather than once for the install.
    await pick('retro-crt-dark');
    await expect.poll(async () => (await drawn(page)).depth,
        { message: 'a change on one theme followed the reader to another' }).toBe('soft');

    // And coming back finds it again.
    await pick('tarnished-brass-dark');
    await expect.poll(async () => (await drawn(page)).depth).toBe('flat');
});

test('Reset puts a theme back to the surfaces it ships with', async ({ page }) => {
    await openDashboard(page);
    await openAppearance(page);
    await page.evaluate(() => window.dashboardInstance.config.applyThemeChoice('tarnished-brass-dark'));
    await page.waitForTimeout(500);

    await page.selectOption('[data-appearance-select="themeDepth"]', 'flat');
    await expect.poll(async () => (await drawn(page)).depth).toBe('flat');

    await page.locator('[data-appearance-action="reset-theme-surfaces"]').click();

    await expect.poll(async () => (await drawn(page)).depth,
        { message: 'Reset did not go back to the theme\'s own depth' }).toBe('rich');
    expect(await prefs(page), 'Reset left the stored change behind')
        .not.toHaveProperty('tarnished-brass-dark');
});

test('Effects off takes the character out of the drawing', async ({ page }) => {
    await openDashboard(page);
    await openAppearance(page);
    await page.evaluate(() => window.dashboardInstance.config.applyThemeChoice('gloss-liquid-chrome-dark'));
    await page.waitForTimeout(500);

    const factor = () => page.evaluate(
        () => getComputedStyle(document.body).getPropertyValue('--theme-effects').trim());

    await page.selectOption('[data-appearance-select="themeEffects"]', 'full');
    await expect.poll(factor).toBe('1');

    await page.selectOption('[data-appearance-select="themeEffects"]', 'off');
    await expect.poll(factor, { message: 'Effects off left the factor above zero' }).toBe('0');
    expect((await drawn(page)).effects).toBe('off');
});
