// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * What a kept row says about itself, and what happens when one is thrown away.
 *
 * A kept link is a decision postponed, so the two facts that decide it are how
 * long it has been waiting and whether the collection already holds it. Both
 * were invisible: the age only showed as a grouping, and a URL already filed
 * on a page read exactly like one nobody had seen before.
 */

const DAY = 86_400_000;

async function bootstrap(page, kept) {
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
        await api('/api/settings', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ inboxEnabled: true, unsortedEnabled: true, unsortedSort: 'added-desc', unsortedGroup: 'none' }),
        });
        Object.assign(window.dashboardInstance.settings, {
            inboxEnabled: true, unsortedEnabled: true, unsortedSort: 'added-desc', unsortedGroup: 'none',
        });
        await window.dashboardInstance.loadAllBookmarks?.();
    }, kept);
    await page.evaluate(() => window.dashboardInstance.inbox.openInboxView({ tab: 'kept' }));
    await expect(page.locator('.bookmark-link[data-unsorted-key]').first()).toBeVisible();
}

const hintsFor = (page, name) =>
    page.locator(`.unsorted-view .bookmark-link:has-text("${name}") + .unsorted-row-hints`);

test('a row says how long it has been waiting', async ({ page }) => {
    await bootstrap(page, [
        { name: 'Old One', url: 'https://age.example/old', createdAt: Date.now() - 40 * DAY },
        { name: 'New One', url: 'https://age.example/new', createdAt: Date.now() - 2000 },
    ]);

    await expect(hintsFor(page, 'Old One').locator('.unsorted-row-age')).toContainText('1mo');
    // Something kept a moment ago says nothing: the age is a nudge about a
    // decision left standing, not a timestamp on every row.
    await expect(hintsFor(page, 'New One').locator('.unsorted-row-age')).toHaveCount(0);
});

test('a row whose URL is already on a page says so', async ({ page }) => {
    await bootstrap(page, [{ name: 'Twice', url: 'https://twice.example/x', createdAt: Date.now() - 10 * DAY }]);
    await page.evaluate(async () => {
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        await api('/api/bookmarks/add', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                page: 1,
                bookmark: { name: 'Twice filed', url: 'https://twice.example/x', category: '' },
                // The address is already on the kept page, which is the point
                // of this test; without this the add is refused as a duplicate.
                allowDuplicate: true,
            }),
        });
        await window.dashboardInstance.unsorted.loadAndRender();
    });

    const badge = hintsFor(page, 'Twice').locator('.unsorted-row-filed');
    await expect(badge).toBeVisible({ timeout: 10_000 });
    await expect(badge).toContainText('main');
});

/**
 * The trash catches a deleted kept bookmark -- the bulk endpoint records it --
 * but the reader had no way of knowing that, and no way back that did not mean
 * opening Config → Data & backups → Trash. The toast is where the undo has to
 * be, the way the grid's own bulk delete offers it.
 */
test('deleting kept bookmarks can be undone from the toast', async ({ page }) => {
    const url = `https://trash.example/${Date.now()}`;
    await bootstrap(page, [{ name: 'Throw away', url, createdAt: Date.now() - 3 * DAY }]);

    await page.locator('.unsorted-row-check-input').first().check();
    await page.locator('.unsorted-select-toolbar .multi-select-btn', { hasText: 'Delete' }).click();
    await page.locator('#app-modal.show').getByRole('button', { name: 'Delete', exact: true }).click();

    await expect.poll(async () => page.evaluate(async (u) => {
        const data = await (await fetch('/api/unsorted', { cache: 'no-store' })).json();
        return (data.bookmarks || []).some((b) => b.url === u);
    }, url), { timeout: 20_000 }).toBe(false);

    await page.locator('.app-notification-action').click();

    await expect.poll(async () => page.evaluate(async (u) => {
        const data = await (await fetch('/api/unsorted', { cache: 'no-store' })).json();
        return (data.bookmarks || []).some((b) => b.url === u);
    }, url), { timeout: 20_000 }).toBe(true);
    // And the trash entry goes with the restore, so it cannot be put back a
    // second time later.
    await expect.poll(async () => page.evaluate(async (u) => {
        const body = await (await fetch('/api/trash', { cache: 'no-store' })).json();
        const rows = Array.isArray(body) ? body : (body.items || []);
        return rows.filter((entry) => String(entry?.bookmark?.url || '') === u).length;
    }, url), { timeout: 20_000 }).toBe(0);
});
