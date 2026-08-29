// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays,
    prepareDashboardInteraction } = require('./e2e-helpers');

/**
 * Four ways the config view did something other than what it said.
 *
 * A button bound twice and exported twice. A control that lost focus to <body>
 * on every change. A page selector that threw away unsaved widget edits. And a
 * setting the server refused while the field went on showing it under "Saved".
 */
async function openStats(page) {
    await markWhatsNewSeen(page);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.config != null,
        null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await prepareDashboardInteraction(page);
    await page.evaluate(() => window.dashboardInstance.config.openConfigView('stats'));
    await expect.poll(() => page.evaluate(() => window.dashboardInstance.activeView),
        { timeout: 25_000 }).toBe('config');
    await expect(page.locator('[data-stats-action="export"]')).toBeVisible({ timeout: 20_000 });
}

const cfg = () => {
    const c = window.dashboardInstance.config;
    return c.instance || c;
};

test('a repaint does not leave the stats buttons bound twice', async ({ page }) => {
    await openStats(page);

    /*
     * repaintStatsBody replaces the foot and rebinds it, then rebinds again
     * over the whole dashboard container -- and the first is a descendant of
     * the second, so every [data-stats-action] button ended up with two click
     * listeners. Export is not idempotent: two listeners meant two files in
     * the user's downloads for one click.
     */

    await page.evaluate(() => {
        const c = (window.dashboardInstance.config.instance || window.dashboardInstance.config);
        window.__calls = 0;
        c.exportStatsCSV = function () { window.__calls += 1; return Promise.resolve(); };
    });

    // The repaint a sub-tab click or a range button causes.
    await page.evaluate(() => {
        const c = (window.dashboardInstance.config.instance || window.dashboardInstance.config);
        c.repaintStatsBody();
    });

    const button = page.locator('[data-stats-action="export"]');
    await expect(button).toHaveCount(1);
    await button.click();

    const calls = await page.evaluate(() => window.__calls);
    expect(calls, `one click ran the export ${calls} times`).toBe(1);
});

test('changing an Appearance control keeps the focus on it', async ({ page }) => {
    await markWhatsNewSeen(page);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.config != null,
        null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await prepareDashboardInteraction(page);
    await page.evaluate(() => window.dashboardInstance.config.openConfigView('appearance'));
    await expect.poll(() => page.evaluate(() => window.dashboardInstance.activeView),
        { timeout: 25_000 }).toBe('config');

    /*
     * captureControlPanelFocus looked for data-appearance-field, which is
     * rendered nowhere -- the attributes Appearance actually emits are
     * -toggle, -select, -text and -range. So it returned the no-op restorer
     * and every repaint dropped focus to <body>, sending the next Tab back to
     * the top of the page. The comment above it describes exactly this hazard
     * as already fixed.
     */
    const toggle = page.locator('[data-appearance-toggle]').first();
    await expect(toggle).toBeVisible({ timeout: 15_000 });
    const field = await toggle.getAttribute('data-appearance-toggle');

    await toggle.focus();
    await toggle.click();
    await page.waitForTimeout(600);

    const landed = await page.evaluate(() => {
        const el = document.activeElement;
        return {
            tag: (el?.tagName || '').toLowerCase(),
            field: el?.getAttribute?.('data-appearance-toggle') || null,
        };
    });
    expect(landed.tag, 'focus fell out of the control it was on').not.toBe('body');
    expect(landed.field, 'focus did not return to the control that was changed').toBe(field);
});

test('switching page keeps an unsaved widget draft, or asks first', async ({ page }) => {
    await markWhatsNewSeen(page);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.config != null,
        null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await prepareDashboardInteraction(page);
    await page.evaluate(() => window.dashboardInstance.config.openConfigView('widgets'));
    await expect.poll(() => page.evaluate(() => window.dashboardInstance.activeView),
        { timeout: 25_000 }).toBe('config');

    /*
     * The page selector wiped _widgetDrafts outright. Widgets is the one
     * section with an explicit save -- everywhere else applies immediately --
     * so an edit in flight is real work, and it went without a word.
     * widgetDraftDirty() already existed and was simply never consulted here.
     */
    const state = await page.evaluate(() => {
        const c = window.dashboardInstance.config.instance || window.dashboardInstance.config;
        if (!(c._widgetBlocks || []).length) return { skip: true };
        // A draft that differs from what is stored, the way typing does.
        const draft = c.widgetDraft(0, { create: true });
        if (!draft) return { skip: true };
        draft.config = { ...(draft.config || {}), __probe: 'unsaved' };
        return { skip: false, dirty: c.widgetDraftDirty(0) };
    });
    test.skip(state.skip === true, 'needs at least one widget on the page');
    expect(state.dirty, 'the probe did not make the draft dirty').toBe(true);

    const kept = await page.evaluate(() => {
        const c = window.dashboardInstance.config.instance || window.dashboardInstance.config;
        return typeof c.widgetDraftsDirty === 'function' && c.widgetDraftsDirty();
    });
    expect(kept, 'nothing can tell whether any draft is unsaved').toBe(true);
});

test('a rejected archive URL does not keep reading as saved', async ({ page }) => {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.config != null,
        null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await prepareDashboardInteraction(page);

    /*
     * The server requires a {url} placeholder and quietly substitutes the
     * default when it is missing. Nothing told the client, so the field kept
     * showing the typed text under a "Saved" indicator and only reverted on
     * the next reload -- the exact "said Saved, did nothing" shape the clamps
     * exist to avoid.
     */
    const out = await page.evaluate(async () => {
        const d = window.dashboardInstance;
        const before = d.settings.bookmarkArchiveUrl;
        d.settings.bookmarkArchiveUrl = 'https://archive.ph/';
        await d.data.saveSettings();
        const inMemory = d.settings.bookmarkArchiveUrl;
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        const stored = (await (await api('/api/settings')).json())?.bookmarkArchiveUrl;
        d.settings.bookmarkArchiveUrl = before;
        await d.data.saveSettings();
        return { inMemory, stored };
    });

    expect(out.stored, 'the server did not clamp the value').not.toBe('https://archive.ph/');
    expect(out.inMemory, 'the client kept a value the server refused').toBe(out.stored);
});
