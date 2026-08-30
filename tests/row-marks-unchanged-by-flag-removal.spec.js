// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissBlockingOverlays, dismissOnboardingIfPresent } = require('./e2e-helpers');

/**
 * Deleting a rollout flag that always said yes changes no row.
 *
 * `isDashboardPinNoteRowIconsEnabled()` was frozen at `true` — a whole file, a
 * deprecated alias, and a call read on every row render, guarding a rollout that
 * finished. The safe way to remove it is not to reason about what it gated but
 * to pin the output: whatever the grid renders now, it renders after.
 *
 * This captures the marks on every row as a fingerprint. It passes before the
 * removal and must still pass after; a diff means the flag was doing something
 * nobody remembered.
 */
const fingerprint = (page) => page.evaluate(() => {
    const rows = [...document.querySelectorAll('.bookmark-link')];
    return rows.map((row) => {
        const read = (sel) => {
            const el = row.querySelector(sel);
            if (!el) return null;
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
    await page.keyboard.press('Shift+P');
    await expect
        .poll(() => page.evaluate(() => document.querySelectorAll(
            '.bookmark-pin-badge:not(.is-empty)').length), { timeout: 10_000 })
        .toBeGreaterThan(0);

    const marks = await fingerprint(page);
    expect(marks.length).toBeGreaterThan(0);
    expect(marks.some(m => m.pin && !m.pin.includes('is-empty')),
        'no row ended up with a drawn pin, so the drawn branch is untested').toBe(true);

    // Every row carries all three spans — the badge is always built, empty or
    // not (see D2 in IDEAS.md). That invariant is what the removal must keep.
    for (const row of marks) {
        expect(row.pin, `pin span missing on ${row.url}`).not.toBeNull();
        expect(row.note, `note span missing on ${row.url}`).not.toBeNull();
        expect(row.fresh, `fresh span missing on ${row.url}`).not.toBeNull();
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
