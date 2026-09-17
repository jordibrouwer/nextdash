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

test('on a glass theme, plain controls stand on the band with nothing behind them', async ({ page }) => {
    await openDashboard(page);
    await page.evaluate(async () => {
        const d = window.dashboardInstance;
        Object.assign(d.settings, { theme: 'tarnished-brass-dark', themeDepth: 'glass', headerButtonStyle: 'plain' });
        await d.saveSettings?.();
    });
    await page.reload();
    await page.waitForSelector('.bookmark-link', { timeout: 20_000 });
    await dismissBlockingOverlays(page);
    expect(await page.evaluate(() => document.body.getAttribute('data-depth'))).toBe('glass');

    const behind = () => page.evaluate(() => [...document.querySelectorAll(
        '.header-top .page-nav-btn, .header-top .search-button, .header-top .header-shortcuts, '
        + '.header-top .dashboard-link-anchor, .header-top .health-link-anchor, .header-top .config-link-anchor',
    )].filter((el) => el.getBoundingClientRect().width > 0)
        .map((el) => {
            const s = window.getComputedStyle(el);
            return { el: el.id || String(el.className), bg: s.backgroundColor, filter: s.backdropFilter };
        }));

    const plain = await behind();
    expect(plain.length).toBeGreaterThan(0);
    for (const c of plain) {
        expect(c.bg, `${c.el} paints a ground`).toMatch(/rgba\(0, 0, 0, 0\)|transparent/);
        expect(c.filter, `${c.el} still blurs what is behind it`).toBe('none');
    }

    // Each in its own box keeps the glass.
    await chooseStyle(page, 'plated');
    const plated = await behind();
    expect(plated.some((c) => c.filter !== 'none'), 'plated lost its glass').toBe(true);
});

test('plated leaves the actions and tabs in the header bare, hover included; a dock keeps its plate', async ({ page }) => {
    await openDashboard(page);
    await page.evaluate(async () => {
        const d = window.dashboardInstance;
        Object.assign(d.settings, { theme: 'tarnished-brass-dark', themeDepth: 'glass', headerButtonStyle: 'plated', pageSwitcherStyle: 'classic', actionBarPosition: 'header' });
        await d.saveSettings?.();
    });
    await page.reload();
    await page.waitForSelector('.bookmark-link', { timeout: 20_000 });
    await dismissBlockingOverlays(page);

    const ground = (sel) => page.locator(sel).first().evaluate((el) => {
        const s = window.getComputedStyle(el);
        return { bg: s.backgroundColor, shadow: s.boxShadow, filter: s.backdropFilter };
    });
    const hover = async (sel) => {
        const box = await page.locator(sel).first().boundingBox();
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.waitForTimeout(300);
        return ground(sel);
    };
    const bare = /rgba\(0, 0, 0, 0\)|transparent/;

    for (const sel of ['#search-button', '#page-navigation .page-nav-btn:not([hidden])']) {
        const rest = await ground(sel);
        expect(rest.bg, `${sel} paints a ground`).toMatch(bare);
        expect(rest.filter, `${sel} blurs what is behind it`).toBe('none');
        const over = await hover(sel);
        expect(over.bg, `${sel} lights a wash on hover`).toMatch(bare);
        expect(over.shadow, `${sel} casts on hover`).toBe('none');
        await page.mouse.move(700, 600);
    }
    // The destinations are still the plates.
    expect((await ground('.config-link-anchor')).bg).not.toMatch(bare);

    // Docked, the bar is a plate and its hover is its own.
    await page.evaluate(() => {
        const d = window.dashboardInstance;
        d.settings.actionBarPosition = 'bottom';
        d.setupDOM?.();
    });
    await page.waitForTimeout(400);
    expect((await ground('.header-shortcuts')).bg, 'the dock lost its plate').not.toMatch(bare);
    const docked = await hover('#search-button');
    expect(docked.bg, 'the dock lost its hover').not.toMatch(bare);
});

test('a rule stands between the pages and the actions when both are in the header', async ({ page }) => {
    await openDashboard(page);
    const setup = async (settings) => {
        await page.evaluate(async (next) => {
            const d = window.dashboardInstance;
            Object.assign(d.settings, next);
            await d.saveSettings?.();
            d.config?.applyChromeSettings?.();
        }, settings);
        await page.waitForTimeout(400);
    };
    const rule = () => page.evaluate(() => {
        const el = document.querySelector('.header-zone-divider--pages');
        const drawn = el && window.getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().width > 0;
        if (!drawn) return { drawn: false };
        const r = el.getBoundingClientRect();
        const tabs = [...document.querySelectorAll('#page-navigation .page-nav-btn')]
            .filter((b) => b.getBoundingClientRect().width > 0);
        const actions = document.querySelector('.header-shortcuts').getBoundingClientRect();
        return {
            drawn: true,
            afterPages: tabs.every((b) => b.getBoundingClientRect().right <= r.left + 1),
            beforeActions: r.right <= actions.left + 1,
        };
    });

    await setup({ headerButtonStyle: 'plated', pageSwitcherStyle: 'classic', actionBarPosition: 'header', actionBarEnabled: true });
    const inHeader = await rule();
    expect(inHeader.drawn, 'no rule between the pages and the actions').toBe(true);
    expect(inHeader.afterPages).toBe(true);
    expect(inHeader.beforeActions).toBe(true);

    await setup({ actionBarPosition: 'bottom' });
    expect((await rule()).drawn, 'the rule stayed after the actions left the header').toBe(false);

    await setup({ actionBarPosition: 'header', pageSwitcherStyle: 'text' });
    expect((await rule()).drawn, 'a rule beside pages that stand in the middle').toBe(false);
});
