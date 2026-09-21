// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * A group of kept links, handled as one.
 *
 * Grouping by site, age, tag or suggested tag is how a pile is read; acting on
 * a group meant ticking its rows one by one. The group heading now ticks the
 * whole group, carries a menu of its own for what the selection bar does, and
 * Shift+X on any row takes its group -- the same key the dashboard uses for a
 * category.
 */

const KEPT = [
    { name: 'Alpha One', url: 'https://alpha-group.example/one', createdAt: 5000 },
    { name: 'Alpha Two', url: 'https://alpha-group.example/two', createdAt: 4000 },
    { name: 'Alpha Three', url: 'https://alpha-group.example/three', createdAt: 3000 },
    { name: 'Zeta One', url: 'https://zeta-group.example/one', createdAt: 2000 },
];

async function openGrouped(page) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });
    await page.evaluate(async (rows) => {
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
                body: JSON.stringify({ page: 999999, bookmark: { ...bookmark, category: '' } }),
            });
        }
        const patch = { inboxEnabled: true, unsortedEnabled: true, unsortedSort: 'added-desc', unsortedGroup: 'site' };
        await api('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) });
        Object.assign(window.dashboardInstance.settings, patch);
        const u = window.dashboardInstance.unsorted;
        if (u) { u.sort = 'added-desc'; u.groupBy = 'site'; u.searchQuery = ''; u.brokenOnly = false; }
        await window.dashboardInstance.loadAllBookmarks?.();
        await window.dashboardInstance.inbox.openInboxView({ tab: 'kept' });
    }, KEPT);
    await expect(page.locator('.unsorted-group')).toHaveCount(2, { timeout: 10_000 });
}

/*
 * Grouping is a server setting, and the server is shared by every test this
 * worker runs after this file: left on "site", the next spec's list comes out
 * grouped where it expects one chronological run.
 */
test.afterEach(async ({ page }) => {
    // And the rows it made: the specs after it count and order the kept list,
    // and four extra links -- or the ones sent back to the queue -- are four
    // rows they never asked for.
    await page.evaluate(async () => {
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        await api('/api/settings', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ unsortedGroup: 'none' }),
        });
        const ours = (url) => String(url || '').includes('-group.example');
        const kept = await (await fetch('/api/unsorted', { cache: 'no-store' })).json();
        for (const bookmark of (kept.bookmarks || []).filter((b) => ours(b.url))) {
            await api('/api/bookmarks', {
                method: 'DELETE', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ page: 999999, bookmark }),
            });
        }
        const body = await (await fetch('/api/inbox', { cache: 'no-store' })).json();
        const items = Array.isArray(body) ? body : (Array.isArray(body?.items) ? body.items : []);
        for (const item of items.filter((i) => ours(i.url))) {
            await api(`/api/inbox?id=${encodeURIComponent(item.id)}`, { method: 'DELETE' });
        }
    }).catch(() => {});
});

const group = (page, host) => page.locator(`.unsorted-group[data-unsorted-group="${host}"]`);

test('the group heading ticks and unticks its whole group', async ({ page }) => {
    await openGrouped(page);

    const box = group(page, 'alpha-group.example').locator('.unsorted-group-check-input');
    await box.check();
    await expect(page.locator('.unsorted-select-toolbar .multi-select-count')).toHaveText('3 selected');
    await expect(group(page, 'alpha-group.example').locator('.bookmark-link.is-multi-selected')).toHaveCount(3);
    await expect(group(page, 'zeta-group.example').locator('.bookmark-link.is-multi-selected')).toHaveCount(0);

    await box.uncheck();
    await expect(page.locator('.bookmark-link.is-multi-selected')).toHaveCount(0);
});

test('clicking the group name does the same, and a partial group reads as mixed', async ({ page }) => {
    await openGrouped(page);

    await group(page, 'alpha-group.example').locator('.unsorted-row-check-input').first().check();
    const box = group(page, 'alpha-group.example').locator('.unsorted-group-check-input');
    await expect.poll(() => box.evaluate((el) => el.indeterminate)).toBe(true);

    await group(page, 'alpha-group.example').locator('.category-title-name').click();
    await expect(group(page, 'alpha-group.example').locator('.bookmark-link.is-multi-selected')).toHaveCount(3);
    await expect.poll(() => box.evaluate((el) => el.checked && !el.indeterminate)).toBe(true);
});

test('the group menu sends the whole group back to the inbox', async ({ page }) => {
    await openGrouped(page);

    await group(page, 'alpha-group.example').locator('.unsorted-group-title').click({ button: 'right' });
    const menu = page.locator('#unsorted-group-menu');
    await expect(menu).toBeVisible();
    await menu.locator('[data-group-action="inbox"]').click();

    await expect.poll(async () => page.evaluate(async () => {
        const data = await (await fetch('/api/unsorted', { cache: 'no-store' })).json();
        return (data.bookmarks || []).map((b) => b.name).sort();
    }), { timeout: 20_000 }).toEqual(['Zeta One']);
});

test('Shift+X on a row takes its whole group', async ({ page }) => {
    await openGrouped(page);

    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Shift+X');

    await expect(page.locator('.unsorted-select-toolbar .multi-select-count')).toHaveText('3 selected');
});
