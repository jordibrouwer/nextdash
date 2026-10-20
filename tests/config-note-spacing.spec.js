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
}

/** Distance from the controls above a note to the note, for every note under a field. */
const gaps = (page) => page.evaluate(() => {
    const out = [];
    for (const note of document.querySelectorAll('.config-field > :is(.config-panel-note, .config-field-hint, .config-field-warning)')) {
        const r = note.getBoundingClientRect();
        if (!r.height || !r.width) continue;
        // What is above the note in its own columns. A control in the next column
        // beside a note that holds only the label's column is a different layout,
        // not a note with no room.
        const above = [...note.parentElement.children]
            .filter((el) => {
                const b = el.getBoundingClientRect();
                return el !== note && b.height > 0 && b.top < r.top && b.left < r.right - 1 && b.right > r.left + 1;
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
