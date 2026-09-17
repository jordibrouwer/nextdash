// @ts-check
const { test, expect } = require('./fixtures');
const { dismissOnboardingIfPresent, dismissBlockingOverlays, waitForConfigReady } = require('./e2e-helpers');

/**
 * Appearance → Toolbar & tabs was one panel of thirteen identical "Show the X
 * button" checkboxes: nothing to navigate by, and no way to tell which of them
 * meant the strip at the top and which the bar at the bottom.
 *
 * It is now three panels matching how the dashboard is actually built — the
 * header, and the two `.btn-group`s of the button bar — each with a Show all /
 * Hide all pair and a count of what is currently on. Since v1.3.0 the two
 * button-bar panels sit on the Button bar tab, beside the control that says
 * where that bar goes; Toolbar & tabs keeps the header, which is a different
 * strip.
 */

async function openToolbarTab(page) {
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await waitForConfigReady(page);
    await page.evaluate(() => (window.dashboardInstance.config.appearanceTab = window.dashboardInstance.config.appearanceTab || 'general', window.dashboardInstance.config).openConfigView('appearance'));
    await page.waitForSelector('.config-view', { timeout: 15_000 });
    await page.locator('[data-appearance-tab="header"]').click();
    await expect(page.locator('[data-appearance-tab="header"]')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('.config-panel-bulk').first()).toBeVisible();
}

async function openButtonBarTab(page) {
    await openToolbarTab(page);
    await page.locator('[data-appearance-tab="buttonbar"]').click();
    await expect(page.locator('[data-appearance-tab="buttonbar"]')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('.config-panel-bulk').first()).toBeVisible();
}

test.describe('the chrome toggles are grouped', () => {
    test('two panels, and every toggle kept', async ({ page }) => {
        await openToolbarTab(page);

        const panels = await page.evaluate(() => [
            ...window.dashboardInstance.config.panelsFor('appearance', 'header'),
            ...window.dashboardInstance.config.panelsFor('appearance', 'buttonbar'),
        ].map((p) => ({ title: p.title, fields: p.controls.map((c) => c.field) })));

        expect(panels).toHaveLength(2);
        // One panel for the header strip, one for the actions in it. The
        // actions were two groups — "main buttons" and "extras" — which was the
        // floating bar's own split into a row and a second row beside it.
        const perTab = await page.evaluate(() => ({
            toolbar: window.dashboardInstance.config.panelsFor('appearance', 'header').length,
            buttonbar: window.dashboardInstance.config.panelsFor('appearance', 'buttonbar').length,
        }));
        expect(perTab).toEqual({ toolbar: 1, buttonbar: 1 });
        // Not one setting lost or duplicated in the split. maxPageTabs, the
        // page switcher's style and the button style ride along in the header
        // panel, which is why this is three more than the toggles named below; the clock's placement sits with the clock, in
        // Behavior → Date & weather.
        const all = panels.flatMap((p) => p.fields);
        expect(all).toHaveLength(21);
        expect(new Set(all).size).toBe(21);
        expect(all).toEqual(expect.arrayContaining([
            'headerButtonStyle', 'showPageTabs', 'showPageNamesInTabs', 'showTitle', 'showDashboardButton',
            'showInboxButton', 'showHealthDashboard', 'showConfigButton', 'showPagesButton',
            'showAddBookmarkButton', 'showSearchButton', 'showCommandsButton', 'showFindersButton',
            'showRecentButton', 'showCheatSheetButton', 'showCollapseAllButton', 'showTagCloudButton',
            'actionBarPosition',
        ]));
    });

    test('each panel renders its own bulk pair and count', async ({ page }) => {
        await openToolbarTab(page);
        await expect(page.locator('.config-panel-bulk')).toHaveCount(1);
        // The count reads as "N of M shown" in every language.
        await expect(page.locator('[data-behavior-bulk-count]').first()).toHaveText(/\d+\D+\d+/);

        await page.locator('[data-appearance-tab="buttonbar"]').click();
        await expect(page.locator('.config-panel-bulk')).toHaveCount(1);
        await expect(page.locator('[data-behavior-bulk="show"]')).toHaveCount(1);
        await expect(page.locator('[data-behavior-bulk="hide"]')).toHaveCount(1);
    });

    test('the action bar tab carries every action toggle and no position picker', async ({ page }) => {
        await openButtonBarTab(page);
        // The bar had five places it could sit; it is the header now, so the
        // picker is gone along with the setting behind it.
        await expect(page.locator('[data-appearance-barpos]')).toHaveCount(0);
        await expect(page.locator('[data-behavior-field="showSearchButton"]')).toBeVisible();
        await expect(page.locator('[data-behavior-field="showRecentButton"]')).toBeVisible();
        await expect(page.locator('[data-behavior-field="showCommandsButton"]')).toBeVisible();
        await expect(page.locator('[data-behavior-field="showFindersButton"]')).toBeVisible();
        await expect(page.locator('[data-behavior-field="showCollapseAllButton"]')).toBeVisible();
        await expect(page.locator('[data-behavior-field="showTagCloudButton"]')).toBeVisible();
        // The pages button is an action now, so its switch stands with them.
        await expect(page.locator('[data-behavior-field="showPagesButton"]')).toBeVisible();
        // The header group stayed behind on Toolbar & tabs.
        await expect(page.locator('[data-behavior-field="showPageTabs"]')).toHaveCount(0);
    });
});

