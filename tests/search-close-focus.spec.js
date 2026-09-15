// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * Closing search gives the grid back, not the button.
 *
 * closeSearch() handed focus to the element the panel was opened from, falling
 * back to #search-button — so leaving search left the ring on a header icon
 * with nothing selected under it, and the next arrow key started again from the
 * top of the page. The row you were on is where you were; a reader who had not
 * picked one starts at the first row on the page.
 */
async function openDashboard(page) {
    await page.setViewportSize({ width: 1500, height: 900 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('.bookmark-link', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
}

const focused = (page) => page.evaluate(() => {
    const active = document.activeElement;
    const row = active?.closest?.('.bookmark-link');
    const rows = [...document.querySelectorAll('.bookmark-link')];
    return {
        inHeader: Boolean(active?.closest?.('.section-controls')),
        rowIndex: row ? rows.indexOf(row) : -1,
        selectedIndex: rows.findIndex((el) => el.classList.contains('keyboard-selected')),
        cursor: window.dashboardInstance.keyboardNavigation?.currentIndex,
    };
});

test('closing search with no row picked lands on the first one', async ({ page }) => {
    await openDashboard(page);

    await page.keyboard.press('>');
    await expect.poll(() => page.evaluate(
        () => window.dashboardInstance.searchComponent?.isActive?.() === true,
    ), { timeout: 10_000 }).toBe(true);

    await page.keyboard.press('Escape');
    await expect.poll(() => page.evaluate(
        () => window.dashboardInstance.searchComponent?.isActive?.() === true,
    ), { timeout: 10_000 }).toBe(false);

    const seen = await focused(page);
    expect(seen.inHeader, 'the ring stayed on the header').toBe(false);
    expect(seen.selectedIndex, 'no row took the cursor').toBe(0);
    expect(seen.rowIndex, 'focus is not on the row that is selected').toBe(0);
});

test('closing search puts the cursor back on the row it was on', async ({ page }) => {
    await openDashboard(page);

    // Three rows down, through the keys a reader presses.
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    const before = await focused(page);
    expect(before.selectedIndex, 'the arrows did not move the cursor').toBeGreaterThan(0);

    await page.keyboard.press('>');
    await expect.poll(() => page.evaluate(
        () => window.dashboardInstance.searchComponent?.isActive?.() === true,
    ), { timeout: 10_000 }).toBe(true);
    // The panel takes the highlight with it while it is open.
    expect((await focused(page)).selectedIndex).toBe(-1);

    await page.keyboard.press('Escape');
    await expect.poll(() => page.evaluate(
        () => window.dashboardInstance.searchComponent?.isActive?.() === true,
    ), { timeout: 10_000 }).toBe(false);

    const after = await focused(page);
    expect(after.selectedIndex, 'the cursor came back somewhere else').toBe(before.selectedIndex);
    expect(after.rowIndex, 'focus is not on the row it marked').toBe(before.selectedIndex);
    expect(after.inHeader).toBe(false);

    // And the next arrow continues from there rather than from the top.
    await page.keyboard.press('ArrowDown');
    expect((await focused(page)).selectedIndex).toBe(before.selectedIndex + 1);
});

test('the button still takes focus back when there is no grid to return to', async ({ page }) => {
    await openDashboard(page);

    await page.evaluate(() => window.dashboardInstance.config.openConfigView());
    await page.waitForSelector('.config-view', { timeout: 20_000 });

    await page.evaluate(() => window.dashboardInstance.searchComponent?.openSearchInterface?.());
    await expect.poll(() => page.evaluate(
        () => window.dashboardInstance.searchComponent?.isActive?.() === true,
    ), { timeout: 10_000 }).toBe(true);

    await page.keyboard.press('Escape');
    await expect.poll(() => page.evaluate(
        () => window.dashboardInstance.searchComponent?.isActive?.() === true,
    ), { timeout: 10_000 }).toBe(false);

    // Nothing in config is a bookmark row, so the old behaviour stands.
    expect(await page.evaluate(() => Boolean(document.activeElement)), 'focus was dropped on the document')
        .toBe(true);
});
