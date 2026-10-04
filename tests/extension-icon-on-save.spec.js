// @ts-check
const path = require('path');
const { test, expect } = require('./fixtures');

/**
 * The extension's popup asked the server to store a favicon on every open and
 * every edit of the address; only a saved bookmark refers to it, so each closed
 * popup left a file in data/icons. The popup now fetches without storing and
 * shows the favicon from where it is.
 *
 * Driven in a plain page: the extension's own spec needs Playwright's bundled
 * Chromium, and this is the shared save code it runs.
 */
const ext = (file) => path.join(__dirname, '..', 'extension', file);

test('fetching extras for the popup stores no icon', async ({ page, baseURL }) => {
    // A blank page: the dashboard's CSP would refuse the injected scripts,
    // and every request below is answered by a route anyway.
    await page.setContent('<!doctype html><title>probe</title>');
    for (const file of ['bookmark-form/bookmark-url-utils.js', 'bookmark-form/bookmark-preview-service.js', 'save-common.js']) {
        await page.addScriptTag({ path: ext(file) });
    }
    const uploads = [];
    await page.route('**/api/icon/from-url', (route) => {
        uploads.push(route.request().postData());
        return route.fulfill({ status: 200, contentType: 'application/json', body: '{"icon":"stored.png"}' });
    });
    await page.route('**/api/bookmark-preview**', (route) => route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ title: 'Probe', iconSource: 'https://probe.example.test/favicon.png' }),
    }));
    const forPopup = await page.evaluate((base) =>
        fetchBookmarkExtras(base, 'https://probe.example.test/page', { uploadIcon: false }), baseURL);
    expect(uploads).toEqual([]);
    expect(forPopup.iconSource).toBe('https://probe.example.test/favicon.png');
    expect(forPopup.icon).toBeUndefined();

    // The default, which quick save uses after its duplicate check, still stores it.
    const forSave = await page.evaluate((base) => fetchBookmarkExtras(base, 'https://probe.example.test/page'), baseURL);
    expect(forSave.icon).toBe('stored.png');
    expect(uploads.length).toBe(1);
});
