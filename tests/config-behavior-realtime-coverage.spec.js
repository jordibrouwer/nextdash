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
 * Known-failing, deliberately not fixed here. Empty now; the history:
 *
 * showDate (Behavior → Date, time & weather) only drew or removed #date-element
 * after a reload, until it, showTime and showWeatherWithDate got the 'chrome'
 * special that re-runs updateDateVisibility.
 *
 * densityMode was here too, until its setting got the 'chromeRender' it
 * needed for body[data-density-mode] to follow without a reload.
 *
 * showShortcuts was the third. It became shortcutDisplay -- three answers
 * instead of two -- and the rewrite carried the 'chrome' handler it had always
 * needed, so it is guarded below rather than excused here.
 *
 * A setting found here and fixed later goes in with its fix, and the test
 * starts guarding it.
 */
const KNOWN_BROKEN = new Set([]);

async function load(page) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    // config is a lazy-loading stub until a section is opened; behaviorSchema
    // lives on the real module.
    await page.evaluate(() => (window.dashboardInstance.config.behaviorTab = window.dashboardInstance.config.behaviorTab || 'general', window.dashboardInstance.config).openConfigView('behavior'));
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
    showCheatSheetButton: 'data-show-cheatsheet-button',
    showAddBookmarkButton: 'data-show-add-bookmark-button',
    showSearchButton: 'data-show-search-button',
    showFindersButton: 'data-show-finders-button',
    showCommandsButton: 'data-show-commands-button',
    showRecentButton: 'data-show-recent-button',
    showTagCloudButton: 'data-show-tag-cloud-button',
    shortcutDisplay: 'data-shortcut-display',
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
            } else if (c.type === 'select' || c.type === 'cards') {
                // 'cards' is a select drawn as a row of choices -- same
                // options, same one-of-them value, and just as capable of not
                // reaching the body attribute it is supposed to move.
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
    // `previewCard` is handled before the switch rather than inside it: it
    // repaints the sample card beside the checklist, which every one of the
    // three preview fields has to do.
    // `siteNews` drops or refetches the overview's news stream, both directions.
    // `search` hands the search component a new pool: it keeps its own copy,
    // built when the data loads, so a setting that decides what goes into that
    // pool takes effect on the next reload and looks like it did nothing.
    // `healthBadge` redraws the Bookmarks icon's count (Config → Bookmarks → View).
    const handled = ['language', 'datetime', 'chrome', 'chromeRender', 'render', 'shortcutTooltips',
        'visual', 'feeds', 'previewCard', 'siteNews', 'search', 'healthBadge', 'inboxBadge'];
    expect(used.length).toBeGreaterThan(3);
    expect(used.filter((s) => !handled.includes(s))).toEqual([]);
});

// Hypr mode and the date line's toggles had no apply step: Hypr mode stayed as
// it was, and with the date, time and weather all off the date line did not
// come back when one was turned on -- until a reload.
test('Hypr mode and the date toggles apply without a reload', async ({ page }) => {
    await load(page);
    const result = await page.evaluate(async () => {
        const d = window.dashboardInstance;
        const cfg = d.config;
        const special = (field) => {
            for (const panel of cfg.behaviorSchema()) {
                const c = (panel.controls || []).find((x) => x.field === field);
                if (c) return c.special;
            }
            return undefined;
        };
        await cfg.setBehavior('hyprMode', true, special('hyprMode'));
        const hypr = window.hyprMode?.isEnabled?.() ?? window.hyprMode?.enabled;
        await cfg.setBehavior('hyprMode', false, special('hyprMode'));
        for (const f of ['showDate', 'showTime', 'showWeatherWithDate']) await cfg.setBehavior(f, false, special(f));
        const goneWhenOff = !document.getElementById('date-element');
        await cfg.setBehavior('showDate', true, special('showDate'));
        return { hypr, goneWhenOff, back: Boolean(document.getElementById('date-element')) };
    });
    expect(result.hypr, 'Hypr mode did not switch on').toBe(true);
    expect(result.goneWhenOff).toBe(true);
    expect(result.back, 'the date line did not come back').toBe(true);
});

// "Reset panel" put the values back and saved, but skipped each setting's own
// apply step: a reset language left the page in the old one until a reload.
test('Reset panel applies a reset language at once', async ({ page }) => {
    await load(page);
    const result = await page.evaluate(async () => {
        const d = window.dashboardInstance;
        const cfg = d.config.instance || d.config;
        await cfg.setBehavior('language', 'nl', 'language');
        const before = d.language.currentLanguage;
        const box = document.createElement('div');
        box.innerHTML = '<button data-panel-reset="language"></button>'
            + '<select data-behavior-field="language" data-behavior-special="language"></select>';
        document.body.appendChild(box);
        const realConfirm = window.AppModal.confirm;
        window.AppModal.confirm = async () => true;
        try {
            cfg.bindPanelResetActions(box);
            box.querySelector('button').click();
            const until = Date.now() + 5000;
            while (d.language.currentLanguage === before && Date.now() < until) {
                await new Promise((r) => setTimeout(r, 50));
            }
        } finally {
            window.AppModal.confirm = realConfirm;
            box.remove();
        }
        return { before, after: d.language.currentLanguage, saved: d.settings.language };
    });
    expect(result.before).toBe('nl');
    expect(result.saved).toBe('en');
    expect(result.after, 'the page stayed in the old language').toBe('en');
});
