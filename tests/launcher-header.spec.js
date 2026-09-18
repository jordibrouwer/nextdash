// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * The launcher header: two verbs, and one panel behind them.
 *
 * Tags, recents and the cheat sheet were three buttons in the bar for three
 * things that are all "open a panel and read a list"; the pages button opened
 * the panel the page tabs already are. All four keep their key and their
 * toggle, and none of them ships in the bar: the panel names them along its
 * foot, where the modes have lived since search, commands and finders became
 * one surface.
 */
async function openDashboard(page) {
    await page.setViewportSize({ width: 1500, height: 900 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('.bookmark-link', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
}

const drawn = (page, selector) => page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return false;
    return window.getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().width > 0;
}, selector);

test('a fresh install carries every action button', async ({ page }) => {
    await openDashboard(page);

    for (const id of ['#quick-add-toolbar-btn', '#search-button', '#commands-button', '#finders-button',
        '#tag-cloud-toggle-btn', '#recent-bookmarks-button', '#page-overview-header-btn',
        '#collapse-all-button', '#help-button']) {
        expect(await drawn(page, id), `${id} is not in the bar`).toBe(true);
    }

    // The destinations are untouched: they are places, not panels.
    expect(await drawn(page, '.dashboard-link-anchor')).toBe(true);
    expect(await drawn(page, '.config-link-anchor')).toBe(true);
});

/** The two keys below reach the panel's modes while their buttons are off. */
async function buttonsOff(page) {
    await page.evaluate(async () => {
        const d = window.dashboardInstance;
        Object.assign(d.settings, { showRecentButton: false, showTagCloudButton: false });
        d.setupDOM?.();
        await d.saveSettings?.();
        window.DashboardTagCloud?.syncFromSettings?.();
    });
}

test('the panel names the modes that used to be buttons', async ({ page }) => {
    await openDashboard(page);
    await page.keyboard.press('>');
    await page.waitForSelector('#shortcut-search', { timeout: 10_000 });

    const pills = await page.evaluate(() => [...document.querySelectorAll('.search-mode-tab')]
        .map((el) => ({
            mode: el.dataset.mode,
            key: el.querySelector('.search-mode-tab-key')?.textContent?.trim(),
        })));

    expect(pills.map((p) => p.mode)).toEqual(['search', 'command', 'finder', 'tag', 'recent', 'keys']);
    expect(pills.map((p) => p.key)).toEqual(['>', ':', '?', '/', '*', '!']);
});

/*
 * These two used to assert the opposite: with the button off, the key opened
 * the search panel's mode instead of the surface it names. That made a keyboard
 * shortcut answer to a setting about whether a button is drawn, so `*` and `/`
 * each meant one of two things depending on chrome the reader may never have
 * touched. Both keys reach their own surface now, on or off.
 */
test('* opens recents whether or not its button is on screen', async ({ page }) => {
    await openDashboard(page);
    await buttonsOff(page);
    // Something to have opened: the recents list reads lastOpened off the store.
    await page.evaluate(async () => {
        const d = window.dashboardInstance;
        const bookmark = d.bookmarks?.[0] || d.allBookmarks?.[0];
        d.recordBookmarkOpened?.(bookmark, 0, 'test');
        await d.loadAllBookmarks?.();
    });

    await page.keyboard.press('*');

    await expect(page.locator('#app-modal.show .recent-bookmarks-modal')).toHaveCount(1);
    // And the panel is not what opened instead.
    expect(await page.evaluate(
        () => window.dashboardInstance.searchComponent?.isActive?.() === true)).toBe(false);
});

test('/ opens the tag cloud whether or not its button is on screen', async ({ page }) => {
    await openDashboard(page);
    await buttonsOff(page);

    await page.keyboard.press('/');

    // Asked of the cloud itself rather than of a rectangle: the container lives
    // in the page whether or not it is open, and it animates, so a height read
    // at the wrong moment answers for the transition rather than for the cloud.
    await expect.poll(() => page.evaluate(
        () => window.DashboardTagCloud?.modalOpen === true), { timeout: 10_000 }).toBe(true);
    // And the panel is not what opened instead.
    expect(await page.evaluate(
        () => window.dashboardInstance.searchComponent?.isActive?.() === true)).toBe(false);

    // And the button really is gone, which is all that setting now decides.
    expect(await page.evaluate(
        () => document.body.getAttribute('data-show-tag-cloud-button'))).toBe('false');
});

test('the keys pill opens the cheat sheet, and leaves the panel behind it', async ({ page }) => {
    await openDashboard(page);
    await page.keyboard.press('>');
    await page.waitForSelector('#shortcut-search', { timeout: 10_000 });

    await page.locator('.search-mode-tab[data-mode="keys"]').click();

    await expect(page.locator('#app-modal.show .keyboard-cheat-sheet')).toBeVisible();
    // It is a door, so it carries no pressed state.
    expect(await page.evaluate(
        () => document.querySelector('.search-mode-tab[data-mode="keys"]').hasAttribute('aria-pressed'),
    )).toBe(false);
});

test('a reader who wants the buttons back can have them', async ({ page }) => {
    await openDashboard(page);

    await page.evaluate(async () => {
        const d = window.dashboardInstance;
        Object.assign(d.settings, { showRecentButton: true, showCheatSheetButton: true });
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        await api('/api/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(d.settings),
        });
        d.setupDOM?.();
    });
    await page.waitForTimeout(300);

    expect(await drawn(page, '#recent-bookmarks-button')).toBe(true);
    expect(await drawn(page, '#help-button')).toBe(true);

    // And the reload does not take them away again: the pass runs once.
    await page.reload();
    await page.waitForSelector('.bookmark-link', { timeout: 20_000 });
    expect(await drawn(page, '#recent-bookmarks-button')).toBe(true);
});
