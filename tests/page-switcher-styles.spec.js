// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * Three weights for the same switcher.
 *
 * A page used to be its own 40px box with a border, a glass fill and a plate
 * shadow — three of them standing in the middle of a band whose other controls
 * are 28px transparent icons, which made the pages the loudest thing in the
 * header rather than one of the things in it.
 *
 * It is a setting now. Segmented is the default: one shell with the pages flat
 * inside it. Text drops the box and marks the page you are on the way the
 * destinations do. Compact is one button naming the page, with the panel behind
 * it. The tabs, the keys and `,` are the same in all three — this is how much
 * room the switcher takes, not what it can do.
 */

async function openWithPages(page, count = 3) {
    await page.setViewportSize({ width: 1500, height: 900 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('.bookmark-link', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.evaluate(async (n) => {
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        const dash = window.dashboardInstance;
        const pages = [...dash.pages];
        for (let i = pages.length; i < n; i += 1) pages.push({ id: 2000 + i, name: `page-${i}` });
        const saved = await api('/api/pages', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(pages),
        });
        if (!saved.ok) throw new Error(`seeding pages failed: ${saved.status}`);
        await dash.loadData();
        dash.pageNav?.renderPageNavigation?.();
    }, count);
    await page.waitForTimeout(500);
    /*
     * The plated header, which is what the three switcher styles are drawn on.
     *
     * headerButtonStyle ships plain -- bare glyphs, a rule under the current
     * one -- and that strips the shell, the segments' wash and the chip's box,
     * which are exactly what this file measures. The two settings are
     * independent; the plain drawing is covered by header-button-style.spec.js.
     */
    await page.evaluate(async () => {
        const d = window.dashboardInstance;
        d.settings.headerButtonStyle = 'plated';
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        await api('/api/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(d.settings),
        });
        d.setupDOM?.();
    });
    await page.waitForTimeout(250);
}

/** Through the setting, the way config writes it — not by setting the attribute. */
async function chooseStyle(page, style) {
    await page.evaluate(async (value) => {
        const d = window.dashboardInstance;
        d.settings.pageSwitcherStyle = value;
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        await api('/api/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(d.settings),
        });
        d.config?.applyChromeSettings?.();
    }, style);
    await page.waitForTimeout(400);
}

const read = (page) => page.evaluate(() => {
    const box = (el) => {
        if (!el) return null;
        const cs = window.getComputedStyle(el);
        const r = el.getBoundingClientRect();
        return {
            height: Math.round(r.height),
            border: parseFloat(cs.borderTopWidth),
            radius: parseFloat(cs.borderTopLeftRadius),
            background: cs.backgroundColor,
            shadow: cs.boxShadow,
        };
    };
    const track = document.querySelector('#page-navigation');
    const active = track.querySelector('.page-nav-btn.active');
    return {
        attribute: document.body.getAttribute('data-page-switcher'),
        shell: box(track),
        tab: box(track.querySelector('.page-nav-btn:not(.active)')),
        active: box(active),
        underline: active
            ? window.getComputedStyle(active, '::after').content !== 'none'
            : false,
        visibleTabs: [...track.querySelectorAll('.page-nav-btn')].filter((b) => !b.hidden).length,
        chip: Boolean(track.querySelector('.page-nav-overflow')),
        chipDrawn: (() => {
            const chip = track.querySelector('.page-nav-overflow');
            return Boolean(chip) && window.getComputedStyle(chip).display !== 'none';
        })(),
    };
});

test('classic is what a fresh install draws', async ({ page }) => {
    await openWithPages(page);
    expect(await page.evaluate(() => document.body.getAttribute('data-page-switcher'))).toBe('classic');
});

test('classic stands the pages beside the destinations, underlined', async ({ page }) => {
    await openWithPages(page);
    await chooseStyle(page, 'segmented');
    await chooseStyle(page, 'classic');
    const seen = await read(page);

    expect(seen.attribute).toBe('classic');
    expect(seen.tab.border, 'a page is still a box').toBe(0);
    expect(seen.underline, 'nothing says which page you are on').toBe(true);

    // On the right half of the band, and nothing between them and the
    // destinations but the action group.
    const place = await page.evaluate(() => {
        const track = document.querySelector('.header-track').getBoundingClientRect();
        const dest = document.querySelector('.header-destinations').getBoundingClientRect();
        const band = document.querySelector('.header-top').getBoundingClientRect();
        return {
            rightHalf: track.left > band.left + band.width / 2,
            beforeDestinations: track.right <= dest.left + 1,
            arrows: [...document.querySelectorAll('.header-track .page-walk-hint')]
                .filter((el) => window.getComputedStyle(el).display !== 'none').length,
        };
    });
    expect(place.rightHalf, 'the pages still stand in the middle').toBe(true);
    expect(place.beforeDestinations, 'the pages are not before the destinations').toBe(true);
    expect(place.arrows, 'the walk arrows are drawn beside the numbers').toBe(0);

    // A tab is still a way to a page.
    const before = await page.evaluate(() => String(window.dashboardInstance.currentPageId));
    await page.locator('#page-navigation .page-nav-btn:not(.active):not([hidden])').first().click();
    await expect.poll(() => page.evaluate(() => String(window.dashboardInstance.currentPageId))).not.toBe(before);
});

