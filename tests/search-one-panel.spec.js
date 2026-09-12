// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * One panel with three modes, and the keys that name them keep working.
 *
 * Search, commands and finders have been one overlay with one segmented
 * switch for a while. What made it read as three things anyway was that the
 * keys only worked on the way in: ">" opened into search and from there ":"
 * and "?" switched, but from commands or finders every mode key was typed
 * into the query instead. ":" then "?" left ":?B ", "?" then ">" left "?B >",
 * and the only ways to another mode were the mouse and Escape.
 *
 * Only while nothing has been typed. Past that the key is a character, which
 * is what lets a command carry a URL -- and switching mode under someone
 * mid-sentence would throw away what they had written.
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

test.describe('the command surface switches mode on a key', () => {
    for (const from of ['>', ':', '?']) {
        for (const to of ['>', ':', '?']) {
            if (from === to) continue;
            test(`${from} then ${to} lands in ${MODE[to]}`, async ({ page }) => {
                await dashboard(page);
                await openIn(page, from);
                await page.keyboard.press(KEY[to]);

                await expect.poll(() => state(page).then((s) => s.mode),
                    { message: `${from} to ${to} did not switch` }).toBe(MODE[to]);

                // And the key that switched is not also in the query.
                const { query } = await state(page);
                expect(query, `the key was typed as well: ${query}`).not.toContain(`${from}${to}`);
            });
        }
    }

    test('pressing the mode you are already in changes nothing', async ({ page }) => {
        await dashboard(page);
        await openIn(page, ':');
        const before = await state(page);

        await page.keyboard.press(KEY[':']);
        await page.waitForTimeout(300);

        expect(await state(page), 'the key doubled up in the query').toEqual(before);
    });
});

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
