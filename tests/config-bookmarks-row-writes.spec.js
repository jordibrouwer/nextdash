// @ts-check
const { test, expect } = require('./fixtures');
const { openBookmarks } = require('./config-bookmarks-helpers');

/**
 * Config → Bookmarks writes the rows it changes, not the pages it read.
 *
 * Every edit here used to take the page from memory and send the whole list
 * back: a link added elsewhere since was dropped, a move the target refused
 * left the rows on no page, and an undo put back a page that had moved on.
 */

const api = (page, method, url, body) => page.evaluate(async ({ method, url, body }) => {
    const f = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
    const res = await f(url, {
        method, headers: { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
    return res.json().catch(() => ({}));
}, { method, url, body });

const pageUrls = (page, pid) => page.evaluate(async (p) =>
    (await (await fetch(`/api/bookmarks?page=${p}`, { cache: 'no-store' })).json()).map((b) => b.url), pid);

async function seed(page, slug, rows) {
    const stamp = Date.now();
    const out = rows.map((r, i) => ({ ...r, url: `https://${slug}-${i}-${stamp}.example/` }));
    for (const b of out) {
        await api(page, 'POST', '/api/bookmarks/add', { page: b.pageId, bookmark: { category: '', ...b }, allowDuplicate: true });
    }
    await page.evaluate(() => window.dashboardInstance.config.refreshBookmarksAfterWrite({ silent: true }));
    return out;
}

const picked = (page, urls) => page.evaluate((list) => (window.dashboardInstance.allBookmarks || [])
    .filter((b) => list.includes(b.url)), urls);

test('a delete keeps a bookmark added elsewhere after the list was read', async ({ page }) => {
    await openBookmarks(page);
    const [a] = await seed(page, 'rw-del', [{ name: 'RW del A', pageId: 1 }]);
    // Added behind Config's back: not in the list it holds.
    const late = `https://rw-late-${Date.now()}.example/`;
    await api(page, 'POST', '/api/bookmarks/add', { page: 1, bookmark: { name: 'Late', url: late, category: '' } });

    await page.evaluate(async (url) => {
        const c = window.dashboardInstance.config;
        c.confirmAction = async () => true;
        const b = (window.dashboardInstance.allBookmarks || []).find((x) => x.url === url);
        await c.deleteBookmarkByKey(c.bookmarkKey(b));
    }, a.url);

    const urls = await pageUrls(page, 1);
    expect(urls).not.toContain(a.url);
    expect(urls).toContain(late);
});

test('a move the target cannot take leaves the row where it was', async ({ page }) => {
    await openBookmarks(page);
    await page.evaluate(() => window.dashboardInstance.config.addPage());
    await page.waitForFunction(() => window.dashboardInstance.pages.length > 1, null, { timeout: 15_000 });
    const pages = await page.evaluate(() => (window.dashboardInstance.pages || []).map((p) => p.id));
    const from = pages[0];
    const to = pages[pages.length - 1];
    const [a] = await seed(page, 'rw-move', [{ name: 'RW move A', pageId: from }]);
    // The same URL already on the target.
    await api(page, 'POST', '/api/bookmarks/add', { page: to, bookmark: { name: 'Same', url: a.url, category: '' }, allowDuplicate: true });
    await page.evaluate(() => window.dashboardInstance.config.refreshBookmarksAfterWrite({ silent: true }));

    const rows = (await picked(page, [a.url])).filter((b) => Number(b.pageId) === Number(from));
    await page.evaluate(async ({ rows, to }) => {
        await window.dashboardInstance.config.bulkMove(rows, { pageId: String(to) });
    }, { rows, to });

    expect(await pageUrls(page, from)).toContain(a.url);
    await expect(page.locator('.app-notification', { hasText: 'stayed where they were' })).toBeVisible();
    await api(page, 'DELETE', `/api/pages/${to}`);
});

test('undoing a bulk pin puts back the pins and nothing else', async ({ page }) => {
    await openBookmarks(page);
    const rows = await seed(page, 'rw-pin', [{ name: 'RW pin A', pageId: 1 }, { name: 'RW pin B', pageId: 1 }]);
    const urls = rows.map((r) => r.url);
    await page.evaluate(async (list) => {
        const c = window.dashboardInstance.config;
        const b = (window.dashboardInstance.allBookmarks || []).filter((x) => list.includes(x.url));
        await c.bulkPin(b, true);
    }, urls);
    // Renamed elsewhere while the undo toast is up.
    await api(page, 'PATCH', '/api/bookmarks', { page: 1, updates: [{ url: urls[0], fields: { name: 'Renamed meanwhile' } }] });

    await page.locator('.app-notification', { hasText: 'Pins updated' }).locator('.app-notification-action').click();
    await expect.poll(async () => page.evaluate(async (list) => {
        const all = await (await fetch('/api/bookmarks?page=1', { cache: 'no-store' })).json();
        return all.filter((b) => list.includes(b.url)).map((b) => `${b.name}|${!!b.pinned}`).sort();
    }, urls)).toEqual(['RW pin B|false', 'Renamed meanwhile|false'].sort());
});

test('undoing a delete takes the entry back out of the trash', async ({ page }) => {
    await openBookmarks(page);
    const [a] = await seed(page, 'rw-trash', [{ name: 'RW trash A', pageId: 1 }]);
    await page.evaluate(async (url) => {
        const c = window.dashboardInstance.config;
        c.confirmAction = async () => true;
        const b = (window.dashboardInstance.allBookmarks || []).find((x) => x.url === url);
        await c.deleteBookmarkByKey(c.bookmarkKey(b));
    }, a.url);
    await page.locator('.app-notification', { hasText: 'Bookmark deleted' }).locator('.app-notification-action').click();
    await expect.poll(async () => (await pageUrls(page, 1)).includes(a.url)).toBe(true);
    const inTrash = await page.evaluate(async (url) => {
        const data = await (await fetch('/api/trash', { cache: 'no-store' })).json();
        return (data.items || []).some((i) => i.bookmark?.url === url);
    }, a.url);
    expect(inTrash).toBe(false);
});

test('renaming a tag touches only rows with it, and the toast takes it back', async ({ page }) => {
    await openBookmarks(page);
    const tag = `rwtag${Date.now()}`;
    const [a, b] = await seed(page, 'rw-tag', [
        { name: 'RW tag A', pageId: 1, tags: [tag, 'keep'] },
        { name: 'RW tag B', pageId: 1 },
    ]);
    await page.evaluate(async ({ from }) => {
        await window.dashboardInstance.config.rewriteTag(from, `${from}new`);
    }, { from: tag });
    const tagsOf = (url) => page.evaluate(async (u) => {
        const all = await (await fetch('/api/bookmarks?page=1', { cache: 'no-store' })).json();
        return (all.find((x) => x.url === u) || {}).tags || [];
    }, url);
    expect((await tagsOf(a.url)).sort()).toEqual(['keep', `${tag}new`].sort());
    expect(await tagsOf(b.url)).toEqual([]);

    await page.locator('.app-notification', { hasText: 'Tag renamed' }).locator('.app-notification-action').click();
    await expect.poll(async () => (await tagsOf(a.url)).sort()).toEqual(['keep', tag].sort());
});

test('duplicating a page copies its bookmarks, shortcuts and all', async ({ page }) => {
    await openBookmarks(page);
    const pid = await page.evaluate(() => Number(window.dashboardInstance.pages[0].id));
    const key = String.fromCharCode(65 + Math.floor(Math.random() * 20));
    const shortcutOwner = await page.evaluate(async (k) => {
        const all = await (await fetch('/api/bookmarks?all=true', { cache: 'no-store' })).json();
        return all.some((b) => String(b.shortcut || '').toUpperCase() === k);
    }, key);
    const [a] = await seed(page, 'rw-dup', [{ name: 'RW dup A', pageId: pid, shortcut: shortcutOwner ? '' : key }]);
    const before = await page.evaluate(() => window.dashboardInstance.pages.map((p) => p.id));
    await page.evaluate(async (id) => {
        const c = window.dashboardInstance.config;
        c.confirmAction = async () => true;
        await c.duplicatePage(id);
    }, pid);
    const added = await page.evaluate((prev) => window.dashboardInstance.pages.map((p) => p.id)
        .filter((id) => !prev.includes(id)), before);
    expect(added.length).toBe(1);
    expect(await pageUrls(page, added[0])).toContain(a.url);
    await api(page, 'DELETE', `/api/pages/${added[0]}`);
});