test('segmented puts the pages in one shell', async ({ page }) => {
    await openWithPages(page);
    await chooseStyle(page, 'segmented');
    const seen = await read(page);

    expect(seen.attribute).toBe('segmented');
    // The box moved from the tabs to the shell around them.
    expect(seen.shell.border, 'the shell has no edge of its own').toBe(1);
    expect(seen.shell.height, `the shell is ${seen.shell.height}px tall`).toBe(40);
    expect(seen.tab.border, 'a segment still draws its own box').toBe(0);
    expect(seen.tab.height, `a segment is ${seen.tab.height}px tall`).toBe(28);
    expect(seen.tab.shadow, 'a segment still carries a plate').toBe('none');
    expect(seen.active.shadow, 'the active segment still glows').toBe('none');
    // The wash is what marks it.
    expect(seen.active.background).not.toBe(seen.tab.background);
});

test('text drops the box and underlines the page you are on', async ({ page }) => {
    await openWithPages(page);
    await chooseStyle(page, 'text');
    const seen = await read(page);

    expect(seen.attribute).toBe('text');
    expect(seen.shell.border, 'the shell survived into the text style').toBe(0);
    expect(seen.tab.border, 'a page is still a box').toBe(0);
    expect(seen.tab.shadow, 'a page still carries a plate').toBe('none');
    expect(seen.active.background, 'the page you are on is filled')
        .toMatch(/rgba\(0, 0, 0, 0\)|transparent/);
    expect(seen.underline, 'nothing says which page you are on').toBe(true);

    // Tabs, not a control panel: no walk arrows and no printed `,` beside them.
    const marks = await page.evaluate(() => ({
        arrows: [...document.querySelectorAll('.header-track .page-walk-hint')]
            .filter((el) => window.getComputedStyle(el).display !== 'none').length,
        comma: [...document.querySelectorAll('.header-track .page-nav-overflow-key')]
            .filter((el) => window.getComputedStyle(el).display !== 'none').length,
    }));
    expect(marks.arrows, 'the walk arrows are still drawn').toBe(0);
    expect(marks.comma, 'the `,` is still printed').toBe(0);

    // The keys behind the arrows still walk the pages.
    const before = await page.evaluate(() => String(window.dashboardInstance.currentPageId));
    await page.locator('body').click({ position: { x: 5, y: 600 } });
    await page.keyboard.press('Shift+ArrowRight');
    await expect.poll(() => page.evaluate(() => String(window.dashboardInstance.currentPageId))).not.toBe(before);
});

test('compact is one button, and it opens its own list', async ({ page }) => {
    await openWithPages(page);
    await chooseStyle(page, 'compact');
    const seen = await read(page);

    expect(seen.attribute).toBe('compact');
    expect(seen.visibleTabs, `${seen.visibleTabs} tabs in the compact switcher`).toBe(1);
    expect(seen.chipDrawn, 'the count is drawn beside the caret that says the same thing').toBe(false);
    expect(seen.active.height, `the button is ${seen.active.height}px tall`).toBe(28);

    /*
     * Pressing it opens the list rather than re-selecting the page it names --
     * a menu under the control now, where it used to be the full pages panel
     * over the page. The panel is still one row away, in the menu's foot.
     */
    await page.locator('#page-navigation .page-nav-btn.active').click();
    await expect(page.locator('.page-switcher-menu')).toBeVisible();
    await page.locator('.page-switcher-all').click();
    await expect(page.locator('#app-modal.show .page-overview-modal')).toBeVisible();
});

test('the choice survives a reload', async ({ page }) => {
    await openWithPages(page);
    await chooseStyle(page, 'text');

    await page.reload();
    await page.waitForSelector('.bookmark-link', { timeout: 20_000 });
    await dismissBlockingOverlays(page);

    await expect.poll(() => page.evaluate(
        () => document.body.getAttribute('data-page-switcher'),
    ), { timeout: 10_000 }).toBe('text');
});

test('the page you were last on stays marked in config, health and the inbox', async ({ page }) => {
    await openWithPages(page);
    await chooseStyle(page, 'classic');
    // Onto the second page, so the mark is not simply the first tab.
    await page.locator('#page-navigation .page-nav-btn:not(.active):not([hidden])').first().click();
    await page.waitForTimeout(400);
    const marked = () => page.evaluate(() => {
        const d = window.dashboardInstance;
        const tabs = [...document.querySelectorAll('#page-navigation .page-nav-btn')];
        const active = tabs.filter((t) => t.classList.contains('active'));
        const index = d.pages.findIndex((p) => String(p.id) === String(d.currentPageId));
        return { count: active.length, right: active[0] === tabs[index], view: d.activeView };
    });
    expect(await marked()).toEqual({ count: 1, right: true, view: 'bookmarks' });

    await page.keyboard.press('Shift+S');
    await expect.poll(async () => (await marked()).view).toBe('config');
    expect(await marked()).toEqual({ count: 1, right: true, view: 'config' });

    await page.evaluate(() => window.dashboardInstance.health?.openHealthView?.());
    await expect.poll(async () => (await marked()).view).toBe('health');
    expect(await marked()).toEqual({ count: 1, right: true, view: 'health' });

    await page.evaluate(() => window.dashboardInstance.inbox?.openInboxView?.());
    await expect.poll(async () => (await marked()).view).toBe('inbox');
    expect(await marked()).toEqual({ count: 1, right: true, view: 'inbox' });

    // And the marked tab still leads back to that page.
    const before = await page.evaluate(() => String(window.dashboardInstance.currentPageId));
    await page.locator('#page-navigation .page-nav-btn.active').click();
    await expect.poll(async () => (await marked()).view).toBe('bookmarks');
    expect(await page.evaluate(() => String(window.dashboardInstance.currentPageId))).toBe(before);
});
