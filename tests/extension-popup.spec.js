// @ts-check
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test, expect, chromium } = require('./fixtures');
const { WRITE_TOKEN } = require('./e2e-helpers');

const extensionPath = path.join(__dirname, '..', 'extension');

/**
 * Load the unpacked extension and point it at this worker's server, the way a
 * user does: the popup's settings tab, server URL and write token.
 */
async function launchConfigured(baseURL) {
    const launched = await launchExtension();
    const { page } = launched;
    await page.locator('.tab-button[data-tab="settings"]').click();
    await page.locator('#server-url').fill(baseURL);
    await page.locator('#write-token').fill(WRITE_TOKEN);
    await page.locator('#settings-form button[type="submit"]').click();
    await expect(page.locator('.message.success')).toBeVisible({ timeout: 15_000 });
    return launched;
}

/** The unpacked extension in a fresh profile, popup open, nothing set yet. */
async function launchExtension() {
    // A fresh profile per launch. The one kept in the repo held the service
    // worker of an earlier run, so the background script under test could be
    // an old copy of background.js.
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nextdash-extension-'));
    const context = await chromium.launchPersistentContext(userDataDir, {
        // Bundled Chromium (CI installs chromium only). Extensions need a headed
        // persistent context — CI runs the suite under xvfb-run.
        headless: false,
        args: [
            `--disable-extensions-except=${extensionPath}`,
            `--load-extension=${extensionPath}`,
        ],
    });
    let serviceWorker = context.serviceWorkers()[0];
    if (!serviceWorker) {
        serviceWorker = await context.waitForEvent('serviceworker', { timeout: 15_000 });
    }
    const extensionId = serviceWorker.url().split('/')[2];

    const page = await context.newPage();
    // The worker's own server, taken from the fixture. Guessing
    // localhost:18080 was right while the suite ran one server; with a
    // server per worker the OS hands out the port, so the popup was
    // being pointed at nothing and its page list stayed empty.
    await page.goto(`chrome-extension://${extensionId}/popup.html`);
    await expect(page.locator('#save-tab')).toBeVisible();
    const close = async () => {
        await context.close();
        fs.rmSync(userDataDir, { recursive: true, force: true });
    };
    return { context, serviceWorker, extensionId, page, close };
}

test.describe('extension popup', () => {
    test.setTimeout(60_000);

    test('loads popup, saves settings, and saves a bookmark', async ({ baseURL }) => {
        const { close, extensionId, page } = await launchConfigured(baseURL);
        try {
            expect(extensionId).toBeTruthy();
            // The shared preview and icon code sends the token through
            // nextDashWriteHeaders, which only the dashboard used to define:
            // every preview and icon upload from the extension got 401.
            await expect.poll(() => page.evaluate(() =>
                globalThis.nextDashWriteHeaders?.()['X-NextDash-Token'] || ''), { timeout: 5_000 }).toBe(WRITE_TOKEN);

            await page.locator('.tab-button[data-tab="save"]').click();
            await expect(page.locator('#page-select option')).not.toHaveCount(0, { timeout: 15_000 });

            const bookmarkUrl = `https://extension-smoke-${Date.now()}.example.com/`;
            await page.locator('#bookmark-url').fill(bookmarkUrl);
            await page.locator('#bookmark-name').fill('Extension smoke');
            await page.locator('#save-form button[type="submit"]').click();

            await expect(page.locator('#save-success-panel:not(.hidden)')).toBeVisible({ timeout: 15_000 });
            await expect(page.locator('#save-success-text')).toContainText(/saved/i);
        } finally {
            await close();
        }
    });

    /*
     * A first setup: type the address, reload the pages, pick a default page.
     * Its categories came from the stored address, and nothing is stored before
     * Save Settings, so the list stayed empty until the popup was reopened.
     */
    test('a first setup lists the default page categories before and after saving', async ({ baseURL }) => {
        const { close, page } = await launchExtension();
        try {
            await page.locator('.tab-button[data-tab="settings"]').click();
            await page.locator('#server-url').fill(baseURL);
            await page.locator('#write-token').fill(WRITE_TOKEN);
            await page.locator('#reload-pages-btn').click();
            await expect(page.locator('#default-page option')).not.toHaveCount(0, { timeout: 15_000 });

            const pageId = await page.locator('#default-page option').first().getAttribute('value');
            await page.locator('#default-page').selectOption(pageId);
            // "No Category" plus at least one real category.
            await expect.poll(() => page.locator('#default-category option').count(), { timeout: 10_000 }).toBeGreaterThan(1);

            await page.locator('#settings-form button[type="submit"]').click();
            await expect(page.locator('.message.success')).toBeVisible({ timeout: 15_000 });
            await expect.poll(() => page.locator('#default-category option').count(), { timeout: 10_000 }).toBeGreaterThan(1);
        } finally {
            await close();
        }
    });

    /*
     * An icon upload stores a file in data/icons that only a saved bookmark
     * refers to. The popup asked for one on every open and every edit of the
     * address, so each popup closed without saving left one behind.
     */
    test('the popup stores an icon only when it saves', async ({ baseURL }) => {
        const { context, close, extensionId } = await launchConfigured(baseURL);
        try {
            const popup = await context.newPage();
            const uploads = [];
            await popup.route('**/api/icon/from-url', (route) => {
                uploads.push(route.request().postData());
                return route.continue();
            });
            await popup.goto(`chrome-extension://${extensionId}/popup.html`);
            await expect(popup.locator('#page-select option')).not.toHaveCount(0, { timeout: 15_000 });
            await popup.locator('#bookmark-url').fill(`https://extension-icon-${Date.now()}.example.com/`);
            await popup.locator('#bookmark-name').fill('Icon on save');
            // Past the 450 ms debounce, and the preview fetch behind it.
            await popup.waitForTimeout(1500);
            expect(uploads).toEqual([]);

            await popup.locator('#save-form button[type="submit"]').click();
            await expect(popup.locator('#save-success-panel:not(.hidden)')).toBeVisible({ timeout: 15_000 });
            expect(uploads.length).toBe(1);
        } finally {
            await close();
        }
    });

    // Quick save (keyboard command, context menu) checks for a duplicate
    // before it fetches the icon: a duplicate is not saved, so its icon file
    // would refer to nothing.
    test('quick save of a duplicate stores no icon', async ({ baseURL }) => {
        const { close, serviceWorker } = await launchConfigured(baseURL);
        try {
            const url = `https://extension-quick-${Date.now()}.example.com/`;
            const first = await serviceWorker.evaluate((u) => quickSaveBookmark('Quick save', u), url);
            expect(first).toEqual({ ok: true });

            const second = await serviceWorker.evaluate(async (u) => {
                const asked = [];
                const realFetch = self.fetch;
                self.fetch = (input, init) => {
                    asked.push(String(input instanceof Request ? input.url : input));
                    return realFetch(input, init);
                };
                try {
                    const result = await quickSaveBookmark('Quick save', u);
                    return { result, asked };
                } finally {
                    self.fetch = realFetch;
                }
            }, url);
            expect(second.result).toEqual({ ok: false, reason: 'duplicate' });
            expect(second.asked.filter((a) => a.includes('/api/icon/from-url'))).toEqual([]);
        } finally {
            await close();
        }
    });
});
