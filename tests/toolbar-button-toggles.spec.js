// @ts-check
const { test, expect } = require('./fixtures');
const { prepareDashboardInteraction } = require('./e2e-helpers');

/**
 * Each toolbar button in the secondary group answers only to its own toggle.
 *
 * The three share one container, and hiding that container used to be how the
 * group disappeared once its buttons were off. Fold-all had no setting of its
 * own and rode along with that rule, so it appeared and vanished with the
 * cheat-sheet button — a toggle labelled "Show the cheat-sheet button" moved
 * two buttons at once.
 */

/** Set the three toggles and let the body attributes catch up. */
async function setButtons(page, { cheat, recent, fold }) {
    await page.evaluate(([c, r, f]) => {
        const d = window.dashboardInstance;
        d.settings.showCheatSheetButton = c;
        d.settings.showRecentButton = r;
        d.settings.showCollapseAllButton = f;
        d.setupDOM();
    }, [cheat, recent, fold]);
}

/**
 * Actually on screen, not merely `display` on the element itself. The three
 * buttons share a container that is hidden as a unit, and a child of a
 * `display: none` parent still reports its own display as `flex` — checking
 * only the element misses exactly the bug this file is about.
 */
const shown = (page, id) => page.evaluate((btnId) => {
    const el = document.getElementById(btnId);
    return Boolean(el) && el.getClientRects().length > 0;
}, id);

test.describe('toolbar button visibility', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/');
        await page.waitForSelector('#dashboard-layout', { timeout: 15_000 });
        // The layout is in the document before the instance is assigned, and
        // every helper here reads settings off it.
        await page.waitForFunction(() => window.dashboardInstance?.settings != null,
            null, { timeout: 15_000 });
        await prepareDashboardInteraction(page);
    });

    test('turning the cheat-sheet button off leaves fold-all alone', async ({ page }) => {
        await setButtons(page, { cheat: true, recent: false, fold: true });
        expect(await shown(page, 'collapse-all-button')).toBe(true);

        // The reported bug: this also took the "." button away, because both
        // Recent and Help being off collapsed the whole group.
        await setButtons(page, { cheat: false, recent: false, fold: true });
        expect(await shown(page, 'help-button')).toBe(false);
        expect(await shown(page, 'collapse-all-button')).toBe(true);
    });

    test('turning the cheat-sheet button on does not bring fold-all with it', async ({ page }) => {
        await setButtons(page, { cheat: false, recent: false, fold: false });
        expect(await shown(page, 'collapse-all-button')).toBe(false);

        await setButtons(page, { cheat: true, recent: false, fold: false });
        expect(await shown(page, 'help-button')).toBe(true);
        expect(await shown(page, 'collapse-all-button')).toBe(false);
    });

    test('fold-all has a toggle of its own', async ({ page }) => {
        await setButtons(page, { cheat: true, recent: true, fold: true });
        expect(await shown(page, 'collapse-all-button')).toBe(true);

        await setButtons(page, { cheat: true, recent: true, fold: false });
        expect(await shown(page, 'collapse-all-button')).toBe(false);
        // Its neighbours are untouched by its own toggle.
        expect(await shown(page, 'help-button')).toBe(true);
        expect(await shown(page, 'recent-bookmarks-button')).toBe(true);
    });

    test('the group still collapses when all three are off', async ({ page }) => {
        await setButtons(page, { cheat: false, recent: false, fold: false });
        const groupHidden = await page.evaluate(
            () => getComputedStyle(document.querySelector('.btn-group-secondary')).display === 'none',
        );
        expect(groupHidden).toBe(true);
    });

    test('the setting is offered in Appearance and applies without a reload', async ({ page }) => {
        await page.evaluate(() => { window.location.hash = '#config/appearance'; });
        // The button-bar toggles were given their own tab when the bar became
        // one tab rather than two (v1.3.0); Toolbar & tabs keeps the header.
        await expect(page.locator('[data-appearance-tab="buttonbar"]')).toBeVisible({ timeout: 15_000 });
        await page.locator('[data-appearance-tab="buttonbar"]').click();

        const toggle = page.locator('[data-behavior-field="showCollapseAllButton"]');
        await expect(toggle).toHaveCount(1);
        /*
         * Called before each click: toggling the setting repaints the body, and
         * on a loaded runner the new input can arrive a moment after the click.
         */
        const reveal = async () => {
            await expect(toggle).toBeVisible({ timeout: 15_000 });
        };
        /*
         * Clicked without the stability check, because this control replaces
         * itself.
         *
         * It carries `data-behavior-special="chrome"`, so changing it repaints
         * the panel and the input is rebuilt underneath the click. Playwright
         * re-resolved it each time -- the log showed it landing on `checked`
         * and then on an unchecked element a moment later -- and waited the
         * full thirty seconds for something that was never going to hold still.
         * The assertions below read the body attribute, which is what this test
         * is really about.
         */
        const flip = async () => {
            await reveal();
            // Not toggle.click(): that resolves the element over the
            // Playwright protocol, then clicks it in a second round trip --
            // a window this self-rebuilding control can and did land a
            // rebuild inside, under CI load ("element was detached from the
            // DOM, retrying", eventually exceeding the test timeout). A
            // dispatched click from inside the page queries and clicks in
            // one synchronous step, so there is no gap left to race.
            await page.evaluate(() => {
                document.querySelector('[data-behavior-field="showCollapseAllButton"]')?.click();
            });
        };
        await reveal();
        // The button ships off, and the specs above this one set it either way,
        // so what it starts as is not this test's business — the flip is.
        const startedOn = await toggle.isChecked();

        await flip();
        // A body attribute, so it needs the chrome branch of setBehavior —
        // `render` would redraw the grid and never rewrite <body>.
        await expect
            .poll(() => page.evaluate(() => document.body.getAttribute('data-show-collapse-all-button')))
            .toBe(String(!startedOn));

        // Put it back: the settings file is shared with every other spec in the
        // run, and leaving this changed would move the toolbar under anything
        // that asserts on it afterwards.
        await flip();
        await expect
            .poll(() => page.evaluate(() => document.body.getAttribute('data-show-collapse-all-button')))
            .toBe(String(startedOn));
    });
});
