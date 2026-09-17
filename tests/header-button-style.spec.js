// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays, waitForConfigReady } = require('./e2e-helpers');

/**
 * Two headers, and the reader picks.
 *
 * Plain is the header as it was before the three-zone draft: bare glyphs on the
 * band, nothing around them, and a 2px accent rule under the page you are on or
 * the view you are in. Plated is the draft's own answer — every control in a box
 * of its own, on the theme's surface, with an edge and a cast.
 *
 * One answer for all three groups: the page tabs, the actions and the
 * destinations. A header with two of them plated and one bare reads as a
 * mistake rather than as a choice.
 */
async function openDashboard(page) {
    await page.setViewportSize({ width: 1500, height: 900 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('.bookmark-link', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    // These specs measure the actions in the header; a fresh install docks
    // them at the bottom now.
    await page.evaluate(async () => {
        const d = window.dashboardInstance;
        d.settings.actionBarPosition = 'header';
        d.setupDOM?.();
        await d.saveSettings?.();
    });
    // A second page, so there is a tab that is not the one you are on: the
    // active one is what the rule is measured against.
    await page.evaluate(async () => {
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        const d = window.dashboardInstance;
        if (d.pages.length < 2) {
            const saved = await api('/api/pages', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify([...d.pages, { id: 5150, name: 'elsewhere' }]),
            });
            if (!saved.ok) throw new Error(`seeding pages failed: ${saved.status}`);
            await d.loadData();
            d.pageNav?.renderPageNavigation?.();
        }
    });
    await page.waitForTimeout(300);
}

async function chooseStyle(page, style) {
    await page.evaluate(async (value) => {
        const d = window.dashboardInstance;
        d.settings.headerButtonStyle = value;
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        await api('/api/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(d.settings),
        });
        d.config?.applyChromeSettings?.();
    }, style);
    await page.waitForTimeout(300);
}

const drawn = (page) => page.evaluate(() => {
    const read = (sel) => {
        const el = document.querySelector(sel);
        if (!el) return null;
        const cs = window.getComputedStyle(el);
        return {
            border: parseFloat(cs.borderTopWidth),
            underline: parseFloat(cs.borderBottomWidth),
            underlineColour: cs.borderBottomColor,
            background: cs.backgroundColor,
            shadow: cs.boxShadow,
        };
    };
    return {
        attribute: document.body.getAttribute('data-header-buttons'),
        tab: read('.header-track .page-nav-btn:not(.active)'),
        activeTab: read('.header-track .page-nav-btn.active'),
        action: read('.header-shortcuts .search-button'),
        group: read('.header-shortcuts'),
        shell: read('#page-navigation'),
        destination: read('.config-link-anchor'),
        activeDestination: read('.dashboard-link-anchor'),
    };
});

test('plain is what a fresh install draws, and nothing carries a box', async ({ page }) => {
    await openDashboard(page);
    const seen = await drawn(page);

    expect(seen.attribute, 'the default is not the plain header').toBe('plain');

    for (const part of ['tab', 'action', 'destination']) {
        expect(seen[part].border, `${part} still draws a box`).toBe(0);
        expect(seen[part].shadow, `${part} still carries a plate`).toBe('none');
        expect(seen[part].background, `${part} still paints its own ground`)
            .toMatch(/rgba\(0, 0, 0, 0\)|transparent/);
    }
    // The two surrounds go with them.
    expect(seen.group.border, 'the action group kept its box').toBe(0);
    expect(seen.shell.border, 'the page switcher kept its shell').toBe(0);
});

test('the rule under it is what says where you are', async ({ page }) => {
    await openDashboard(page);
    const seen = await drawn(page);

    // Every control keeps the space for the rule, so nothing moves when it lights.
    expect(seen.tab.underline, 'a tab has no room for the rule').toBe(2);
    expect(seen.activeTab.underline).toBe(2);
    expect(seen.activeTab.underlineColour, 'the page you are on is not marked')
        .not.toBe(seen.tab.underlineColour);
    // The dashboard destination is lit on the grid; config is not.
    expect(seen.activeDestination.underlineColour).toBe(seen.activeTab.underlineColour);
    expect(seen.destination.underlineColour).toBe(seen.tab.underlineColour);
});

test('plated puts every control back in a box', async ({ page }) => {
    await openDashboard(page);
    await chooseStyle(page, 'plated');
    const seen = await drawn(page);

    expect(seen.attribute).toBe('plated');
    expect(seen.destination.border, 'a destination lost its edge').toBe(1);
    expect(seen.destination.shadow, 'a destination lost its plate').not.toBe('none');
    // The segmented switcher is the shell, and its segments stay flat inside it.
    expect(seen.shell.border, 'the page switcher lost its shell').toBe(1);
    expect(seen.group.border, 'the action group lost its surround').toBe(1);
});

test('the choice is a setting, and it survives a reload', async ({ page }) => {
    await openDashboard(page);
    await waitForConfigReady(page);
    await page.evaluate(() => (window.dashboardInstance.config.appearanceTab = window.dashboardInstance.config.appearanceTab || 'general', window.dashboardInstance.config).openConfigView('appearance'));
    await page.waitForSelector('.config-view', { timeout: 20_000 });
    await page.locator('[data-appearance-tab="header"]').click();
    await page.waitForTimeout(200);

    const select = page.locator('[data-behavior-field="headerButtonStyle"]');
    await expect(select).toBeVisible();
    await select.selectOption('plated');

    await expect.poll(() => page.evaluate(
        () => document.body.getAttribute('data-header-buttons')), { timeout: 5_000 }).toBe('plated');

    await page.reload();
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    expect(await page.evaluate(
        () => document.body.getAttribute('data-header-buttons'))).toBe('plated');
    expect(await page.evaluate(
        () => document.documentElement.getAttribute('data-header-buttons'))).toBe('plated');
});