/*
 * The header panel switches what is in the header.
 *
 * Its toggles had nothing behind them until now: the keys printed beside the
 * page strip stayed when the strip was switched off, and the inbox could not
 * be switched off at all. The pages button moved to the action bar with the
 * rest of the actions, and its switch went with it.
 */
test('the header toggles reach the header', async ({ page }) => {
    await openToolbarTab(page);

    const shown = (sel) => page.evaluate((s) => {
        const el = document.querySelector(s);
        if (!el) return false;
        return window.getComputedStyle(el).display !== 'none'
            && el.getBoundingClientRect().width > 0;
    }, sel);

    expect(await shown('.header-track .page-navigation')).toBe(true);

    await page.locator('[data-behavior-field="showPageTabs"]').uncheck();
    await expect.poll(() => shown('.header-track .page-navigation'),
        { timeout: 5_000 }).toBe(false);

    await page.locator('[data-behavior-field="showInboxButton"]').uncheck();
    await expect.poll(() => page.evaluate(
        () => document.body.getAttribute('data-show-inbox-button')), { timeout: 5_000 }).toBe('false');

    expect(await shown('.dashboard-link')).toBe(true);
    await page.locator('[data-behavior-field="showDashboardButton"]').uncheck();
    await expect.poll(() => shown('.dashboard-link'), { timeout: 5_000 }).toBe(false);

    // And back: the switches go both ways without a reload.
    await page.locator('[data-behavior-field="showPageTabs"]').check();
    await expect.poll(() => shown('.header-track .page-navigation'),
        { timeout: 5_000 }).toBe(true);
    await page.locator('[data-behavior-field="showInboxButton"]').check();
    await page.locator('[data-behavior-field="showDashboardButton"]').check();
    await expect.poll(() => shown('.dashboard-link'), { timeout: 5_000 }).toBe(true);
});

/*
 * The tab is `header` now, and was `toolbar` when it was called "Toolbar &
 * tabs" -- so a saved link, or a browser tab left open across the change,
 * still carries the old word.
 */
test('the old address still opens the header tab', async ({ page }) => {
    await page.goto('/#config/appearance/toolbar');
    await page.waitForSelector('.config-view', { timeout: 15_000 });
    await dismissBlockingOverlays(page);
    await expect(page.locator('[data-appearance-tab="header"]'))
        .toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('[data-behavior-field="showPageTabs"]')).toBeVisible();
    // And the address is rewritten to the name the tab has now.
    await expect.poll(() => page.evaluate(() => window.location.hash))
        .toBe('#config/appearance/header');
});

