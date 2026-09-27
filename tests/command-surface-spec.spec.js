// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * The command surface, drawn the way the overlay spec draws it.
 *
 * The draft is one sheet with three parts: a prompt ruled off from what it
 * answers, rows that run the full width with a 2px accent bar on the one you
 * are on, and the mode switch centred on a plate at the foot. What shipped
 * was a padded card holding rounded chips, which is a different object --
 * the accent bar floated as a tick rather than sitting on an edge, and the
 * line between question and answer was white space.
 *
 * Measured rather than eyeballed, because every one of these is a number the
 * draft states.
 */

async function openCommands(page, query = 'theme') {
    await page.setViewportSize({ width: 1500, height: 1000 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('.bookmark-link', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.keyboard.press('Shift+Semicolon');
    await page.keyboard.type(query);
    await expect.poll(() => page.locator('.search-match').count()).toBeGreaterThan(2);
}

const style = (page, selector, props) => page.evaluate(([sel, list]) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const cs = window.getComputedStyle(el);
    return Object.fromEntries(list.map((p) => [p, cs[p]]));
}, [selector, props]);

/**
 * The pixel value of a radius token, as the browser resolves it.
 *
 * Reading the custom property gives back the unresolved `calc(...)` it is
 * declared as, so it is measured on an element that actually uses it.
 */
const radiusPx = (page, token) => page.evaluate((name) => {
    const probe = document.createElement('div');
    probe.style.cssText = `position:fixed;left:-9999px;width:10px;height:10px;border-radius:var(${name})`;
    document.body.appendChild(probe);
    const value = getComputedStyle(probe).borderRadius;
    probe.remove();
    return value;
}, token);

test.describe('the command surface', () => {
    test('is a sheet, not a padded card', async ({ page }) => {
        await openCommands(page);
        // The draft states the sheet's own numbers; glass is the fresh-install
        // default now and layers its own backdrop-filter on top of them (see
        // theme-character.css), so pin flat to read the sheet's own values.
        await page.evaluate(() => document.body.setAttribute('data-depth', 'flat'));
        const surface = await style(page, '.search-container',
            ['padding', 'borderRadius', 'backdropFilter', 'boxShadow']);

        // No padding of its own: the parts carry theirs, which is what lets
        // the rule under the prompt run the full width.
        expect(surface.padding, 'the surface still pads its own contents').toBe('0px');
        /*
         * Against the token rather than a number of pixels.
         *
         * A theme's character now moves every corner: the fresh-install theme
         * is brushed, which asks for 0.7 of the radius scale, so --radius-5 is
         * 5.6px there and 8px on a theme that asks for nothing. What the sheet
         * has to be is that token, not a constant.
         */
        expect(surface.borderRadius, 'the sheet has a card corner')
            .toBe(await radiusPx(page, '--radius-5'));
        expect(surface.backdropFilter).toContain('blur(8px)');
        // Lifted off the page, not resting on it: the spec draws 0 24px 64px.
        expect(surface.boxShadow, `no deep drop under the sheet: ${surface.boxShadow}`)
            .toMatch(/0px 24px 64px/);
    });

    test('the prompt is ruled off from what it answers', async ({ page }) => {
        await openCommands(page);
        const prompt = await style(page, '.search-prompt', ['padding', 'borderBottomWidth', 'gap']);

        expect(prompt.padding, 'the prompt row carries no padding').toBe('16px');
        expect(parseFloat(prompt.borderBottomWidth), 'no rule under the prompt').toBeGreaterThan(0);
    });

    test('the mode is a pill', async ({ page }) => {
        await openCommands(page);
        const pill = await style(page, '.search-prefix',
            ['textTransform', 'fontWeight', 'borderRadius', 'backgroundColor', 'borderTopWidth']);

        expect(pill.textTransform).toBe('uppercase');
        expect(pill.fontWeight).toBe('700');
        // The pill is one step tighter than the sheet, whatever the theme's
        // character does to the scale.
        expect(pill.borderRadius, 'the pill took the sheet\'s corner')
            .toBe(await radiusPx(page, '--radius-3'));
        expect(parseFloat(pill.borderTopWidth), 'the pill has no outline').toBeGreaterThan(0);
    });

    test('a row runs the full width and lights from its edge', async ({ page }) => {
        await openCommands(page);

        const row = await style(page, '.search-match', ['borderRadius', 'padding', 'gap']);
        expect(row.borderRadius, 'a row is still a rounded chip').toBe('0px');
        expect(row.padding, 'a row is not indented to the sheet').toContain('16px');

        const selected = await style(page, '.search-match.keyboard-selected',
            ['borderLeftWidth', 'borderLeftColor', 'boxShadow']);
        expect(selected, 'nothing is selected, so this tested nothing').not.toBeNull();
        expect(selected.borderLeftWidth).toBe('2px');
        // The light falls in from the edge that carries the bar rather than
        // tinting the row evenly.
        expect(selected.boxShadow, `no inward bloom: ${selected.boxShadow}`).toContain('inset');
    });

    test('the scopes stand in a rail beside the list, and the one in force carries a bar', async ({ page }) => {
        await openCommands(page);

        const rail = await style(page, '.search-scope-rail', ['borderRightWidth', 'flexDirection']);
        expect(rail, 'the panel has no rail').not.toBeNull();
        // A column of kinds, ruled off from the results it governs.
        expect(rail.flexDirection).toBe('column');
        expect(parseFloat(rail.borderRightWidth), 'nothing separates the rail from the list').toBeGreaterThan(0);

        const active = await style(page, '.search-scope.active', ['boxShadow']);
        expect(active.boxShadow, `the scope in force is not marked: ${active.boxShadow}`).toContain('inset');
    });
});
