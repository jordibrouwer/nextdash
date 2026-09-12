// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * A command can carry a URL.
 *
 * The keys that open a mode -- ">", ":", "/", "?" -- were handled above the
 * branch that reads a command's text, so none of them ever reached it. Typing
 * ":new https://example.com/a?b=1" produced "/:new https:/example.com/a?B b=1":
 * the first slash was read as the fuzzy-mode switch and moved to the front of
 * the query, the second was eaten, and the "?" opened finders inside the
 * command. The branch existed all along; it just sat in the wrong place.
 *
 * Shift+Period rather than type('>'): Playwright's type() synthesises the
 * character without the shift a real keyboard sends, and the handler reads the
 * modifier.
 */

const KEY = { '>': 'Shift+Period', ':': 'Shift+Semicolon', '?': 'Shift+Slash' };
const MODE = { '>': 'search', ':': 'command', '?': 'finder' };

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

const state = (page) => page.evaluate(() => ({
    query: window.dashboardInstance.searchComponent.currentQuery,
    mode: document.querySelector('.search-mode-tab.active')?.dataset.mode ?? null,
}));

const close = (page) => page.evaluate(() => window.dashboardInstance.searchComponent.closeSearch());

async function openIn(page, key) {
    await close(page);
    await page.keyboard.press(KEY[key]);
    await expect.poll(() => state(page).then((s) => s.mode)).toBe(MODE[key]);
}

test.describe('past the entry a mode key is a character', () => {
    test('a command carries a URL, query string and all', async ({ page }) => {
        await dashboard(page);
        await openIn(page, ':');

        await page.keyboard.type('new https://example.com/a');
        await page.keyboard.press(KEY['?']);
        await page.keyboard.type('b=1');

        // Every one of these was lost before: the first slash was read as the
        // fuzzy-mode switch and moved to the front of the query, the second
        // was eaten, and the "?" opened finders inside the command. What came
        // out was "/:new https:/example.com/a?B b=1".
        await expect.poll(() => state(page).then((s) => s.query))
            .toBe(':new https://example.com/a?b=1');
    });

    test('and typing does not switch the mode out from under you', async ({ page }) => {
        await dashboard(page);
        await openIn(page, ':');
        await page.keyboard.type('new x');

        await page.keyboard.press(KEY['>']);
        await page.waitForTimeout(300);

        const { mode, query } = await state(page);
        expect(mode, 'a half-typed command jumped to search').toBe('command');
        expect(query, 'the character did not land').toBe(':new x>');
    });

    test('a finder keeps its terms when a mode key is one of them', async ({ page }) => {
        await dashboard(page);
        await openIn(page, '?');

        await page.keyboard.type('a');
        await page.keyboard.press(KEY['>']);
        await page.keyboard.type('b');

        await expect.poll(() => state(page).then((s) => s.query)).toBe('?B a>b');
    });
});
