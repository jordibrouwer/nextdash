// @ts-check
const { test, expect } = require('./fixtures');
const { startStubSite, installWithBookmark, openDashboard, openPicker, row, headers } = require('./helpers/feed-watch');

/**
 * Watching a feed starts at the bookmark: right-click, tick the feeds, save.
 * The stub site advertises two feeds and the tests go in by the control a user
 * would use, then read the server's answer.
 */
let site;
test.beforeEach(async ({ request }) => {
    site = await startStubSite();
    await installWithBookmark(request, site);
});
test.afterEach(async () => { await site.close(); });

const picker = (page) => page.locator('[data-feed-watch-picker]');
const toast = (page) => page.locator('#app-notification');

test('right-click → Watch this feed lists both feeds and saves the ticked one', async ({ page, request }) => {
    await openDashboard(page);
    await openPicker(page, 'Stub Blog');

    await expect(picker(page).locator('[data-feed-watch-tick]')).toHaveCount(2);
    await expect(picker(page)).toContainText('Posts');
    await expect(picker(page)).toContainText('Comments');

    await picker(page).getByLabel(/Posts/).check();
    await picker(page).locator('[data-feed-watch-interval]').selectOption('360');
    await picker(page).locator('[data-feed-watch-save]').click();

    await expect(toast(page)).toContainText(/Watching Stub Blog · checked every 6 hours/);
    const list = await (await request.get('/api/feeds/watch')).json();
    const entries = Object.values(list.watches);
    expect(entries).toHaveLength(1);
    expect(entries[0].feeds).toEqual([expect.objectContaining({ feedUrl: `${site.base}/feed/`, intervalMinutes: 360 })]);
    expect(list.total).toBe(1);
});

test('a pasted address that is not a feed is refused and nothing is saved', async ({ page, request }) => {
    await openDashboard(page);
    await openPicker(page, 'Stub Blog');
    await picker(page).locator('[data-feed-watch-url]').fill(`${site.base}/not-a-feed`);
    await picker(page).locator('[data-feed-watch-save]').click();

    await expect(toast(page)).toContainText('That address is not a feed nextDash can read');
    await expect(picker(page)).toBeVisible();
    const list = await (await request.get('/api/feeds/watch')).json();
    expect(list.total).toBe(0);
});

test('the menu entry says Watching feed… once watched, and Stop watching removes it', async ({ page, request }) => {
    await openDashboard(page);
    await openPicker(page, 'Stub Blog');
    await picker(page).getByLabel(/Posts/).check();
    await picker(page).locator('[data-feed-watch-save]').click();
    await expect(picker(page)).toBeHidden();

    await row(page, 'Stub Blog').click({ button: 'right' });
    await expect(page.getByRole('menuitem', { name: 'Watching feed…' })).toBeVisible();
    await page.getByRole('menuitem', { name: 'Watching feed…' }).click();
    await picker(page).locator('[data-feed-watch-stop]').click();

    // The earlier toasts (watching, checking) are still queued ahead of it.
    await expect(toast(page)).toContainText('Stopped watching Stub Blog', { timeout: 20_000 });
    const list = await (await request.get('/api/feeds/watch')).json();
    expect(list.total).toBe(0);
    expect(headers).toBeTruthy();
});

test('the editor line opens the same picker, and shows the watch once saved', async ({ page, request }) => {
    await page.setViewportSize({ width: 1500, height: 950 });
    await openDashboard(page);
    await row(page, 'Stub Blog').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Edit' }).click();
    const open = page.locator('[data-feed-watch-open]');
    await expect(open).toBeVisible();
    await expect(open).toHaveText('Watch this feed…');
    await open.click();
    await picker(page).getByLabel(/Posts/).check();
    await picker(page).locator('[data-feed-watch-interval]').selectOption('1440');
    await picker(page).locator('[data-feed-watch-save]').click();
    await expect(picker(page)).toBeHidden();
    await expect(page.locator('[data-feed-watch-open]')).toHaveText('Watching · every day');
    const list = await (await request.get('/api/feeds/watch')).json();
    expect(list.total).toBe(1);
});

test('the picker offers seven intervals and 30 minutes saves', async ({ page, request }) => {
    await openDashboard(page);
    await openPicker(page, 'Stub Blog');
    const select = picker(page).locator('[data-feed-watch-interval]');
    await expect(select.locator('option')).toHaveText([
        'Every 30 minutes', 'Every hour', 'Every 2 hours', 'Every 4 hours', 'Every 6 hours', 'Every 12 hours', 'Every day',
    ]);
    await expect(select).toHaveValue('60');
    await picker(page).getByLabel(/Posts/).check();
    await select.selectOption('30');
    await picker(page).locator('[data-feed-watch-save]').click();
    await expect(toast(page)).toContainText('checked every 30 minutes');
    const list = await (await request.get('/api/feeds/watch')).json();
    expect(Object.values(list.watches)[0].feeds[0].intervalMinutes).toBe(30);
});

test('the picker can also switch availability checking on, and offers it only while it is off', async ({ page, request }) => {
    await openDashboard(page);
    await openPicker(page, 'Stub Blog');
    const box = picker(page).locator('[data-feed-watch-check]');
    await expect(box).toBeVisible();
    // Ticked from the start: the site is polled anyway.
    await expect(box).toBeChecked();
    await picker(page).getByLabel(/Posts/).check();
    await picker(page).locator('[data-feed-watch-save]').click();
    await expect(picker(page)).toBeHidden();

    await expect.poll(async () => {
        const pages = await (await request.get('/api/pages')).json();
        const list = await (await request.get(`/api/bookmarks?page=${pages[0].id}`)).json();
        return list.find((b) => b.name === 'Stub Blog')?.checkStatus;
    }).toBe(true);

    // Already checked: nothing left to offer.
    await openPicker(page, 'Stub Blog');
    await expect(picker(page).locator('[data-feed-watch-check]')).toHaveCount(0);
});

test('unticking the box leaves checking off', async ({ page, request }) => {
    await openDashboard(page);
    await openPicker(page, 'Stub Blog');
    await picker(page).getByLabel(/Posts/).check();
    await picker(page).locator('[data-feed-watch-check]').uncheck();
    await picker(page).locator('[data-feed-watch-save]').click();
    await expect(picker(page)).toBeHidden();
    const pages = await (await request.get('/api/pages')).json();
    const list = await (await request.get(`/api/bookmarks?page=${pages[0].id}`)).json();
    expect(list.find((b) => b.name === 'Stub Blog')?.checkStatus).toBeFalsy();
});
