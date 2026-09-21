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
    return (body.items || body || []).some((item) => item.url === u);
}, url);

test('keeping from the row flies it to the Kept tab and says so', async ({ page }) => {
    await bootstrap(page);
    const url = await queue(page, 'Fly me');

    const row = page.locator('.inbox-item', { hasText: 'Fly me' });
    await row.hover();
    await row.locator('[data-inbox-action="keep"]').click();

    // The flight: a copy of the row, on its way to the tab.
    await expect(page.locator('.keep-flight')).toHaveCount(1, { timeout: 5_000 });
    // The tab it landed on says so.
    await expect(page.locator('[data-inbox-tab="kept"] .inbox-tab-count.is-bumped')).toHaveCount(1, { timeout: 5_000 });
    // And in words, with the way back.
    const toast = page.locator('.app-notification', { hasText: 'Kept' });
    await expect(toast).toBeVisible({ timeout: 5_000 });
    await expect(toast.locator('.app-notification-action')).toBeVisible();

    await expect.poll(() => keptHas(page, url), { timeout: 15_000 }).toBe(true);
    await expect(page.locator('.keep-flight')).toHaveCount(0, { timeout: 5_000 });
});

test('the toast undoes the keep', async ({ page }) => {
    await bootstrap(page);
    const url = await queue(page, 'Undo me');

    const row = page.locator('.inbox-item', { hasText: 'Undo me' });
    await row.hover();
    await row.locator('[data-inbox-action="keep"]').click();
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
    const counter = page.locator('.inbox-triage-kept-count');
    await expect(counter).toBeVisible();
    await expect(counter).toContainText('0');

    await page.keyboard.press('r');

    await expect(page.locator('.app-notification', { hasText: 'Kept' })).toBeVisible({ timeout: 5_000 });
    await expect.poll(() => keptHas(page, url), { timeout: 15_000 }).toBe(true);
});

/**
 * Keep had no key in the list: r marks read there and k moves up, so the
 * one exit with a tab of its own was reachable by mouse only. Shift+K, shown
 * on the row's button and in the legend under the list.
 */
test('Shift+K keeps the row under the cursor, and the list says so', async ({ page }) => {
    await bootstrap(page);
    const url = await queue(page, 'Key me');

    await expect(page.locator('.inbox-item', { hasText: 'Key me' })
        .locator('[data-inbox-action="keep"] kbd')).toHaveText('K');
    const legend = page.locator('.inbox-body-own .inbox-legend');
    await expect(legend.locator('span', { has: page.locator('kbd', { hasText: /^K$/ }) }))
        .toContainText('Kept');

    // The real entry point: j puts the cursor on the first row.
    await page.keyboard.press('j');
    await page.keyboard.press('Shift+K');

    await expect.poll(() => keptHas(page, url), { timeout: 15_000 }).toBe(true);
    await expect(page.locator('.app-notification', { hasText: 'Kept' })).toBeVisible({ timeout: 5_000 });
});

/**
 * The way back looks like the way in.
 *
 * Keep flies a row to the Kept tab; sending a kept link back to the queue
 * made it vanish, the same silence Keep used to have. It flies to the queue's
 * tab now, which steps up as it lands.
 */
test('sending a kept link back flies it to the queue tab', async ({ page }) => {
    await bootstrap(page);
    const url = `https://back-${Date.now()}.example/x`;
    await page.evaluate(async (u) => {
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        await api('/api/bookmarks/add', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ page: 999999, bookmark: { name: 'Fly back', url: u, category: '' } }),
        });
        await window.dashboardInstance.loadAllBookmarks?.();
        await window.dashboardInstance.inbox.openInboxView({ tab: 'kept' });
    }, url);
    const row = page.locator('.unsorted-view .bookmark-link', { hasText: 'Fly back' });
    await expect(row).toBeVisible({ timeout: 10_000 });
    await expect(row).toHaveAttribute('data-context-menu-bound', '1');
    await row.evaluate((node) => {
        const rect = node.getBoundingClientRect();
        node.dispatchEvent(new MouseEvent('contextmenu', {
            bubbles: true, cancelable: true,
            clientX: Math.round(rect.left + 20), clientY: Math.round(rect.top + 5),
        }));
    });
    await page.click('#bookmark-context-menu [data-action="unsorted-to-inbox"]');

    await expect(page.locator('.keep-flight')).toHaveCount(1, { timeout: 5_000 });
    await expect(page.locator('[data-inbox-tab="triage"] .is-bumped')).toHaveCount(1, { timeout: 5_000 });
    await expect.poll(() => inboxHas(page, url), { timeout: 15_000 }).toBe(true);
});
