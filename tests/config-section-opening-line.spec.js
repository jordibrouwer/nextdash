// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * Every config section opens the same way.
 *
 * The section's own sentence sits on the view band under the title, and a
 * second, shorter line under the tab strip says what the open tab is for.
 * Each section used to answer this differently: Bookmarks and Statistics had
 * nothing under the strip, Data & backups showed its band line a second time
 * above the strip, and Help kept its line — and its PDF link — above the tabs
 * entirely. The visible effect was that the tabs moved up and down the page as
 * you walked the rail, which is the one thing a fixed strip must not do.
 *
 * Compared against each other rather than against numbers, so the shared
 * design can change without rewriting the test.
 */

const SECTIONS = ['bookmarks', 'structure', 'widgets', 'data-backups', 'stats', 'help', 'behavior', 'appearance'];

async function openSection(page, section) {
    await page.setViewportSize({ width: 1500, height: 1000 });
    await markWhatsNewSeen(page);
    await page.goto(`/#config/${section}`);
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForSelector('#config-view-body .config-subtabs', { timeout: 20_000 });
}

const readSection = (page) => page.evaluate(() => {
    const body = document.querySelector('#config-view-body');
    const desc = document.querySelector('.config-view-head .lvs-description');
    const strip = document.querySelector('#config-view-body .config-subtabs');
    const head = document.querySelector('.config-view-head');
    const note = document.querySelector('#config-view-body .config-tab-note, #config-view-body .config-panel-note');
    return {
        band: desc && !desc.hidden ? (desc.textContent || '').trim() : '',
        // The band owns the line; a copy left in the body is the bug.
        strayIntros: body?.querySelectorAll('.config-view-intro').length ?? 0,
        // Measured from the band, not the viewport: the view arrives under a
        // transform, so an absolute top is whatever the animation had reached.
        // The gap between band and strip is the thing that must not differ.
        stripOffset: strip && head
            ? Math.round(strip.getBoundingClientRect().top - head.getBoundingClientRect().bottom)
            : null,
        note: note ? (note.textContent || '').trim() : '',
    };
});

test.describe('every config section opens the same way', () => {
    for (const section of SECTIONS) {
        test(`${section} states what it is, once, and what the tab is for`, async ({ page }) => {
            await openSection(page, section);
            // Data & backups fills its tiles from the server and repaints; the
            // duplicate only appeared on that second draw.
            await expect.poll(() => readSection(page).then((s) => s.strayIntros), { timeout: 10_000 }).toBe(0);

            const seen = await readSection(page);
            expect(seen.band.length).toBeGreaterThan(10);
            expect(seen.note.length).toBeGreaterThan(10);
            expect(seen.note).not.toBe(seen.band);
        });
    }

    test('the tab strip stands the same distance below the band in every section', async ({ page }) => {
        const tops = {};
        for (const section of SECTIONS) {
            await openSection(page, section);
            await expect.poll(() => readSection(page).then((s) => s.strayIntros), { timeout: 10_000 }).toBe(0);
            tops[section] = (await readSection(page)).stripOffset;
        }
        const values = Object.values(tops);
        expect(new Set(values).size, `strip offsets differ: ${JSON.stringify(tops)}`).toBe(1);
    });
});
