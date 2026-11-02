// @ts-check
const { test, expect } = require('./fixtures');
const { answerNoCategory } = require('./e2e-helpers');
const { startStubSite, startFeedlessSite, installWithBookmark, installWithBookmarks, openDashboard, row, headers } = require('./helpers/feed-watch');

/**
 * The Watch feeds row of the add/edit form: shown when the page has a feed or
 * the bookmark is watched, collecting what to watch and writing it only on
 * Save. Tests go in by the form, then read what the server stored (polling is
 * global on the shared server, so no timing).
 */
test.describe.configure({ mode: 'serial' });

let site;
test.afterEach(async () => { await site?.close(); site = null; });

const modal = (page) => page.locator('#bookmark-form-modal');
const watchRow = (page) => modal(page).locator('[data-feed-watch-row]');
const summary = (page) => watchRow(page).locator('[data-feed-watch-summary]');
const toggle = (page) => watchRow(page).locator('[data-feed-watch-toggle]');
const onSwitch = (page) => watchRow(page).getByRole('switch', { name: 'Watch feeds' });
const feedBox = (page, url) => watchRow(page).locator(`[data-feed-watch-feed][value="${url}"]`);
const watches = async (request) => (await (await request.get('/api/feeds/watch')).json());
const save = (page) => modal(page).locator('.bookmark-inline-save').click();

async function openAdd(page) {
    await page.evaluate(async () => {
        const d = window.dashboardInstance;
        if (d.quickAddWidget?.open) { await d.quickAddWidget.open(); return; }
        await window.SearchLoader?.ensureReady?.();
        d.searchComponent?.commandsComponent?.newCommandHandler?.openModal();
    });
    await expect(modal(page)).toHaveClass(/show/);
}

/** Type the address and leave the field, which is when the page is read. */
async function typeUrl(page, url) {
    await modal(page).locator('[data-field="url"]').fill(url);
    await page.keyboard.press('Tab');
}

async function openEdit(page, name) {
    await row(page, name).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Edit' }).click();
    await expect(modal(page)).toHaveClass(/show/);
}

async function saveNew(page, name) {
    await modal(page).locator('[data-field="name"]').fill(name);
    await save(page);
    await answerNoCategory(page);
    await expect(modal(page)).not.toHaveClass(/show/);
}

async function watchStub(request, minutes = 60) {
    expect((await request.post('/api/feeds/watch', {
        data: { bookmarkUrl: site.url, feeds: [{ feedUrl: `${site.base}/feed/`, intervalMinutes: minutes }] }, headers,
    })).ok()).toBe(true);
}

test('the row appears for a page with feeds, and not for one without or a non-web address', async ({ page, request }) => {
    site = await startStubSite();
    const plain = await startFeedlessSite();
    try {
        await installWithBookmarks(request, []);
        await openDashboard(page);
        await openAdd(page);
        await typeUrl(page, site.url);
        await expect(watchRow(page)).toBeVisible();
        await expect(summary(page)).toHaveText('2 feeds found');
        await expect(onSwitch(page)).not.toBeChecked();
        await expect(toggle(page)).toHaveAttribute('aria-expanded', 'false');

        // A page with no feed: the row goes, the form is as short as before.
        await typeUrl(page, plain.url);
        // No feed on this page: the lookup runs, and the row must stay away. A fixed wait, because "hidden" is also true before the lookup answers.
        await page.waitForTimeout(1200);
        await expect(watchRow(page)).toBeHidden();

        // Not a web address: nothing is asked at all.
        let asked = 0;
        page.on('request', (req) => { if (req.url().includes('/api/feeds/watch/candidates')) asked += 1; });
        await typeUrl(page, 'ftp://127.0.0.1/files');
        // Nothing should be asked for a non-web address: a fixed wait, so a late request would still count in `asked`.
        await page.waitForTimeout(1200);
        await expect(watchRow(page)).toBeHidden();
        expect(asked).toBe(0);
    } finally {
        await plain.close();
    }
});

test('one advertised feed is named in the closed row', async ({ page, request }) => {
    site = await startStubSite();
    await installWithBookmarks(request, []);
    await page.route('**/api/feeds/watch/candidates**', (route) => route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ feeds: [{ url: `${site.base}/feed/`, title: 'Posts', watched: false }] }),
    }));
    await openDashboard(page);
    await openAdd(page);
    await typeUrl(page, site.url);
    await expect(summary(page)).toHaveText('1 feed found · Posts');
});