test.describe('Show all / Hide all', () => {
    test('Hide all clears just its own panel and applies live', async ({ page }) => {
        await openToolbarTab(page);

        // Settings persist on the server between specs, so the other panel's
        // starting state is whatever a previous test left behind. Compare it
        // against itself rather than assuming it begins ticked.
        const otherPanelBefore = await page.evaluate(() => [
            'showAddBookmarkButton', 'showSearchButton', 'showCommandsButton', 'showFindersButton',
        ].map((f) => window.dashboardInstance.settings[f] !== false));

        // The header panel is the first; the main-buttons panel the second.
        const headerPanel = page.locator('.config-panel').filter({ has: page.locator('[data-behavior-field="showPageTabs"]') });
        await headerPanel.locator('[data-behavior-bulk="hide"]').click();

        await expect(page.locator('[data-behavior-field="showTitle"]')).not.toBeChecked();
        await expect(page.locator('[data-behavior-field="showConfigButton"]')).not.toBeChecked();

        // A different panel is untouched — the fields are scoped per panel.
        const otherPanelAfter = await page.evaluate(() => [
            'showAddBookmarkButton', 'showSearchButton', 'showCommandsButton', 'showFindersButton',
        ].map((f) => window.dashboardInstance.settings[f] !== false));
        expect(otherPanelAfter).toEqual(otherPanelBefore);

        // Chrome is written to <body>, so this proves it applied without a reload.
        await expect.poll(() => page.evaluate(() =>
            document.body.getAttribute('data-show-title'))).toBe('false');
        await expect.poll(() => page.evaluate(() =>
            document.body.getAttribute('data-show-config-button'))).toBe('false');
    });

    test('the count follows, and the pair disables at the ends', async ({ page }) => {
        await openToolbarTab(page);
        const headerPanel = page.locator('.config-panel').filter({ has: page.locator('[data-behavior-field="showPageTabs"]') });
        const count = headerPanel.locator('[data-behavior-bulk-count]');

        await headerPanel.locator('[data-behavior-bulk="hide"]').click();
        await expect(count).toHaveText(/\b0\b/);
        // Nothing left to hide.
        await expect(headerPanel.locator('[data-behavior-bulk="hide"]')).toBeDisabled();

        await headerPanel.locator('[data-behavior-bulk="show"]').click();
        await expect(count).toHaveText(/\b7\D+7\b/);
        await expect(headerPanel.locator('[data-behavior-bulk="show"]')).toBeDisabled();
        await expect(page.locator('[data-behavior-field="showPageTabs"]')).toBeChecked();
    });

    /**
     * The point of not looping over setBehavior: one click is one save, not one
     * per field.
     */
    test('a bulk click saves once, not once per field', async ({ page }) => {
        await openToolbarTab(page);
        let saves = 0;
        await page.route('**/api/settings', (route) => {
            if (route.request().method() !== 'GET') saves += 1;
            return route.continue();
        });

        const headerPanel = page.locator('.config-panel').filter({ has: page.locator('[data-behavior-field="showPageTabs"]') });
        await headerPanel.locator('[data-behavior-bulk="hide"]').click();
        await expect(page.locator('[data-behavior-field="showTitle"]')).not.toBeChecked();
        await page.waitForTimeout(600);

        expect(saves, `five fields must not mean five writes (saw ${saves})`).toBe(1);
    });

    test('the change survives a reload', async ({ page }) => {
        await openToolbarTab(page);
        const headerPanel = page.locator('.config-panel').filter({ has: page.locator('[data-behavior-field="showPageTabs"]') });
        await headerPanel.locator('[data-behavior-bulk="hide"]').click();
        await expect(page.locator('[data-behavior-field="showTitle"]')).not.toBeChecked();
        await page.waitForTimeout(700);

        await openToolbarTab(page);
        await expect(page.locator('[data-behavior-field="showTitle"]')).not.toBeChecked();
        await expect(page.locator('[data-behavior-field="showConfigButton"]')).not.toBeChecked();
    });
});

/**
 * repaintActiveControlPanels only knew about Behavior, so on the three
 * Appearance tabs that draw from the same schema the ↺ button wrote the
 * default and saved it but left the control showing the old value.
 */
test.describe('the schema-driven Appearance tabs repaint', () => {
    test('reset puts the control back, not just the setting', async ({ page }) => {
        await openToolbarTab(page);
        const box = page.locator('[data-behavior-field="showConfigButton"]');

        await box.uncheck();
        await expect(box).not.toBeChecked();
        await expect(page.locator('[data-reset-field="showConfigButton"]')).toBeVisible();

        await page.locator('[data-reset-field="showConfigButton"]').click();
        // The checkbox itself has to come back on — this is what was broken.
        await expect(page.locator('[data-behavior-field="showConfigButton"]')).toBeChecked();
    });

    /**
     * The repaint rebinds inside the replaced body only. Rebinding the whole
     * container would stack a second handler on the sub-tab strip, which lives
     * outside it, and one click would switch tabs twice.
     */
    test('a repaint does not double-bind the sub-tab strip', async ({ page }) => {
        await openToolbarTab(page);

        // Force several repaints — every settings write triggers one.
        for (let i = 0; i < 3; i += 1) {
            await page.locator('[data-behavior-field="showConfigButton"]').uncheck();
            await expect(page.locator('[data-behavior-field="showConfigButton"]')).not.toBeChecked();
            await page.locator('[data-behavior-field="showConfigButton"]').check();
            await expect(page.locator('[data-behavior-field="showConfigButton"]')).toBeChecked();
        }

        // The strip reports every activation, so counting those counts the
        // handlers. The end state stays correct with a doubled handler — it
        // just runs the switch again — so asserting on the tab alone would not
        // notice; with the container rebound this fires twelve times.
        await page.evaluate(() => {
            window.__subtabEvents = [];
            const original = window.nextdashTrack;
            window.nextdashTrack = (name, props) => {
                if (String(name).includes('subtab')) window.__subtabEvents.push(name);
                return original?.(name, props);
            };
        });

        await page.locator('[data-appearance-tab="layout"]').click();
        await expect.poll(() => page.evaluate(() =>
            window.dashboardInstance.config.appearanceTab)).toBe('layout');
        await expect(page.locator('[data-behavior-field="columnsPerRow"]')).toBeVisible();

        const fired = await page.evaluate(() => window.__subtabEvents.length);
        expect(fired, `one click must activate the tab once (fired ${fired}×)`).toBe(1);
    });
});
