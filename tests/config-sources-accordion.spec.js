// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissBlockingOverlays, dismissOnboardingIfPresent } = require('./e2e-helpers');

/**
 * The sources tab, folded shut.
 *
 * Seven services stacked open is a wall to scroll past before reaching the one
 * you came for, and every one of them shows a token box. Native <details>
 * carries the keyboard behaviour and the screen-reader semantics; the contents
 * stay in the DOM while shut, so everything that fills those fields goes on
 * working whether or not anyone has opened them.
 */

async function openSources(page) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.evaluate(() => window.dashboardInstance.config.openConfigView('data-backups'));
    await page.click('[data-db-tab="sources"]');
    await page.waitForSelector('.config-source-panel', { timeout: 15_000 });
}

test.describe('the sources tab', () => {
    test('every panel starts shut', async ({ page }) => {
        await openSources(page);
        const state = await page.evaluate(() => {
            const panels = [...document.querySelectorAll('.config-source-panel')];
            return { panels: panels.length, open: panels.filter((d) => d.open).length };
        });
        expect(state.panels).toBeGreaterThan(4);
        expect(state.open).toBe(0);
    });

    test('a shut panel still says what it is and whether it is set up', async ({ page }) => {
        await openSources(page);
        const summaries = await page.evaluate(() =>
            [...document.querySelectorAll('.config-source-panel > summary')].map((s) => ({
                title: s.querySelector('.config-panel-title')?.textContent?.trim() || '',
                note: s.querySelector('.config-source-summary-note')?.textContent?.trim() || '',
            })));
        expect(summaries.length).toBeGreaterThan(4);
        for (const summary of summaries) {
            expect(summary.title.length).toBeGreaterThan(0);
            // A row of identical headings tells you nothing; each says what the
            // service is even while folded.
            expect(summary.note.length).toBeGreaterThan(10);
        }

        // And the chip carries the one fact that decides whether to open it.
        await expect.poll(async () => page.evaluate(() =>
            [...document.querySelectorAll('.config-source-chip')].filter((c) => c.textContent.trim()).length),
        { timeout: 15_000 }).toBeGreaterThan(0);
    });

    /*
     * The fields are in the DOM while shut, which is what lets the loader fill
     * them without opening anything.
     */
    test('the controls exist before a panel is opened', async ({ page }) => {
        await openSources(page);
        const present = await page.evaluate(() => ({
            run: document.querySelectorAll('[data-source-action="run"]').length,
            save: document.querySelectorAll('[data-source-action="save"]').length,
            open: document.querySelectorAll('.config-source-panel[open]').length,
        }));
        expect(present.open).toBe(0);
        expect(present.run).toBeGreaterThan(4);
        expect(present.save).toBeGreaterThan(4);
    });

    test('opening one reveals its fields', async ({ page }) => {
        await openSources(page);
        await page.locator('.config-source-panel > summary').first().click();

        await expect.poll(async () => page.evaluate(() =>
            document.querySelectorAll('.config-source-panel[open]').length),
        { timeout: 15_000 }).toBe(1);

        const visible = await page.evaluate(() => {
            const panel = document.querySelector('.config-source-panel[open]');
            const control = panel?.querySelector('[data-source-action="run"]');
            return !!control?.offsetParent;
        });
        expect(visible).toBe(true);
    });

    /*
     * Two sources need no token, and the state loader used to give up before
     * restoring anything for them.
     *
     * It read the token note first and returned when there was none — so Hacker
     * News favourites and a YouTube channel never had their handle, their page
     * or their last result put back. The comment in that function says a panel
     * that forgot which account it points at is a panel nobody trusts; those
     * were the two that forgot.
     */
    test('a source that needs no token still gets its state back', async ({ page }) => {
        await openSources(page);
        /*
         * Polled, because the chips are filled by the state loader rather than
         * by the render that puts them on screen -- each arrives when its own
         * source has been read. Taken in one go the moment the panels appear,
         * this counted the ones not filled yet as blank, which is a race the
         * assertion never meant to run: an unfilled chip is hidden by
         * `.config-source-chip:empty`, so nobody sees the state it was failing
         * on. On a loaded runner five of them lost it.
         */
        await expect.poll(() => page.evaluate(() =>
            [...document.querySelectorAll('.config-source-chip')].filter((c) => !c.textContent.trim()).length),
        { timeout: 15_000 }).toBe(0);

        // One per source, and by now none of them blank.
        const chips = await page.evaluate(() => document.querySelectorAll('.config-source-chip').length);
        expect(chips).toBeGreaterThan(4);
    });
});