test('adding: the switch ticks the first feed, and Save watches it at the chosen interval', async ({ page, request }) => {
    site = await startStubSite();
    await installWithBookmarks(request, []);
    await openDashboard(page);
    await openAdd(page);
    await typeUrl(page, site.url);
    await onSwitch(page).check();
    await expect(toggle(page)).toHaveAttribute('aria-expanded', 'true');
    await expect(feedBox(page, `${site.base}/feed/`)).toBeChecked();
    await expect(feedBox(page, `${site.base}/comments/feed/`)).not.toBeChecked();
    await expect(summary(page)).toHaveText('Will watch after saving');
    await watchRow(page).locator('[data-feed-watch-interval]').selectOption('360');
    expect((await watches(request)).total).toBe(0);

    await saveNew(page, 'Offer Blog');
    await expect(page.locator('#app-notification')).toContainText('Watching Offer Blog · checked every 6 hours');
    const list = await watches(request);
    expect(list.total).toBe(1);
    expect(Object.values(list.watches)[0].feeds).toEqual([expect.objectContaining({ feedUrl: `${site.base}/feed/`, intervalMinutes: 360 })]);
});

test('adding then closing the form stores nothing', async ({ page, request }) => {
    site = await startStubSite();
    await installWithBookmarks(request, []);
    await openDashboard(page);
    await openAdd(page);
    await typeUrl(page, site.url);
    await onSwitch(page).check();
    await page.keyboard.press('Escape');
    // The address was typed, so the form asks before it throws that away.
    const discard = page.locator('#app-modal.show #modal-actions .modal-button.danger');
    await discard.waitFor({ state: 'visible', timeout: 3000 }).then(() => discard.click(), () => {});
    await expect(modal(page)).not.toHaveClass(/show/);
    // Nothing should be stored: a fixed wait, so a late watch request would show up before the count is read.
    await page.waitForTimeout(500);
    expect((await watches(request)).total).toBe(0);
});

test('two feeds and Mute: both are stored muted', async ({ page, request }) => {
    site = await startStubSite();
    await installWithBookmarks(request, []);
    await openDashboard(page);
    await openAdd(page);
    await typeUrl(page, site.url);
    await onSwitch(page).check();
    await feedBox(page, `${site.base}/comments/feed/`).check();
    await watchRow(page).getByRole('switch', { name: 'Mute' }).check();
    await saveNew(page, 'Muted Blog');
    await expect.poll(async () => (Object.values((await watches(request)).watches)[0]?.feeds || [])
        .map((f) => `${f.feedUrl}:${f.muted === true}`).sort())
        .toEqual([`${site.base}/comments/feed/:true`, `${site.base}/feed/:true`]);
});

test('a pasted address becomes a ticked feed and is stored', async ({ page, request }) => {
    site = await startStubSite();
    await installWithBookmarks(request, []);
    // Only Posts is advertised here, so the pasted Comments feed is new to the row.
    await page.route('**/api/feeds/watch/candidates**', (route) => route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ feeds: [{ url: `${site.base}/feed/`, title: 'Posts', watched: false }] }),
    }));
    await openDashboard(page);
    await openAdd(page);
    await typeUrl(page, site.url);
    await onSwitch(page).check();
    await feedBox(page, `${site.base}/feed/`).uncheck();
    const paste = watchRow(page).locator('[data-feed-watch-paste]');
    await paste.fill('not an address');
    await watchRow(page).locator('[data-feed-watch-add]').click();
    await expect(watchRow(page).locator('[data-feed-watch-paste-error]')).toBeVisible();
    await paste.fill(`${site.base}/comments/feed/`);
    await expect(feedBox(page, `${site.base}/comments/feed/`)).toHaveCount(0);
    await watchRow(page).locator('[data-feed-watch-add]').click();
    await expect(feedBox(page, `${site.base}/comments/feed/`)).toBeChecked();
    await expect(paste).toHaveValue('');
    await saveNew(page, 'Pasted Blog');
    await expect.poll(async () => (Object.values((await watches(request)).watches)[0]?.feeds || []).map((f) => f.feedUrl))
        .toEqual([`${site.base}/comments/feed/`]);
});

