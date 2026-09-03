// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissBlockingOverlays, dismissOnboardingIfPresent } = require('./e2e-helpers');

/**
 * A row draws the marks it has, and builds nothing for the ones it has not.
 *
 * Written first to hold a removed rollout flag in place — whatever the grid
 * renders, it renders after — and kept for what came next: the pin, note and
 * fresh spans used to be built on every row and then emptied, 345 of them
 * carrying `is-empty` and `display: none` on a page of 115 rows. They are only
 * built when there is something to put in them now.
 *
 * The invariant therefore inverted on purpose. It used to be "every row carries
 * all three spans"; it is now "a row carries a span only when it draws one".
 * The tally underneath is unchanged and still does the original job: the set of
 * mark shapes the grid produces, and how many rows wear each.
 */
const fingerprint = (page) => page.evaluate(() => {
    const rows = [...document.querySelectorAll('.bookmark-link')];
    return rows.map((row) => {
        const read = (sel) => {
            const el = row.querySelector(sel);
            // Absent is now a real, expected answer, and a distinct one from a
            // span that exists and draws nothing.
            if (!el) return 'absent';
            return [
                el.className,
                el.getAttribute('aria-hidden') || '',
                el.getAttribute('role') || '',
                el.getAttribute('title') || '',
                el.getAttribute('aria-label') || '',
                el.getAttribute('data-note-tooltip') || '',
                el.querySelectorAll('svg').length,
                el.textContent.trim(),
            ].join('|');
        };
        return {
            url: row.getAttribute('data-bookmark-url'),
            pin: read('.bookmark-pin-badge'),
            note: read('.bookmark-note-badge'),
            fresh: read('.bookmark-fresh-badge'),
        };
    });
});

test('the pin, note and fresh marks are what they were', async ({ page }) => {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('.bookmark-link', { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => (window.dashboardInstance?.bookmarks || []).length > 0,
        null, { timeout: 15_000 });

    // Give the grid a drawn mark to capture as well as empty ones: with every
    // badge empty the snapshot would only ever prove the `else` branch, and the
    // flag sat in the `if`. Pinned through the key a reader presses, with the
    // setting on, so the drawn branch is genuinely reached.
    await page.evaluate(() => { window.dashboardInstance.settings.showPinIcon = true; });
    await page.keyboard.press('ArrowDown');
    await page.waitForFunction(
        () => Boolean(window.dashboardInstance?.keyboardNavigation?.getSelectedBookmark?.()),
        null, { timeout: 10_000 });
    /*
     * Shift+P toggles, and this file shares its data directory with the rest of
     * the suite. A row an earlier spec left pinned turns the press below into an
     * unpin: nothing on the page then draws a pin, and the assertion further
     * down fails on this test's own setup rather than on anything the grid did.
     * Cleared first, so the press that matters is always the one that pins.
     */
    const selectedIsPinned = () => page.evaluate(() => Boolean(
        window.dashboardInstance?.keyboardNavigation?.getSelectedBookmark?.()?.pinned));
    if (await selectedIsPinned()) {
        await page.keyboard.press('Shift+P');
        await expect.poll(selectedIsPinned, { timeout: 10_000 }).toBe(false);
    }

    await page.keyboard.press('Shift+P');
    await expect
        .poll(() => page.evaluate(() => document.querySelectorAll(
            '.bookmark-pin-badge:not(.is-empty)').length), { timeout: 10_000 })
        .toBeGreaterThan(0);

    const marks = await fingerprint(page);
    expect(marks.length).toBeGreaterThan(0);
    expect(marks.some(m => m.pin && !m.pin.includes('is-empty')),
        'no row ended up with a drawn pin, so the drawn branch is untested').toBe(true);

    // No row builds a span it has nothing to draw in. An `is-empty` anywhere
    // means the old always-build path is back.
    for (const row of marks) {
        for (const kind of ['pin', 'note', 'fresh']) {
            expect(row[kind], `${kind} span on ${row.url} is built but empty`)
                .not.toContain('is-empty');
        }
    }

    // The shapes the grid draws, counted rather than listed in order: pinning
    // sorts a row to the top, so the sequence depends on which row this run
    // happened to select. What must not change is the set of mark shapes and
    // how many rows wear each — that is what the flag could have altered.
    const tally = {};
    for (const row of marks) {
        for (const kind of ['pin', 'note', 'fresh']) {
            const key = `${kind} ${row[kind]}`;
            tally[key] = (tally[key] || 0) + 1;
        }
    }
    const sorted = Object.fromEntries(Object.entries(tally).sort(([a], [b]) => a.localeCompare(b)));
    expect(JSON.stringify(sorted, null, 2)).toMatchSnapshot('row-marks.json');
});
