// @ts-check
const { test, expect } = require('./fixtures');
const { dismissOnboardingIfPresent, dismissBlockingOverlays, markWhatsNewSeen } = require('./e2e-helpers');

/**
 * Every Behavior setting has to take effect without a reload.
 *
 * setBehavior's `default` case re-renders the bookmark grid, which is right for
 * the many settings read at render time — and silently wrong for the ones whose
 * effect lives somewhere else: an attribute on <body> that only setupDOM writes,
 * a timer that is only read when armed, listeners bound once at startup. Those
 * need a `special` handler, and forgetting one produces a setting that saves,
 * reports "Saved", and visibly does nothing until F5.
 *
 * That has now happened three times (showShortcutTooltips, weatherRefreshMinutes,
 * and the chrome group before them), so rather than testing the three known
 * cases this walks behaviorSchema() itself. A newly added setting is covered the
 * day it is added, without anyone remembering to write a test.
 */

/** Fields whose live effect this test cannot judge from the DOM alone. */
const UNTESTABLE = new Set([
    // Re-inits the whole language layer and re-renders; covered by its own specs.
    'language',
    // Free-text endpoints and keys: nothing renders until they are exercised.
    'monitorNotifyUrl', 'calendarUrl', 'weatherLocation',
]);

/**
 * Known-failing, deliberately not fixed here.
 *
 * All three were found by this test and then confirmed by hand through the real
 * config UI: the setting saves and the control reflects it, but the <body>
 * attribute CSS keys off is never rewritten, so nothing moves until a reload.
 *
 *   showDate      Behavior → Date, time & weather. setBehavior's 'datetime'
 *                 case calls renderDateWeatherLine(); only updateDateVisibility()
 *                 adds or removes #date-element. Turning the date off leaves it
 *                 on screen.
 *   showShortcuts Appearance → Display. Plain bool, no special, but
 *                 body[data-show-shortcuts="false"] is what hides the letters.
 *   densityMode   Appearance → Layout. special: 'render' re-renders the grid,
 *                 but the spacing comes from body[data-density-mode].
 *
 * Each needs 'chrome' (or 'chromeRender'), which is a behaviour change to ship
 * deliberately rather than fold into a test commit. Remove from this list with
 * the fix and the test starts guarding it.
 */
const KNOWN_BROKEN = new Set(['showDate', 'showShortcuts', 'densityMode']);

async function load(page) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    // config is a lazy-loading stub until a section is opened; behaviorSchema
    // lives on the real module.
    await page.evaluate(() => window.dashboardInstance.config.openConfigView('behavior'));
    await page.waitForFunction(() =>
        typeof window.dashboardInstance.config.behaviorSchema === 'function', null, { timeout: 15_000 });
}

/**
 * The <body> attributes setupDOM mirrors settings onto, and the setting behind
 * each. CSS keys off these, so a change that never re-runs setupDOM is invisible
 * however many times the grid re-renders.
 */
const BODY_MIRRORED = {
    showTitle: 'data-show-title',
    showDate: 'data-show-date',
    showConfigButton: 'data-show-config-button',
    showHealthDashboard: 'data-show-health-dashboard',
    showCheatSheetButton: 'data-show-cheatsheet-button',
    showAddBookmarkButton: 'data-show-add-bookmark-button',
    showSearchButton: 'data-show-search-button',
    showFindersButton: 'data-show-finders-button',
    showCommandsButton: 'data-show-commands-button',
    showRecentButton: 'data-show-recent-button',
    showTagCloudButton: 'data-show-tag-cloud-button',
    showShortcuts: 'data-show-shortcuts',
    layoutPreset: 'data-layout-preset',
    densityMode: 'data-density-mode',
};

test('every body-mirrored Behavior setting is applied live by setBehavior', async ({ page }) => {
    await load(page);

    const result = await page.evaluate(async ({ mirrored, untestable }) => {
        const d = window.dashboardInstance;
        const cfg = d.config;
        const failures = [];
        const checked = [];

        // Flatten the schema: every control, with the group's tab for reporting.
        const controls = [];
        for (const panel of cfg.behaviorSchema()) {
            for (const c of panel.controls || []) controls.push({ ...c, tab: panel.tab || 'general' });
        }

        for (const c of controls) {
            const attr = mirrored[c.field];
            if (!attr || untestable.includes(c.field)) continue;

            const before = document.body.getAttribute(attr);
            const original = d.settings[c.field];

            // Pick a value that must change the attribute.
            let next;
            if (c.type === 'checkbox') {
                next = !(before === 'true');
            } else if (c.type === 'select') {
                const other = (c.options || []).map((o) => o.value)
                    .find((v) => String(v) !== String(before));
                if (other === undefined) continue;
                next = other;
            } else {
                continue;
            }

            // Drive the real path, exactly as the rendered control does.
            await cfg.setBehavior(c.field, next, c.special);
            const after = document.body.getAttribute(attr);
            checked.push(c.field);
            if (String(after) === String(before)) {
                failures.push(`${c.field} (tab: ${c.tab}, special: ${c.special || 'none'}) `
                    + `left ${attr}="${after}" — needs a chrome/chromeRender handler`);
            }

            // Put it back through the same path so the next field starts clean.
            await cfg.setBehavior(c.field, original, c.special);
        }
        return { failures, checked, total: controls.length };
    }, { mirrored: BODY_MIRRORED, untestable: [...UNTESTABLE] });

    // Sanity: the walk has to have actually exercised the schema.
    expect(result.total).toBeGreaterThan(40);
    expect(result.checked.length).toBeGreaterThan(10);

    const broken = result.failures.filter((f) => [...KNOWN_BROKEN].some((k) => f.startsWith(k)));
    const fresh = result.failures.filter((f) => !broken.includes(f));

    // Anything not already on the known list is a regression.
    expect(fresh, `settings that no longer apply live:\n${fresh.join('\n')}`).toEqual([]);
    // And if a known one starts working, say so rather than keeping it excused.
    expect(broken.length,
        'a KNOWN_BROKEN setting now applies live — remove it from the list so this test guards it')
        .toBe(KNOWN_BROKEN.size);
});

/**
 * Guards the schema's own shape: a `special` that no longer matches a case in
 * setBehavior falls through to the default re-render, which is exactly the
 * silent failure this file exists to catch.
 */
test('every special in the schema is one setBehavior actually handles', async ({ page }) => {
    await load(page);
    const used = await page.evaluate(() => {
        const specials = new Set();
        for (const p of window.dashboardInstance.config.behaviorSchema()) {
            for (const c of p.controls || []) if (c.special) specials.add(c.special);
        }
        return [...specials];
    });
    // `visual` runs applyVisualSettings, for fields written onto <body> that
    // neither the render nor the chrome pass touches — launcherIconSize.
    // `feeds` polls once when Fresh is switched on, so the dashboard is not
    // blank until the scheduler's next wake.
    const handled = ['language', 'datetime', 'chrome', 'chromeRender', 'render', 'shortcutTooltips', 'visual', 'feeds'];
    expect(used.length).toBeGreaterThan(3);
    expect(used.filter((s) => !handled.includes(s))).toEqual([]);
});
