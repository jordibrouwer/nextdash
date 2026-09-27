// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * Where a kept link belongs, worked out from where its neighbours already are.
 *
 * Filing is the only action that empties this list, and it cost three steps --
 * Move to…, a page, a category -- for a link whose address the collection has
 * answered for a dozen times already. The suggestion is the same argument the
 * tag chips make, pointed at a destination instead of a word.
 */

async function seedFiled(page, { host, category, count }) {
    await page.evaluate(async ({ h, c, n }) => {
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        const existing = await (await fetch('/api/categories?page=1')).json();
        const list = Array.isArray(existing) ? existing : [];
        if (!list.some((entry) => entry.id === c)) {
            await api('/api/categories?page=1', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify([...list, { id: c, name: c }]),
            });
        }
        for (let i = 0; i < n; i += 1) {
            await api('/api/bookmarks/add', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    page: 1,
                    bookmark: { name: `${h} ${i}`, url: `https://${h}/filed-${i}`, category: c },
                    allowDuplicate: true,
                }),
            });
        }
        await window.dashboardInstance.loadAllBookmarks?.();
    }, { h: host, c: category, n: count });
}

async function bootstrap(page, { kept = [], settings = {} } = {}) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });
    await page.evaluate(async ({ rows, patch }) => {
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        const current = await (await fetch('/api/unsorted', { cache: 'no-store' })).json();
        for (const bookmark of current.bookmarks || []) {
            await api('/api/bookmarks', {
                method: 'DELETE', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ page: 999999, bookmark }),
            });
        }
        for (const bookmark of rows) {
            await api('/api/bookmarks/add', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ page: 999999, bookmark: { ...bookmark, category: '' }, allowDuplicate: true }),
            });
        }
        const base = {
            inboxEnabled: true, unsortedEnabled: true,
            unsortedSort: 'added-desc', unsortedGroup: 'none', keepAutoFile: false, ...patch,
        };
        await api('/api/settings', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(base),
        });
        Object.assign(window.dashboardInstance.settings, base);
        await window.dashboardInstance.loadAllBookmarks?.();
    }, { rows: kept, patch: settings });
}

test('with auto-file on, Keep puts a link straight where its neighbours are', async ({ page }) => {
    await bootstrap(page, { kept: [], settings: { keepAutoFile: true } });
    await seedFiled(page, { host: 'auto.example', category: 'reading', count: 3 });

    const url = `https://auto.example/queued-${Date.now()}`;
    await page.evaluate(async (u) => {
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        await api('/api/inbox', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: u, title: 'Auto filed' }),
        });
    }, url);
    await page.evaluate(() => window.dashboardInstance.inbox.openInboxView());
    await page.evaluate(() => window.dashboardInstance.inbox.loadAndRender({ refresh: true }));
    await expect.poll(() => page.evaluate(() =>
        (window.dashboardInstance.inbox.items || []).length), { timeout: 10_000 }).toBeGreaterThan(0);

    await page.keyboard.press('t');
    await expect.poll(() => page.evaluate(() =>
        !!window.dashboardInstance.inbox.triage?.isOpen?.()), { timeout: 10_000 }).toBe(true);
    // Shift+K, the Keep key here as in the list. `r` used to keep in triage
    // and mark read in the list — one letter with two meanings a tab apart —
    // and it marks read in both now.
    await page.keyboard.press('Shift+K');

    await expect.poll(async () => page.evaluate(async (u) => {
        const rows = await (await fetch('/api/bookmarks?page=1', { cache: 'no-store' })).json();
        return (Array.isArray(rows) ? rows : []).find((b) => b.url === u)?.category || '';
    }, url), { timeout: 20_000 }).toBe('reading');
    // Not on the kept page: auto-file is what keeping means with the setting on.
    await expect.poll(async () => page.evaluate(async (u) => {
        const data = await (await fetch('/api/unsorted', { cache: 'no-store' })).json();
        return (data.bookmarks || []).some((b) => b.url === u);
    }, url), { timeout: 20_000 }).toBe(false);
});

test('with auto-file on, a link nothing agrees about still lands in Kept', async ({ page }) => {
    await bootstrap(page, { kept: [], settings: { keepAutoFile: true } });
    const url = `https://nobody.example/queued-${Date.now()}`;
    await page.evaluate(async (u) => {
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        await api('/api/inbox', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: u, title: 'Nobody knows' }),
        });
    }, url);
    await page.evaluate(() => window.dashboardInstance.inbox.openInboxView());
    await page.evaluate(() => window.dashboardInstance.inbox.loadAndRender({ refresh: true }));
    await expect.poll(() => page.evaluate(() =>
        (window.dashboardInstance.inbox.items || []).length), { timeout: 10_000 }).toBeGreaterThan(0);

    await page.keyboard.press('t');
    await expect.poll(() => page.evaluate(() =>
        !!window.dashboardInstance.inbox.triage?.isOpen?.()), { timeout: 10_000 }).toBe(true);
    // Shift+K, the Keep key here as in the list. `r` used to keep in triage
    // and mark read in the list — one letter with two meanings a tab apart —
    // and it marks read in both now.
    await page.keyboard.press('Shift+K');

    await expect.poll(async () => page.evaluate(async (u) => {
        const data = await (await fetch('/api/unsorted', { cache: 'no-store' })).json();
        return (data.bookmarks || []).some((b) => b.url === u);
    }, url), { timeout: 20_000 }).toBe(true);
});
