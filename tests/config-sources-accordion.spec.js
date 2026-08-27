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
        const chips = await page.evaluate(() =>
            [...document.querySelectorAll('.config-source-chip')].map((c) => c.textContent.trim()));
        // One per source, and none of them blank.
        expect(chips.length).toBeGreaterThan(4);
        expect(chips.filter((c) => c === '')).toEqual([]);
    });
});

/*
 * The same fold on Backups & data.
 *
 * Five stacked panels of buttons is the same wall the sources tab was. The
 * Backup panel stays open: it is the reason the tab exists, and folding the
 * Download button behind a click would trade one problem for another.
 */
test.describe('the backups tab', () => {
    async function openBackups(page) {
        await markWhatsNewSeen(page);
        await page.goto('/');
        await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
        await dismissOnboardingIfPresent(page);
        await dismissBlockingOverlays(page);
        await page.evaluate(() => window.dashboardInstance.config.openConfigView('data-backups'));
        await page.waitForSelector('.config-source-panel', { timeout: 15_000 });
    }

    test('the panels fold, with the primary one left open', async ({ page }) => {
        await openBackups(page);
        const state = await page.evaluate(() => {
            const panels = [...document.querySelectorAll('.config-source-panel')];
            return {
                panels: panels.length,
                open: panels.filter((d) => d.open).length,
                firstOpen: panels[0]?.open === true,
                firstTitle: panels[0]?.querySelector('.config-panel-title')?.textContent?.trim(),
                // A closing tag in the wrong place shows up as a panel inside a panel.
                nested: document.querySelectorAll('.config-source-panel .config-source-panel').length,
            };
        });
        expect(state.panels).toBe(5);
        expect(state.open).toBe(1);
        expect(state.firstOpen).toBe(true);
        expect(state.nested).toBe(0);
    });

    test('the actions still reach their handlers', async ({ page }) => {
        await openBackups(page);
        // Download sits in the open panel; the rest are behind a fold but in
        // the DOM, which is what lets the tab's own loader fill them.
        await expect(page.locator('[data-backup-action="download"]')).toBeVisible({ timeout: 15_000 });
        const present = await page.evaluate(() => ({
            importZip: document.querySelectorAll('[data-backup-action="import"]').length,
            csv: document.querySelectorAll('[data-backup-action="csv-export"]').length,
            settings: document.querySelectorAll('[data-backup-action="settings-export"]').length,
        }));
        expect(present).toEqual({ importZip: 1, csv: 1, settings: 1 });
    });

    test('opening a folded panel reveals its buttons', async ({ page }) => {
        await openBackups(page);
        const panel = page.locator('.config-source-panel').nth(2);
        await panel.locator('summary').click();
        await expect(page.locator('[data-backup-action="import"]')).toBeVisible({ timeout: 15_000 });
    });

    /*
     * A fold survives the tab redrawing itself.
     *
     * <details> keeps its open state in the DOM, and this tab replaces its
     * whole body after a backup runs or a list reloads — so the panel someone
     * had just opened snapped shut under them, mid-task.
     */
    test('an opened panel stays open when the tab redraws', async ({ page }) => {
        await openBackups(page);

        await page.locator('.config-source-panel').nth(1).locator('summary').click();
        await expect.poll(async () => page.evaluate(() =>
            document.querySelectorAll('.config-source-panel[open]').length),
        { timeout: 15_000 }).toBe(2);

        // The same redraw a backup or an import triggers.
        await page.evaluate(() => {
            const cfg = window.dashboardInstance.config?.instance || window.dashboardInstance.config;
            cfg.repaintBackupSection?.() ?? cfg.render?.();
        });

        await expect.poll(async () => page.evaluate(() =>
            [...document.querySelectorAll('.config-source-panel')].map((d) => d.open)),
        { timeout: 15_000 }).toEqual([true, true, false, false, false]);
    });

    // And a panel shut on purpose stays shut, or the one that opens by default
    // could never be closed for longer than one repaint.
    test('a panel closed on purpose stays closed', async ({ page }) => {
        await openBackups(page);
        const state = await page.evaluate(() => {
            const cfg = window.dashboardInstance.config?.instance || window.dashboardInstance.config;
            const before = cfg.foldIsOpen('backup:create', true);
            cfg.rememberFold('backup:create', false);
            return { before, after: cfg.foldIsOpen('backup:create', true) };
        });
        // Open by default, and still shut after being shut — a default that
        // reasserted itself on every repaint would be a panel that will not
        // close.
        expect(state).toEqual({ before: true, after: false });
    });
});
