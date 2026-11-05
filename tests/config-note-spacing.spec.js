// @ts-check
const { test, expect } = require('./fixtures');
const { WRITE_TOKEN, markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays, waitForConfigReady } = require('./e2e-helpers');

/**
 * The line under a field has room above it.
 *
 * A note, hint or warning under a control had margin-top: -4px and the field's
 * row gap is 4px: nothing between the dropdown and the sentence that explains
 * it. It is one token now, --config-note-gap, in every theme.
 */
async function openTab(page, tab) {
    await markWhatsNewSeen(page);
    await page.setViewportSize({ width: 1500, height: 1000 });
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await waitForConfigReady(page);
    await page.evaluate(async (t) => {
        const c = window.dashboardInstance.config;
        c.appearanceTab = t;
        await c.openConfigView('appearance');
    }, tab);
    await page.waitForSelector('.config-field > .config-panel-note, .config-field > .config-field-hint', { timeout: 20_000 });
    // A note's width is in ch: measure it in the theme's own font.
    await page.evaluate(() => document.fonts.ready);
}

/** Distance from the controls above a note to the note, for every note under a field. */
const gaps = (page) => page.evaluate(() => {
    const out = [];
    for (const note of document.querySelectorAll('.config-field > :is(.config-panel-note, .config-field-hint, .config-field-warning)')) {
        const r = note.getBoundingClientRect();
        if (!r.height || !r.width) continue;
        // What ends above the note, in any column: the row the note sits under.
        // A note is capped at 60ch, so under a short label it can stop a fraction
        // of a pixel before the control's column; measured from its own columns
        // only, it was measured from the label, which the taller control centres
        // 10px higher, and the same layout passed or failed on 0.2px of text
        // width. A control beside the note (it starts above it and ends below its
        // top) is a different layout, not a note with no room: it is left out.
        // So is the ℹ/↺ pair: on a row with a note it overhangs by 4px on
        // purpose (hit area, not layout; config-view.css says so).
        const above = [...note.parentElement.children]
            .filter((el) => {
                const b = el.getBoundingClientRect();
                return el !== note && !el.matches('.config-field-affordances')
                    && b.height > 0 && b.bottom <= r.top + 0.5;
            })
            .map((el) => el.getBoundingClientRect().bottom);
        if (!above.length) continue;
        out.push(Math.round((r.top - Math.max(...above)) * 10) / 10);
    }
    return out;
});

for (const theme of ['slate-dark', 'porcelain-light']) {
    test.describe(`notes under fields, ${theme}`, () => {
        test.beforeEach(async ({ request }) => {
            expect((await request.post('/api/settings', { headers: { 'X-NextDash-Token': WRITE_TOKEN }, data: { theme } })).ok()).toBe(true);
        });
        for (const tab of ['surface', 'display', 'layout']) {
            test(`${tab}: 6 to 10px between a field and its note`, async ({ page }) => {
                await openTab(page, tab);
                const found = await gaps(page);
                expect(found.length, 'no notes under fields on this tab').toBeGreaterThan(0);
                for (const gap of found) {
                    expect(gap).toBeGreaterThanOrEqual(6);
                    expect(gap).toBeLessThanOrEqual(10);
                }
            });
        }
    });
}
