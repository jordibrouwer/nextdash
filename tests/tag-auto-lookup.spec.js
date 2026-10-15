// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * The quiet tag lookup for links that just arrived.
 *
 * A new inbox link or bookmark has its site looked up without a button and
 * without an overlay, and what comes back is offered as a chip. It never
 * writes a tag, only fills the catalogue the buttons' rounds fill.
 */

const HOST = 'quiet-lookup.example';

async function bootstrap(page, { lookupOnline = true } = {}) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });
    await page.evaluate((online) => {
        // A fresh browser profile: nothing tried yet, and the starting point
        // is this moment.
        localStorage.removeItem('nextdash.tagAuto.tried');
        localStorage.removeItem('nextdash.tagAuto.since');
        Object.assign(window.dashboardInstance.settings, {
            inboxEnabled: true, tagLookupOnline: online, tagRules: [], dismissedTagSuggestions: [],
        });
        window.TagSuggestLive.invalidate();
    }, lookupOnline);
    // The starting point is written the first time the collection is read.
    await page.evaluate(() => window.TagSuggestLive.autoSearch(window.dashboardInstance));
}

async function addInboxLink(page, url) {
    await page.evaluate(async (u) => {
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        await api('/api/inbox', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: u, title: 'Quiet lookup link' }),
        });
        await window.dashboardInstance.inbox.loadItems();
    }, url);
}

test('a new inbox link has its site looked up on its own and offered as a chip', async ({ page }) => {
    const asked = [];
    await page.route('**/api/tags/lookup', (route) => {
        const hosts = route.request().postDataJSON()?.hosts || [];
        asked.push(...hosts);
        route.fulfill({
            json: {
                enabled: true,
                results: Object.fromEntries(hosts.map((h) => [h, { tags: ['gardening'], about: 'a garden site' }])),
            },
        });
    });
    await bootstrap(page);
    const url = `https://${HOST}/post-${Date.now()}`;
    await addInboxLink(page, url);

    await expect.poll(() => asked.includes(HOST), { timeout: 20_000 }).toBe(true);
    await expect.poll(() => page.evaluate((u) => {
        const item = (window.dashboardInstance.inbox.items || []).find((i) => i.url === u);
        return window.TagSuggestLive.forInboxItem(window.dashboardInstance, item).map((o) => o.tag);
    }, url), { timeout: 10_000 }).toContain('gardening');

    // Offered, not written.
    const tags = await page.evaluate((u) => {
        const item = (window.dashboardInstance.inbox.items || []).find((i) => i.url === u);
        return item.tags || [];
    }, url);
    expect(tags).toEqual([]);
    await expect(page.locator('#progress-overlay, .progress-overlay')).toHaveCount(0);
});

test('with online lookup off nothing is sent', async ({ page }) => {
    let calls = 0;
    await page.route('**/api/tags/lookup', (route) => {
        calls += 1;
        route.fulfill({ json: { enabled: false } });
    });
    await bootstrap(page, { lookupOnline: false });
    await addInboxLink(page, `https://${HOST}/off-${Date.now()}`);
    // Proves a request does not happen: the lookup waits five seconds before
    // it would send, so the check has to outlast that.
    await page.waitForTimeout(7_000);
    expect(calls).toBe(0);
});

test('links that were already there when the browser first looked are left alone', async ({ page }) => {
    let calls = 0;
    await page.route('**/api/tags/lookup', (route) => {
        calls += 1;
        route.fulfill({ json: { enabled: true, results: {} } });
    });
    await bootstrap(page);
    await page.evaluate(() => {
        // An old link: dated before the starting point.
        window.dashboardInstance.allBookmarks.push({
            name: 'Old', url: 'https://old-link.example/a', createdAt: 1000,
        });
        window.TagSuggestLive.autoSearch(window.dashboardInstance);
    });
    // Proves a request does not happen, so it has to outlast the five-second
    // debounce before the lookup would send.
    await page.waitForTimeout(7_000);
    expect(calls).toBe(0);
});

test('a round started from a button puts each answer on its row as it arrives', async ({ page }) => {
    let release = () => {};
    const held = new Promise((resolve) => { release = resolve; });
    let calls = 0;
    await page.route('**/api/tags/catalogue', (route) => {
        if (route.request().method() !== 'POST') return route.continue();
        const hosts = route.request().postDataJSON()?.hosts || [];
        return route.fulfill({ json: { tags: [], unknown: hosts } });
    });
    await page.route('**/api/tags/lookup', async (route) => {
        const hosts = route.request().postDataJSON()?.hosts || [];
        calls += 1;
        // The second batch is held back: the first must already be on screen.
        if (calls === 2) await held;
        route.fulfill({
            json: {
                enabled: true,
                results: Object.fromEntries(hosts.map((h) => [h, { tags: ['gardening'], about: 'a garden site' }])),
            },
        });
    });
    await bootstrap(page);
    // 60 sites: the round asks 50 at a time, so there are two batches.
    const items = Array.from({ length: 60 }, (_, i) => ({
        id: `live-${i}`, url: `https://live-${i}.example/a`, title: `Live ${i}`, addedAt: Date.now() - i * 1000, tags: [],
    }));
    // The queue the server would send, so the view's own loads keep it.
    await page.route('**/api/inbox', (route) => (route.request().method() === 'GET'
        ? route.fulfill({ json: { items } })
        : route.continue()));
    await page.evaluate(async () => {
        const inbox = window.dashboardInstance.inbox;
        await inbox.openInboxView();
        await inbox.loadItems();
    });
    // The list shows fifty rows, newest first: Live 0 to Live 49.
    await expect(page.locator('.inbox-item')).toHaveCount(50, { timeout: 15_000 });
    await page.evaluate((rows) => {
        // Oldest first, so the first batch is Live 59 to Live 10: the rows on
        // screen from Live 10 on are answered first, Live 0 to Live 9 after.
        window.TagCatalogue.lookupRound(rows.map((r) => r.url).reverse(), { delay: 60_000 });
    }, items);

    const offerOn = (name) => page.locator('.inbox-item', { hasText: name }).locator('[data-inbox-offer="gardening"]');
    // The inbox redraws itself every few seconds anyway; the answer has to be
    // on the row sooner than that.
    await expect(offerOn('Live 49')).toHaveCount(1, { timeout: 3_000 });
    // The held batch has not answered, and its rows have no offer yet.
    await expect(offerOn('Live 0')).toHaveCount(0);
    release();
    await expect(offerOn('Live 0')).toHaveCount(1, { timeout: 15_000 });
});
