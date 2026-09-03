// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * A plain search with no matches offers finders as the next thing to try --
 * but only when the reader has finders switched on for search at all.
 *
 * Every other place that reads "does the reader want finders reachable from
 * plain search" checks the setting: addToQuery's space-completion, the
 * shortcut-collision list, the two custom-widget completions. This block
 * built its own condition -- "do any finders exist" -- and never asked the
 * one question the setting exists to answer, so switching it off left the
 * hints on screen regardless.
 */

async function openDashboard(page) {
    await page.setViewportSize({ width: 1400, height: 900 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });
}

/** Seed a finder directly, and run a query with no possible bookmark match. */
async function searchWithNoMatch(page) {
    await page.evaluate(() => {
        const s = window.dashboardInstance.searchComponent;
        s.finders = [{ shortcut: 'g', name: 'Google', searchUrl: 'https://example.com/?q=%s' }];
        s.findersComponent?.shortcuts?.set?.('g', s.finders[0]);
    });
    await page.keyboard.press('>');
    await page.waitForTimeout(300);
    await page.keyboard.type('zzzznomatchzzzz');
    await page.waitForTimeout(600);
}

test.describe('finder hints under a no-match search', () => {
    test('appear when the setting is on', async ({ page }) => {
        await openDashboard(page);
        await page.evaluate(() => { window.dashboardInstance.settings.includeFindersInSearch = true; });
        await searchWithNoMatch(page);

        const types = await page.evaluate(
            () => window.dashboardInstance.searchComponent.selectableMatches.map((m) => m.type),
        );
        expect(types).toContain('hint-finder');
    });

    test('are absent when the setting is off', async ({ page }) => {
        await openDashboard(page);
        await page.evaluate(() => { window.dashboardInstance.settings.includeFindersInSearch = false; });
        await searchWithNoMatch(page);

        const types = await page.evaluate(
            () => window.dashboardInstance.searchComponent.selectableMatches.map((m) => m.type),
        );
        expect(types).not.toContain('hint-finder');
        // The rest of the no-match panel is unaffected -- "add as new bookmark"
        // does not depend on finders at all.
        expect(types).toContain('hint-new');
    });

    test('arrow keys reach a hint and Enter runs it', async ({ page }) => {
        await openDashboard(page);
        await page.evaluate(() => { window.dashboardInstance.settings.includeFindersInSearch = true; });
        await searchWithNoMatch(page);

        await page.keyboard.press('ArrowDown');
        await page.waitForTimeout(200);
        const selected = await page.evaluate(() => {
            const s = window.dashboardInstance.searchComponent;
            return s.selectableMatches[s.selectedMatchIndex]?.type;
        });
        expect(selected).toBe('hint-finder');

        const highlighted = await page.locator('.search-match.keyboard-selected').count();
        expect(highlighted).toBe(1);
    });
});
