// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * What Keep looks like when it happens.
 *
 * Keep took the row out of the queue and said nothing: the link simply
 * vanished, and where it went was a tab the reader had to know to look at.
 * Now the row flies to that tab, the count there steps up, and a toast says
 * where the link is -- with the way back on it.
 */

async function bootstrap(page) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });
    await page.evaluate(async () => {
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        const current = await (await fetch('/api/unsorted', { cache: 'no-store' })).json();
        for (const bookmark of current.bookmarks || []) {
            await api('/api/bookmarks', {
                method: 'DELETE', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ page: 999999, bookmark }),
            });
        }
        const patch = { inboxEnabled: true, unsortedEnabled: true, keepAutoFile: false };
        await api('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) });
        Object.assign(window.dashboardInstance.settings, patch);
        await window.dashboardInstance.loadAllBookmarks?.();
    });
}

async function queue(page, title) {
    const url = `https://feedback-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.example/x`;
    await page.evaluate(async ({ u, t }) => {
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        await api('/api/inbox', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: u, title: t }),
        });
    }, { u: url, t: title });
    await page.evaluate(() => window.dashboardInstance.inbox.openInboxView());
    await page.evaluate(() => window.dashboardInstance.inbox.loadAndRender({ refresh: true }));
    await expect(page.locator('.inbox-item', { hasText: title })).toBeVisible({ timeout: 10_000 });
    return url;
}

const keptHas = (page, url) => page.evaluate(async (u) => {
    const data = await (await fetch('/api/unsorted', { cache: 'no-store' })).json();
    return (data.bookmarks || []).some((b) => b.url === u);
}, url);

const inboxHas = (page, url) => page.evaluate(async (u) => {
    const body = await (await fetch('/api/inbox', { cache: 'no-store' })).json();
    const items = Array.isArray(body?.items) ? body.items : (Array.isArray(body) ? body : []);
    return items.some((item) => item.url === u);
}, url);

test('keeping from the row flies it to the Bookmarks icon and says so', async ({ page }) => {
    await bootstrap(page);
    const url = await queue(page, 'Fly me');

    const row = page.locator('.inbox-item', { hasText: 'Fly me' });
    await row.locator('.inbox-item-title').click();
    await page.locator('[data-lvs-drawer="inbox"] [data-slp-action="keep"]').click();

    // The flight: a copy of the row, on its way to Bookmarks, where Unsorted is.
    await expect(page.locator('.keep-flight')).toHaveCount(1, { timeout: 5_000 });
    // And in words, with the way back.
    const toast = page.locator('.app-notification', { hasText: 'Kept' });
    await expect(toast).toBeVisible({ timeout: 5_000 });
    await expect(toast).toContainText('Bookmarks → Unsorted');
    await expect(toast.locator('.app-notification-action')).toBeVisible();

    await expect.poll(() => keptHas(page, url), { timeout: 15_000 }).toBe(true);
    await expect(page.locator('.keep-flight')).toHaveCount(0, { timeout: 5_000 });
});

test('the toast undoes the keep', async ({ page }) => {
    await bootstrap(page);
    const url = await queue(page, 'Undo me');

    const row = page.locator('.inbox-item', { hasText: 'Undo me' });
    await row.locator('.inbox-item-title').click();
    await page.locator('[data-lvs-drawer="inbox"] [data-slp-action="keep"]').click();
    await expect.poll(() => keptHas(page, url), { timeout: 15_000 }).toBe(true);

    await page.locator('.app-notification', { hasText: 'Kept' }).locator('.app-notification-action').click();

    await expect.poll(() => keptHas(page, url), { timeout: 15_000 }).toBe(false);
    await expect.poll(() => inboxHas(page, url), { timeout: 15_000 }).toBe(true);
});

test('keeping from the triage card lands on the card own Kept counter', async ({ page }) => {
    await bootstrap(page);
    const url = await queue(page, 'Triage me');

    await page.keyboard.press('t');
    await expect.poll(() => page.evaluate(() =>
        !!window.dashboardInstance.inbox.triage?.isOpen?.()), { timeout: 10_000 }).toBe(true);
    await page.locator('[data-triage-pile="list"]').click();
    const counter = page.locator('.inbox-triage-kept-count');
    await expect(counter).toBeVisible();
    await expect(counter).toContainText('0');

    await page.keyboard.press('Shift+K');

    await expect(page.locator('.app-notification', { hasText: 'Kept' })).toBeVisible({ timeout: 5_000 });
    await expect.poll(() => keptHas(page, url), { timeout: 15_000 }).toBe(true);
});

