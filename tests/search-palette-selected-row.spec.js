// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * ':' on a selected row hands that row to the palette. The search reset its
 * command state on every keystroke -- the ':' itself included -- so :pin,
 * :tag, :move and the rest always answered "No bookmark selected".
 */

test(':pin pins the row that was selected when : was pressed', async ({ page }) => {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });

    await page.evaluate(() => document.activeElement?.blur());
    await page.keyboard.press('ArrowDown');
    const selected = await page.evaluate(() => {
        const bm = window.dashboardInstance.keyboardNavigation.getSelectedBookmark();
        return bm ? { url: bm.url, pinned: Boolean(bm.pinned) } : null;
    });
    expect(selected, 'no row selected').toBeTruthy();

    await page.keyboard.press(':');
    await page.keyboard.type('pin', { delay: 40 });
    await page.waitForTimeout(150);
    await page.keyboard.press('Enter');

    await expect.poll(() => page.evaluate(async (url) => {
        const d = window.dashboardInstance;
        const body = await (await fetch(`/api/bookmarks?page=${d.currentPageId}`)).json();
        return Boolean((Array.isArray(body) ? body : body.bookmarks || []).find((b) => b.url === url)?.pinned);
    }, selected.url), { timeout: 10_000 }).toBe(!selected.pinned);
});

// A dialog opened over the palette owns its keys: Escape closes the dialog and
// leaves the palette where it was, and the arrows stay out of the list behind.
test('Escape in a dialog over the palette closes the dialog only', async ({ page }) => {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });

    await page.evaluate(() => document.activeElement?.blur());
    await page.keyboard.press(':');
    await expect.poll(() => page.evaluate(() => window.dashboardInstance.searchComponent.searchActive)).toBe(true);
    const before = await page.evaluate(() => window.dashboardInstance.searchComponent.selectedMatchIndex);

    await page.evaluate(() => { void window.AppModal.alert({ title: 'Over the palette', message: 'Press Escape' }); });
    await expect(page.locator('#app-modal')).toHaveClass(/show/);
    await page.keyboard.press('ArrowDown');
    expect(await page.evaluate(() => window.dashboardInstance.searchComponent.selectedMatchIndex)).toBe(before);
    await page.keyboard.press('Escape');

    await expect(page.locator('#app-modal')).not.toHaveClass(/show/);
    expect(await page.evaluate(() => window.dashboardInstance.searchComponent.searchActive)).toBe(true);
});

// :remove lists every page's bookmarks but deleted on the page showing: a 404,
// or the copy of the same address that happened to be here.
test(':remove deletes the bookmark on its own page', async ({ page }) => {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });

    const url = `https://palette-remove-${Date.now()}.example/`;
    const result = await page.evaluate(async (url) => {
        const d = window.dashboardInstance;
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        const json = { 'Content-Type': 'application/json' };
        const list = await (await api('/api/pages')).json();
        const other = Math.max(...list.filter((p) => p.id < 999999).map((p) => p.id)) + 1;
        await api('/api/pages', { method: 'POST', headers: json, body: JSON.stringify([...list, { id: other, name: 'Remove target' }]) });
        await api('/api/bookmarks/add', { method: 'POST', headers: json, body: JSON.stringify({ page: d.currentPageId, bookmark: { name: 'Here', url } }) });
        await api('/api/bookmarks/add', { method: 'POST', headers: json, body: JSON.stringify({ page: other, bookmark: { name: 'There', url }, allowDuplicate: true }) });
        await d.loadAllBookmarks();
        const target = d.allBookmarks.find((b) => b.url === url && Number(b.pageId) === other);
        await d.searchComponent.commandsComponent.removeCommandHandler.removeBookmark(target);
        const read = async (id) => ((await (await fetch(`/api/bookmarks?page=${id}`)).json()) || []).filter((b) => b.url === url).length;
        return { here: await read(d.currentPageId), there: await read(other) };
    }, url);
    expect(result).toEqual({ here: 1, there: 0 });
});

// The :save row saved while the list was drawn, on every keystroke. Typing
// stores nothing; Enter on the row saves the search once.
test(':save saves on Enter, not while typing', async ({ page }) => {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });
    await page.evaluate(() => {
        window.dashboardInstance.searchComponent.savedSearches = [];
        document.activeElement?.blur();
    });
    const names = () => page.evaluate(() => window.dashboardInstance.searchComponent.savedSearches.map((e) => e.name));
    // A search, cleared, then the command: what a reader does.
    await page.keyboard.type('github', { delay: 40 });
    await page.waitForTimeout(150);
    for (let i = 0; i < 6; i += 1) await page.keyboard.press('Backspace');
    await page.waitForTimeout(150);
    await page.keyboard.type(':save my', { delay: 60 });
    await page.waitForTimeout(300);
    expect(await names()).toEqual([]);
    await page.keyboard.press('Enter');
    await expect.poll(names).toEqual(['my']);
});

// :remove skipped the trash, so the bookmark was gone once the toast closed,
// and its undo posted the page as it was before: a bookmark added in the
// meantime vanished.
test(':remove goes through the trash, and its undo keeps later changes', async ({ page }) => {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });

    const stamp = Date.now();
    const result = await page.evaluate(async ({ url, later }) => {
        const d = window.dashboardInstance;
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        const json = { 'Content-Type': 'application/json' };
        const pageId = d.currentPageId;
        await api('/api/bookmarks/add', { method: 'POST', headers: json, body: JSON.stringify({ page: pageId, bookmark: { name: 'Gone', url } }) });
        await d.loadAllBookmarks();
        const target = d.allBookmarks.find((b) => b.url === url);
        let undo = null;
        const show = d.showNotification.bind(d);
        d.showNotification = (msg, type, opts) => { if (opts?.undoCallback) undo = opts.undoCallback; return show(msg, type, opts); };
        await d.searchComponent.commandsComponent.removeCommandHandler.removeBookmark(target);
        d.showNotification = show;
        const trash = await (await api('/api/trash')).json();
        const inTrash = (trash.items || []).some((i) => i.bookmark?.url === url);
        await api('/api/bookmarks/add', { method: 'POST', headers: json, body: JSON.stringify({ page: pageId, bookmark: { name: 'Later', url: later } }) });
        await undo?.();
        const rows = (await (await fetch(`/api/bookmarks?page=${pageId}`)).json()) || [];
        return { inTrash, back: rows.some((b) => b.url === url), later: rows.some((b) => b.url === later) };
    }, { url: `https://palette-trash-${stamp}.example/`, later: `https://palette-later-${stamp}.example/` });
    expect(result).toEqual({ inTrash: true, back: true, later: true });
});

// :note said "Note saved." when nothing was written: a bookmark renamed
// elsewhere was not found, the page went back unchanged, and the toast came
// from another save.
test(':note reports a note it could not write', async ({ page }) => {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });
    const saved = await page.evaluate(async () => {
        const d = window.dashboardInstance;
        const handler = d.searchComponent.commandsComponent.noteCommandHandler;
        return handler._persistBookmark({ name: 'Not here', url: `https://not-here-${Date.now()}.example/`, pageId: d.currentPageId, note: 'x' });
    });
    expect(saved).toBe(false);
});
