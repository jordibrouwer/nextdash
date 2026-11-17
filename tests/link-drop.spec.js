// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissBlockingOverlays, dismissOnboardingIfPresent } = require('./e2e-helpers');

/**
 * A link dragged in from another window and dropped on the dashboard
 * (dashboard-link-drop.js). Playwright cannot start a drag from outside the
 * page, so the events are built the way the browser builds them: a DataTransfer
 * with the formats a link carries, dispatched at the point under the pointer.
 */
test.use({ viewport: { width: 1500, height: 950 }, hasTouch: false, isMobile: false });

const CATEGORY = '#dashboard-layout .category[data-category-id]:not(.dashboard-widget):not([data-smart-collection="true"])';

async function load(page) {
    await markWhatsNewSeen(page);
    await page.route((url) => !['localhost', '127.0.0.1'].includes(url.hostname), (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<html></html>' }));
    await page.goto('/');
    await page.waitForSelector('.bookmark-link', { timeout: 20_000 });
    await page.waitForFunction(() => window.dashboardInstance?.linkDrop && window.LinkDropModel, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.evaluate(() => {
        window.dashboardInstance.settings.inboxEnabled = true;
        window.dashboardInstance.settings.pasteDestination = 'ask';
        localStorage.removeItem('nextdash:paste-destination-v1');
    });
}

/** Dispatch dragover then drop at a point, with the formats given. */
function dragTo(page, point, formats, { drop = true } = {}) {
    return page.evaluate(({ point, formats, drop }) => {
        const transfer = new DataTransfer();
        for (const [type, value] of Object.entries(formats)) transfer.setData(type, value);
        const at = (type) => {
            const target = document.elementFromPoint(point.x, point.y) || document.body;
            const event = new DragEvent(type, { bubbles: true, cancelable: true, clientX: point.x, clientY: point.y, dataTransfer: transfer });
            target.dispatchEvent(event);
            return event.defaultPrevented;
        };
        const over = at('dragover');
        const marked = document.querySelectorAll('.link-drop-target').length;
        const dropped = drop ? at('drop') : false;
        return { over, marked, dropped };
    }, { point, formats, drop });
}

async function categoryPoint(page) {
    const info = await page.evaluate((selector) => {
        const el = [...document.querySelectorAll(selector)].find((c) => c.getBoundingClientRect().height > 40);
        const rect = el.getBoundingClientRect();
        return { id: el.getAttribute('data-category-id'), x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + 12) };
    }, CATEGORY);
    return info;
}

test('a link dropped on a category opens the form with address, title and category', async ({ page }) => {
    await load(page);
    const { id, x, y } = await categoryPoint(page);
    const result = await dragTo(page, { x, y }, {
        'text/uri-list': 'https://link-drop.example/page',
        'text/html': '<a href="https://link-drop.example/page">The dropped page</a>',
    });
    expect(result.over).toBe(true);
    expect(result.marked).toBe(1);
    await expect(page.locator('#bookmark-form-modal')).toHaveClass(/show/);
    const form = page.locator('#bookmark-form-modal .bookmark-inline-form');
    await expect(form.locator('input[type="url"]')).toHaveValue('https://link-drop.example/page');
    await expect(form.locator('[data-field="name"]')).toHaveValue('The dropped page');
    // The category select among the form's selects (the page one holds a number).
    await expect.poll(() => form.locator('.bookmark-inline-select').evaluateAll((selects, want) => selects.some((s) => s.value === want), id)).toBe(true);
    await expect(page.locator('.link-drop-target')).toHaveCount(0);
});

test('a link dropped on a bookmark row of a category files it in that category', async ({ page }) => {
    await load(page);
    const { id, x, y } = await page.evaluate((selector) => {
        const row = [...document.querySelectorAll(`${selector} .bookmark-link`)].find((r) => r.getBoundingClientRect().height > 10);
        const rect = row.getBoundingClientRect();
        return { id: row.closest('.category').getAttribute('data-category-id'), x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
    }, CATEGORY);
    // The lists that reorder rows answer every drop with preventDefault.
    await dragTo(page, { x, y }, { 'text/uri-list': 'https://link-drop.example/row' });
    await expect(page.locator('#bookmark-form-modal')).toHaveClass(/show/);
    await expect(page.locator('#bookmark-form-modal .bookmark-inline-form input[type="url"]')).toHaveValue('https://link-drop.example/row');
    await expect.poll(() => page.locator('#bookmark-form-modal .bookmark-inline-select').evaluateAll((selects, want) => selects.some((s) => s.value === want), id)).toBe(true);
});

test('a drag that starts on the page itself is not a link coming in', async ({ page }) => {
    await load(page);
    const { x, y } = await categoryPoint(page);
    // What a Recent row or a widget image does: an anchor drag carries its address.
    await page.evaluate(() => document.body.dispatchEvent(new DragEvent('dragstart', { bubbles: true })));
    const own = await dragTo(page, { x, y }, { 'text/uri-list': 'https://link-drop.example/own-anchor' });
    expect(own.over).toBe(false);
    await expect(page.locator('#bookmark-form-modal.show')).toHaveCount(0);
    // The drop ended it: the next link from outside is taken again.
    await dragTo(page, { x, y }, { 'text/uri-list': 'https://link-drop.example/after' });
    await expect(page.locator('#bookmark-form-modal')).toHaveClass(/show/);
});

test('a link dropped elsewhere follows paste: the choice opens', async ({ page }) => {
    await load(page);
    await dragTo(page, { x: 2, y: 2 }, { 'text/uri-list': 'https://link-drop.example/elsewhere' });
    await expect(page.locator('#paste-choice-modal')).toHaveClass(/show/);
    await expect(page.locator('#bookmark-form-modal.show')).toHaveCount(0);
});

test('several links go to the Inbox without a form', async ({ page }) => {
    const posted = [];
    await page.route('**/api/inbox', async (route) => {
        if (route.request().method() === 'POST') {
            posted.push(JSON.parse(route.request().postData() || '{}').url);
            return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
        }
        return route.continue();
    });
    await load(page);
    const { x, y } = await categoryPoint(page);
    await dragTo(page, { x, y }, { 'text/uri-list': 'https://one.example/\nhttps://two.example/' });
    await expect.poll(() => posted).toEqual(['https://one.example/', 'https://two.example/']);
    await expect(page.locator('#bookmark-form-modal.show')).toHaveCount(0);
    await expect(page.locator('#paste-choice-modal.show')).toHaveCount(0);
});

test('the dashboard\'s own drags, files and plain text are left alone', async ({ page }) => {
    await load(page);
    const { x, y } = await categoryPoint(page);

    // An own drag in progress (a row or a block being reordered).
    await page.evaluate(() => { window.__dragReorderState = { selected: document.body }; });
    const own = await dragTo(page, { x, y }, { 'text/uri-list': 'https://link-drop.example/own' });
    await page.evaluate(() => { delete window.__dragReorderState; });
    expect(own.over).toBe(false);

    // Text that is not an address: no dialog, nothing marked.
    const text = await dragTo(page, { x, y }, { 'text/plain': 'just some words' });
    expect(text.marked).toBe(1);
    // Taken at dragover, so the drop is cancelled too: left to the browser,
    // Firefox loads the words in this tab and the dashboard is gone.
    expect(text.dropped).toBe(true);
    await expect(page.locator('#bookmark-form-modal.show')).toHaveCount(0);
    await expect(page.locator('#paste-choice-modal.show')).toHaveCount(0);
    await expect(page.locator('.link-drop-target')).toHaveCount(0);

    // The paste setting off turns the drop off with it.
    await page.evaluate(() => { window.dashboardInstance.settings.pasteUrlQuickAdd = false; });
    const off = await dragTo(page, { x, y }, { 'text/uri-list': 'https://link-drop.example/off' });
    expect(off.over).toBe(false);
    await expect(page.locator('#bookmark-form-modal.show')).toHaveCount(0);
});
