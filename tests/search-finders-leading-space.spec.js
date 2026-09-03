// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissBlockingOverlays, dismissOnboardingIfPresent } = require('./e2e-helpers');

/**
 * Pressing space right after `?` must not leave it in the query.
 *
 * addToQuery() appends every key first and only afterwards asks whether space
 * should complete a finder shortcut -- which it does by trimming the query and
 * checking that against the shortcut list. A bare "?" trims to "", no finder
 * is keyed on the empty string, so the check silently falls through and the
 * space that was already appended stays: the query becomes "? ", and whatever
 * is typed next lands after that space instead of being read as a shortcut
 * letter. "?" then space then "jordi" becomes "? jordi" -- searched as
 * literal text against finder names, which is why nothing was ever found.
 */
async function openFinders(page) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('.bookmark-link', { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.keyboard.press('?');
    await expect
        .poll(() => page.evaluate(() => Boolean(window.dashboardInstance?.searchComponent?.isActive?.())),
            { timeout: 15_000 })
        .toBe(true);
}

const currentQuery = (page) => page.evaluate(
    () => window.dashboardInstance.searchComponent.currentQuery,
);

test.describe('finders mode ignores a leading space', () => {
    test('space right after ? does not enter the query', async ({ page }) => {
        await openFinders(page);
        expect(await currentQuery(page)).toBe('?');

        await page.keyboard.press('Space');
        // Nothing to complete a shortcut from yet, so the space is not typed.
        expect(await currentQuery(page)).toBe('?');
    });

    test('typing after that space reads as finder letters, not as text after it', async ({ page }) => {
        await openFinders(page);
        await page.keyboard.press('Space');
        await page.keyboard.type('jordi');

        // Exactly what a reader would have typed had the space done nothing --
        // no gap between the prefix and the letters. Finder mode uppercases
        // keystrokes as they arrive (shortcuts are stored and shown that way),
        // so the letters themselves are as typed by the keyboard handler, not
        // by this test.
        expect(await currentQuery(page)).toBe('?JORDI');
    });

    test('a real finder shortcut still completes with its trailing space', async ({ page }) => {
        await openFinders(page);
        // No finder ships in the fixture, so give the component one directly
        // rather than depend on shared seed data existing.
        const shortcut = await page.evaluate(() => {
            const fc = window.dashboardInstance.searchComponent.findersComponent;
            const letter = 'g';
            fc.shortcuts.set(letter, { shortcut: letter, name: 'Google', searchUrl: 'https://example.com/?q=%s' });
            return letter;
        });

        // completeShortcutWithSpace fires the moment the query matches a known
        // shortcut -- typing the letter is enough, nothing further to press.
        // This is the guard this fix must not disturb: a real completion still
        // gets its trailing space.
        await page.keyboard.type(shortcut);

        expect(await currentQuery(page)).toBe(`?${shortcut.toUpperCase()} `);
    });
});