/**
 * Keep had no key in the list: r marks read there and k moves up, so the
 * one exit with a tab of its own was reachable by mouse only. Shift+K, shown
 * on the side panel's button and in the legend under the list.
 */
test('Shift+K keeps the row under the cursor, and the list says so', async ({ page }) => {
    await bootstrap(page);
    const url = await queue(page, 'Key me');

    // The side panel's Keep names its key in its title, as Bookmarks' buttons do.
    await page.locator('.inbox-item', { hasText: 'Key me' }).locator('.inbox-item-title').click();
    await expect(page.locator('[data-lvs-drawer="inbox"] [data-slp-action="keep"]')).toHaveAttribute('title', /Shift\+K/);
    await page.keyboard.press('Escape');
    const legend = page.locator('.inbox-body-own .inbox-legend');
    await expect(legend.locator('span', { has: page.locator('kbd', { hasText: /^K$/ }) }))
        .toContainText('Unsorted');

    // The real entry point: j puts the cursor on the first row.
    await page.keyboard.press('j');
    await page.keyboard.press('Shift+K');

    await expect.poll(() => keptHas(page, url), { timeout: 15_000 }).toBe(true);
    await expect(page.locator('.app-notification', { hasText: 'Kept' })).toBeVisible({ timeout: 5_000 });
});

async function keepRow(page, title) {
    const row = page.locator('.inbox-item', { hasText: title });
    await row.locator('.inbox-item-title').click();
    await page.locator('[data-lvs-drawer="inbox"] [data-slp-action="keep"]').click();
}

async function addBookmark(page, pageId, bookmark) {
    await page.evaluate(async ({ p, b }) => {
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        await api('/api/bookmarks/add', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ page: p, bookmark: { category: '', ...b } }),
        });
    }, { p: pageId, b: bookmark });
}

/** A link filed on a page is not kept: the toast says where it already is. */
test('keeping a link already filed on a page says where it is, not Kept', async ({ page }) => {
    await bootstrap(page);
    const url = await queue(page, 'Filed already');
    await addBookmark(page, 1, { name: 'Filed copy', url });
    await page.evaluate(() => window.dashboardInstance.loadAllBookmarks());

    await keepRow(page, 'Filed already');
    await expect(page.locator('.app-notification', { hasText: 'Already filed' })).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('.app-notification', { hasText: 'on the Kept tab' })).toHaveCount(0);
    expect(await keptHas(page, url)).toBe(false);
    await expect.poll(() => inboxHas(page, url), { timeout: 10_000 }).toBe(false);
});

/** Undo after keeping a link Kept already had leaves that copy alone. */
test('undoing a keep of a link already in Kept keeps the older copy', async ({ page }) => {
    await bootstrap(page);
    const url = await queue(page, 'Kept twice');
    await addBookmark(page, 999999, { name: 'Older kept copy', url, note: 'my note' });

    await keepRow(page, 'Kept twice');
    await page.locator('.app-notification', { hasText: 'Kept' }).locator('.app-notification-action').click();

    await expect.poll(() => inboxHas(page, url), { timeout: 15_000 }).toBe(true);
    // The row is back on screen only once undo has run to its end.
    await expect(page.locator('.inbox-item', { hasText: 'Kept twice' })).toBeVisible({ timeout: 15_000 });
    expect(await keptHas(page, url)).toBe(true);
});

/** Undo into a full inbox leaves the kept copy where it is. */
test('undoing a keep into a full inbox keeps the link in Kept', async ({ page }) => {
    await bootstrap(page);
    const url = await queue(page, 'Full undo');
    await keepRow(page, 'Full undo');
    await expect.poll(() => keptHas(page, url), { timeout: 15_000 }).toBe(true);

    await page.route('**/api/inbox', async (route) => {
        if (route.request().method() !== 'POST') return route.continue();
        return route.fulfill({
            status: 409, contentType: 'application/json',
            body: JSON.stringify({ error: 'at_capacity', message: 'Inbox is full' }),
        });
    });
    await page.locator('.app-notification', { hasText: 'Kept' }).locator('.app-notification-action').click();
    await expect(page.locator('.app-notification', { hasText: 'Could not take the keep back' }))
        .toBeVisible({ timeout: 10_000 });
    expect(await keptHas(page, url)).toBe(true);
});