test('editing a watched bookmark: the row says so, and a new interval is stored on Save', async ({ page, request }) => {
    site = await startStubSite();
    await installWithBookmark(request, site);
    await watchStub(request);
    await openDashboard(page);
    await openEdit(page, 'Stub Blog');
    await expect(summary(page)).toContainText('Watching · every hour · checked');
    await expect(onSwitch(page)).toBeChecked();
    await toggle(page).click();
    await expect(feedBox(page, `${site.base}/feed/`)).toBeChecked();
    await expect(watchRow(page).locator('[data-feed-watch-interval]')).toHaveValue('60');
    await watchRow(page).locator('[data-feed-watch-interval]').selectOption('1440');
    await expect(summary(page)).toHaveText('Will update after saving');
    expect(Object.values((await watches(request)).watches)[0].feeds[0].intervalMinutes).toBe(60);
    await save(page);
    await expect(modal(page)).not.toHaveClass(/show/);
    await expect.poll(async () => Object.values((await watches(request)).watches)[0]?.feeds[0]?.intervalMinutes).toBe(1440);
});

test('editing: Stop watching takes effect on Save, Undo keeps the watch', async ({ page, request }) => {
    site = await startStubSite();
    await installWithBookmark(request, site);
    await watchStub(request);
    await openDashboard(page);

    await openEdit(page, 'Stub Blog');
    await toggle(page).click();
    await watchRow(page).locator('[data-feed-watch-stop]').click();
    await expect(summary(page)).toHaveText('Will stop watching after saving');
    await watchRow(page).locator('[data-feed-watch-undo]').click();
    await expect(summary(page)).toContainText('Watching · every hour');
    await save(page);
    await expect(modal(page)).not.toHaveClass(/show/);
    // Nothing should change on the server: a fixed wait, so a late write would show up before the count is read.
    await page.waitForTimeout(500);
    expect((await watches(request)).total).toBe(1);

    await openEdit(page, 'Stub Blog');
    await toggle(page).click();
    await watchRow(page).locator('[data-feed-watch-stop]').click();
    expect((await watches(request)).total).toBe(1);
    await save(page);
    await expect(modal(page)).not.toHaveClass(/show/);
    await expect(page.locator('#app-notification')).toContainText('Stopped watching Stub Blog');
    await expect.poll(async () => (await watches(request)).total).toBe(0);
});

test('editing with nothing changed in the row sends no watch request', async ({ page, request }) => {
    site = await startStubSite();
    await installWithBookmark(request, site);
    await watchStub(request);
    await openDashboard(page);
    await openEdit(page, 'Stub Blog');
    await expect(summary(page)).toContainText('Watching');
    await toggle(page).click();
    const writes = [];
    page.on('request', (req) => {
        if (req.method() === 'POST' && /\/api\/feeds\/(watch|unwatch)/.test(req.url())) writes.push(req.url());
    });
    await modal(page).locator('[data-field="name"]').fill('Stub Blog 2');
    await save(page);
    await expect(modal(page)).not.toHaveClass(/show/);
    // Nothing should be sent: a fixed wait, so a late watch request would land in `writes` before it is checked.
    await page.waitForTimeout(800);
    expect(writes).toEqual([]);
    expect((await watches(request)).total).toBe(1);
});

test('a paused feed says why, and Retry now brings it back without Save', async ({ page, request }) => {
    site = await startStubSite();
    await installWithBookmark(request, site);
    await watchStub(request, 30);
    site.breakFeed();
    for (let i = 0; i < 5; i += 1) await request.post('/api/feeds/watch/poll', { headers, data: {} });
    await openDashboard(page);
    await openEdit(page, 'Stub Blog');
    await expect(summary(page)).toHaveText('Paused · Not found (404)');
    await toggle(page).click();
    const status = watchRow(page).locator('[data-feed-watch-status]');
    await expect(status).toContainText('Paused after repeated failures · Not found (404)');
    site.breakFeed(false);
    await watchRow(page).locator('[data-feed-watch-retry]').click();
    await expect(status).not.toContainText('Paused');
    await expect(watchRow(page).locator('[data-feed-watch-retry]')).toHaveCount(0);
    const feed = Object.values((await watches(request)).watches)[0].feeds[0];
    expect(feed.retired || false).toBe(false);
    expect(feed.failures || 0).toBe(0);
});

test('an edited address: the old watch goes with it and leaves nothing behind', async ({ page, request }) => {
    site = await startStubSite();
    const { pid } = await installWithBookmark(request, site);
    await watchStub(request);
    await openDashboard(page);
    await openEdit(page, 'Stub Blog');
    await expect(summary(page)).toContainText('Watching');
    await typeUrl(page, `${site.base}/other`);
    await expect(summary(page)).toHaveText('2 feeds found');
    await expect(onSwitch(page)).not.toBeChecked();
    // The server does not move a watch with its bookmark: the old one is dropped.
    const dropped = page.waitForResponse((res) => res.url().includes('/api/feeds/unwatch') && res.ok());
    await save(page);
    await expect(modal(page)).not.toHaveClass(/show/);
    await dropped;
    expect((await watches(request)).total).toBe(0);

    // An orphan would come back the moment a bookmark has the old address again.
    const cats = await (await request.get(`/api/categories?page=${pid}`)).json();
    expect((await request.post(`/api/bookmarks?page=${pid}`, {
        data: [{ name: 'Again', url: site.url, category: cats[0]?.id || 'cat' }], headers,
    })).ok()).toBe(true);
    expect((await watches(request)).total).toBe(0);
});

