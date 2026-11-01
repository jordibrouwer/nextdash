// @ts-check
const { test, expect } = require('./fixtures');
const { answerNoCategory } = require('./e2e-helpers');
const { startStubSite, startFeedlessSite, installWithBookmark, installWithBookmarks, openDashboard, row, headers } = require('./helpers/feed-watch');

/**
 * A page that advertises a feed gets offered it while a bookmark is added or
 * edited: a chip under the address. Tests go in by the form, then read what the
 * server stored (polling is global on the shared server, so no timing).
 */
test.describe.configure({ mode: 'serial' });

let site;
test.afterEach(async () => { await site.close(); });

const chip = (page) => page.locator('#bookmark-form-modal [data-feed-offer="offer"], #bookmark-form-modal [data-feed-offer="pending"]');
const offerHost = (page) => page.locator('#bookmark-form-modal .bookmark-form-feed-offer');
const watches = async (request) => (await (await request.get('/api/feeds/watch')).json());

async function openAdd(page) {
    await page.evaluate(async () => {
        const d = window.dashboardInstance;
        if (d.quickAddWidget?.open) { await d.quickAddWidget.open(); return; }
        await window.SearchLoader?.ensureReady?.();
        d.searchComponent?.commandsComponent?.newCommandHandler?.openModal();
    });
    await expect(page.locator('#bookmark-form-modal')).toHaveClass(/show/);
}

async function openEdit(page, name) {
    await row(page, name).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Edit' }).click();
    await expect(page.locator('#bookmark-form-modal')).toHaveClass(/show/);
}

test('adding: the chip appears, accepting shows the pending state, and Save watches the site', async ({ page, request }) => {
    site = await startStubSite();
    await installWithBookmarks(request, []);
    await openDashboard(page);
    await openAdd(page);
    await page.locator('#bookmark-form-modal [data-field="url"]').fill(site.url);
    // The page is read when the address field is left.
    await page.keyboard.press('Tab');
    await expect(chip(page)).toContainText('Feed found: Posts');
    await expect(chip(page)).toContainText('Watch?');
    await chip(page).locator('button').click();
    await expect(chip(page)).toContainText('Will watch after saving');
    expect((await watches(request)).total).toBe(0);

    await page.locator('#bookmark-form-modal [data-field="name"]').fill('Offer Blog');
    await page.locator('#bookmark-form-modal .bookmark-inline-save').click();
    await answerNoCategory(page);
    await expect(page.locator('#bookmark-form-modal')).not.toHaveClass(/show/);
    await expect(page.locator('#app-notification')).toContainText('Watching Offer Blog · checked every hour');
    const list = await watches(request);
    expect(list.total).toBe(1);
    expect(Object.values(list.watches)[0].feeds).toEqual([expect.objectContaining({ feedUrl: `${site.base}/feed/`, intervalMinutes: 60 })]);
});

test('editing: accepting watches at once', async ({ page, request }) => {
    site = await startStubSite();
    await installWithBookmark(request, site);
    await openDashboard(page);
    await openEdit(page, 'Stub Blog');
    await expect(chip(page)).toContainText('Feed found: Posts');
    await chip(page).locator('button').click();
    await expect(page.locator('#app-notification')).toContainText('Watching Stub Blog · checked every hour');
    await expect(offerHost(page)).toBeHidden();
    const list = await watches(request);
    expect(list.total).toBe(1);
});

test('Not now is remembered: no chip when the editor opens again', async ({ page, request }) => {
    site = await startStubSite();
    await installWithBookmark(request, site);
    await openDashboard(page);
    await openEdit(page, 'Stub Blog');
    await expect(chip(page)).toBeVisible();
    await page.locator('#bookmark-form-modal [data-feed-offer="refuse"] button').click();
    await expect(offerHost(page)).toBeHidden();
    await page.keyboard.press('Escape');
    await expect(page.locator('#bookmark-form-modal')).not.toHaveClass(/show/);
    await openEdit(page, 'Stub Blog');
    await expect(page.locator('#bookmark-form-modal [data-field="url"]')).toBeVisible();
    await page.waitForTimeout(800);
    await expect(chip(page)).toHaveCount(0);
    expect((await watches(request)).total).toBe(0);
});

test('a page without a feed gets no chip', async ({ page, request }) => {
    site = await startFeedlessSite();
    await installWithBookmark(request, site, 'Plain');
    await openDashboard(page);
    await openEdit(page, 'Plain');
    await page.waitForTimeout(800);
    await expect(chip(page)).toHaveCount(0);
});

test('an already watched bookmark gets no chip', async ({ page, request }) => {
    site = await startStubSite();
    const { key } = await installWithBookmark(request, site);
    expect((await request.post('/api/feeds/watch', {
        data: { bookmarkUrl: site.url, feeds: [{ feedUrl: `${site.base}/feed/`, intervalMinutes: 60 }] }, headers,
    })).ok()).toBe(true);
    expect(key).toBeTruthy();
    await openDashboard(page);
    await openEdit(page, 'Stub Blog');
    await page.waitForTimeout(800);
    await expect(chip(page)).toHaveCount(0);
});
