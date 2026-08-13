// @ts-check
const { test, expect } = require('@playwright/test');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * Escape empties the multi-selection.
 *
 * This was reported as missing, but it already works: keyboard-navigation.js's
 * Escape case clears the selection before it clears the row cursor, so one
 * press does not take both. These tests were written to cover a fix and ended
 * up documenting the existing behaviour instead — kept because none of it was
 * pinned anywhere, and the part that is easy to break is the ordering, not the
 * clearing.
 *
 * The ordering is the substance: a popover open *over* a selection takes
 * Escape first and leaves the selection intact. That works because every
 * popover listens on the capture phase and stops the event there, while
 * keyboard-navigation additionally bails out when a popover element is in the
 * document. Either mechanism alone would do it; both are load-bearing only in
 * the sense that removing both would break this.
 */

async function openDashboard(page) {
    await page.setViewportSize({ width: 1400, height: 900 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => !!window.dashboardInstance?.multiSelect, null, { timeout: 20_000 });
}

const rows = (page) => page.locator('.bookmark-link[data-bookmark-index]');
const selectionCount = (page) =>
    page.evaluate(() => window.dashboardInstance.multiSelect.count());

/** Tick rows through the module, the way x/Shift+Z does. */
async function selectRows(page, indices) {
    await page.evaluate((idx) => {
        const ms = window.dashboardInstance.multiSelect;
        const all = [...document.querySelectorAll('.bookmark-link[data-bookmark-index]')];
        idx.forEach((i) => ms.toggleRow(all[i]));
    }, indices);
}

test.describe('Escape and the multi-selection', () => {
    test('clears the selection and hides the toolbar', async ({ page }) => {
        await openDashboard(page);
        await selectRows(page, [0, 1]);
        expect(await selectionCount(page)).toBe(2);
        await expect(page.locator('.multi-select-toolbar')).toHaveCount(1);

        await page.keyboard.press('Escape');

        expect(await selectionCount(page)).toBe(0);
        await expect(page.locator('.multi-select-toolbar')).toHaveCount(0);
    });

    // The case the report named: with a popover up, Escape belongs to the
    // popover. Clearing the selection here would take two states away for one
    // keypress and lose the selection the popover was about to act on.
    test('closes an open popover first and keeps the selection', async ({ page }) => {
        await openDashboard(page);
        await selectRows(page, [0, 1]);

        await rows(page).nth(0).click({ button: 'right' });
        await page.waitForSelector('#bookmark-context-menu', { timeout: 10_000 });
        await page.click('#bookmark-context-menu [data-action="multi-move"]');
        await expect(page.locator('#move-popover')).toBeVisible();

        await page.keyboard.press('Escape');

        await expect(page.locator('#move-popover')).toHaveCount(0);
        expect(await selectionCount(page), 'the selection went with the popover').toBe(2);

        // And the next Escape, with nothing in the way, does clear it.
        await page.keyboard.press('Escape');
        expect(await selectionCount(page)).toBe(0);
    });

    test('closes the context menu first and keeps the selection', async ({ page }) => {
        await openDashboard(page);
        await selectRows(page, [0, 1]);

        await rows(page).nth(0).click({ button: 'right' });
        await page.waitForSelector('#bookmark-context-menu', { timeout: 10_000 });

        await page.keyboard.press('Escape');

        await expect(page.locator('#bookmark-context-menu')).toHaveCount(0);
        expect(await selectionCount(page)).toBe(2);
    });
});
