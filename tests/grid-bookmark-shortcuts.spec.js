// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * A bookmark's own key, pressed on the grid.
 *
 * Shortcuts were search's alone: open the panel, type `y`, youtube opens. On
 * the grid the same letter opened the panel with `y` typed into it — one extra
 * key and a panel in the way for a bookmark the reader had already named.
 *
 * With the cursor on a row the letter opens the bookmark. With no cursor —
 * which is what Escape leaves you with — it still starts a search, because
 * that is the only thing a letter can mean when nothing is selected.
 */
async function openDashboard(page) {
    await page.setViewportSize({ width: 1500, height: 900 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('.bookmark-link', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
}

/** Give the first bookmark on the page a one-letter shortcut. */
async function seedShortcut(page, letter) {
    return page.evaluate(async (key) => {
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        const dash = window.dashboardInstance;
        const pageId = dash.currentPageId;
        const bookmarks = await (await api(`/api/bookmarks?page=${pageId}`)).json();
        if (!bookmarks.length) throw new Error('no bookmarks on this page');
        bookmarks.forEach((b) => { if (b.shortcut === key) b.shortcut = ''; });
        bookmarks[0].shortcut = key;
        const saved = await api(`/api/bookmarks?page=${pageId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(bookmarks),
        });
        if (!saved.ok) throw new Error(`seeding the shortcut failed: ${saved.status}`);
        await dash.loadData();
        dash.searchComponent?.buildShortcutsMap?.();
        return bookmarks[0].url;
    }, letter);
}

/** Catch the open without leaving the page: the row opens through an <a>. */
async function watchOpens(page) {
    await page.evaluate(() => {
        window.__opened = [];
        const click = HTMLAnchorElement.prototype.click;
        HTMLAnchorElement.prototype.click = function patched() {
            if (this.href && !this.isConnected === false) window.__opened.push(this.href);
            if (this.target === '_blank' || this.href) return;
            return click.apply(this, arguments);
        };
    });
}

const opened = (page) => page.evaluate(() => window.__opened || []);
const searchOpen = (page) => page.evaluate(
    () => window.dashboardInstance.searchComponent?.isActive?.() === true,
);

test('with the cursor on a row, the letter opens the bookmark', async ({ page }) => {
    await openDashboard(page);
    const url = await seedShortcut(page, 'q');
    await watchOpens(page);

    // The cursor arrives the way a reader puts it there.
    await page.keyboard.press('ArrowDown');
    await expect(page.locator('.bookmark-link.keyboard-selected')).toHaveCount(1);

    await page.keyboard.press('q');

    await expect.poll(() => opened(page), { timeout: 10_000 })
        .toContain(url);
    expect(await searchOpen(page), 'the panel opened as well').toBe(false);
});

test('with nothing selected, the same letter starts a search', async ({ page }) => {
    await openDashboard(page);
    await seedShortcut(page, 'q');
    await watchOpens(page);

    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Escape');
    await expect(page.locator('.bookmark-link.keyboard-selected')).toHaveCount(0);

    await page.keyboard.press('q');

    await expect.poll(() => searchOpen(page), { timeout: 10_000 }).toBe(true);
});

test('the letters the grid uses stay the grid’s', async ({ page }) => {
    await openDashboard(page);
    // j walks the cursor down; a bookmark called "jellyfin" must not take it.
    await seedShortcut(page, 'j');
    await watchOpens(page);

    await page.keyboard.press('ArrowDown');
    const first = await page.evaluate(
        () => window.dashboardInstance.keyboardNavigation.currentIndex,
    );

    await page.keyboard.press('j');

    await expect.poll(() => page.evaluate(
        () => window.dashboardInstance.keyboardNavigation.currentIndex,
    ), { timeout: 5_000 }).toBe(first + 1);
    expect(await opened(page), 'j opened a bookmark instead of moving the cursor').toEqual([]);
});
