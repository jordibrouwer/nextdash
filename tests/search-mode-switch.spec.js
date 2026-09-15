// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * The kinds read as one control, beside the list.
 *
 * Search, commands and finders are one panel that changes scope on a key, and
 * a row of pills under the results is a poor place to say so: the scope is set
 * on the line at the top and was shown at the far end of the sheet, after
 * everything it governs. The rail stands beside the list, one row per kind,
 * with the key that scopes to it -- and Tab walks it, so the scope finally has
 * a key of its own.
 */

async function openSearch(page) {
    await page.setViewportSize({ width: 1400, height: 900 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.keyboard.press('>');
    await page.waitForSelector('.search-scope-rail', { state: 'attached', timeout: 10_000 });
}

const railPlace = (page) => page.evaluate(() => {
    const rail = document.querySelector('.search-scope-rail');
    const list = document.querySelector('#search-matches');
    const style = window.getComputedStyle(rail);
    const r = rail.getBoundingClientRect();
    const l = list.getBoundingClientRect();
    return {
        borderRight: style.borderRightWidth,
        columns: window.getComputedStyle(document.querySelector('.search-body')).gridTemplateColumns,
        besideTheList: Math.round(r.right) <= Math.round(l.left) + 1,
        sharesTheTop: Math.abs(Math.round(r.top) - Math.round(l.top)) <= 2,
    };
});

const paints = (colour) => colour !== ''
    && !/rgba\(0,\s*0,\s*0,\s*0\)/.test(colour)
    && !/transparent/.test(colour);

test.describe('the mode switch', () => {
    test('stands beside the list rather than under it', async ({ page }) => {
        await openSearch(page);
        const rail = await railPlace(page);

        expect(rail.besideTheList, 'the rail is not left of the results').toBe(true);
        expect(rail.sharesTheTop, 'the rail starts somewhere else than the list').toBe(true);
        expect(parseFloat(rail.borderRight), 'nothing separates the rail from the list').toBeGreaterThan(0);
        // Two columns: the rail's own width, and what is left for the results.
        expect(rail.columns.split(' ').length, `the panel body is not two columns: ${rail.columns}`).toBe(2);
    });

    test('one position is lit, and it is the one in force', async ({ page }) => {
        await openSearch(page);

        const active = await page.evaluate(() => {
            const tabs = [...document.querySelectorAll('.search-mode-tab')];
            return {
                count: tabs.length,
                lit: tabs.filter((t) => t.classList.contains('active')).length,
                mode: tabs.find((t) => t.classList.contains('active'))?.dataset.mode ?? null,
            };
        });

        /*
         * Six positions: search, commands and finders, then the two modes that
         * used to be buttons in the header -- tags and recents -- and the door
         * to the cheat sheet. Only the five modes can be lit; the door never
         * is, which is why the count below still finds exactly one.
         */
        expect(active.count, 'the rail lost a rung').toBe(6);
        expect(active.lit, 'more than one position is lit at once').toBe(1);
        expect(active.mode, 'the key that opened the panel is not the lit one').toBe('search');
    });
});