test('phone: the open row fits 375 px and its controls are 44 px tall', async ({ page, request }) => {
    site = await startStubSite();
    await installWithBookmarks(request, []);
    await page.setViewportSize({ width: 375, height: 812 });
    await openDashboard(page);
    await openAdd(page);
    await typeUrl(page, site.url);
    await expect(watchRow(page)).toBeVisible();
    await onSwitch(page).check();
    await expect(feedBox(page, `${site.base}/feed/`)).toBeChecked();
    const sizes = await watchRow(page).evaluate((root) => {
        const h = (sel) => [...root.querySelectorAll(sel)].map((el) => Math.round(el.getBoundingClientRect().height));
        return {
            overflow: root.scrollWidth - root.clientWidth,
            right: Math.round(root.getBoundingClientRect().right),
            controls: [
                ...h('[data-feed-watch-toggle]'),
                ...h('.bookmark-form-watch-switch'),
                ...h('.bookmark-form-watch-feed'),
                ...h('[data-feed-watch-interval]'),
                ...h('[data-feed-watch-paste]'),
                ...h('[data-feed-watch-add]'),
            ],
        };
    });
    expect(sizes.overflow).toBeLessThanOrEqual(0);
    expect(sizes.right).toBeLessThanOrEqual(375);
    expect(sizes.controls.length).toBeGreaterThanOrEqual(7);
    for (const height of sizes.controls) expect(height).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
});

const checkMode = (page) => modal(page).locator('.bookmark-inline-checkmode-input:checked');

test('adding a watch switches the availability check on, and leaves one that is on alone', async ({ page, request }) => {
    site = await startStubSite();
    await installWithBookmarks(request, []);
    await openDashboard(page);
    await openAdd(page);
    await typeUrl(page, site.url);
    await expect(watchRow(page)).toBeVisible();

    // Off becomes Periodic, and goes back to Off when the watch is taken away again.
    await modal(page).locator('.bookmark-inline-checkmode-option', { hasText: 'Off' }).click();
    await expect(checkMode(page)).toHaveValue('off');
    await onSwitch(page).check();
    await expect(checkMode(page)).toHaveValue('periodic');
    await onSwitch(page).uncheck();
    await expect(checkMode(page)).toHaveValue('off');

    // A choice made by hand after the watch stays, whatever the switch does next.
    await onSwitch(page).check();
    await expect(checkMode(page)).toHaveValue('periodic');
    await modal(page).locator('.bookmark-inline-checkmode-option', { hasText: 'Monitor' }).click();
    await onSwitch(page).uncheck();
    await expect(checkMode(page)).toHaveValue('monitor');

    // Monitor (or Periodic) already on: nothing changes when a watch is added.
    await onSwitch(page).check();
    await expect(checkMode(page)).toHaveValue('monitor');
});

test('a new bookmark saved with a watch is checked periodically', async ({ page, request }) => {
    site = await startStubSite();
    await installWithBookmarks(request, []);
    await openDashboard(page);
    await openAdd(page);
    await typeUrl(page, site.url);
    await modal(page).locator('.bookmark-inline-checkmode-option', { hasText: 'Off' }).click();
    await onSwitch(page).check();
    await saveNew(page, 'Stub Blog');
    const pages = await (await request.get('/api/pages')).json();
    const list = await (await request.get(`/api/bookmarks?page=${pages[0].id}`)).json();
    const saved = list.find((b) => b.name === 'Stub Blog');
    expect(saved.checkStatus).toBe(true);
});

test('a bookmark that was watched already keeps its availability check when the watch is edited', async ({ page, request }) => {
    site = await startStubSite();
    await installWithBookmark(request, site);
    await watchStub(request);
    await openDashboard(page);
    await openEdit(page, 'Stub Blog');
    await modal(page).locator('.bookmark-inline-checkmode-option', { hasText: 'Off' }).click();
    await onSwitch(page).uncheck();
    await onSwitch(page).check();
    await expect(checkMode(page)).toHaveValue('off');
});
