// @ts-check
const path = require('path');
const { test, expect, chromium } = require('@playwright/test');
const { WRITE_TOKEN } = require('./e2e-helpers');

const extensionPath = path.join(__dirname, '..', 'extension');

/**
 * Minimal smoke coverage for the Chrome extension popup: load unpacked, open
 * popup.html, configure the server URL, and save a bookmark against the E2E server.
 */
test.describe('extension popup', () => {
    test.setTimeout(60_000);

    test('loads popup, saves settings, and saves a bookmark', async () => {
        const userDataDir = path.join(__dirname, '..', '.playwright-extension-profile');
        const context = await chromium.launchPersistentContext(userDataDir, {
            // Bundled Chromium (CI installs chromium only). Extensions need a headed
            // persistent context — CI runs the suite under xvfb-run.
            headless: false,
            args: [
                `--disable-extensions-except=${extensionPath}`,
                `--load-extension=${extensionPath}`,
            ],
        });

        try {
            let serviceWorker = context.serviceWorkers()[0];
            if (!serviceWorker) {
                serviceWorker = await context.waitForEvent('serviceworker', { timeout: 15_000 });
            }
            const extensionId = serviceWorker.url().split('/')[2];
            expect(extensionId).toBeTruthy();

            const page = await context.newPage();
            const e2ePort = process.env.PORT || '18080';
            const baseURL = process.env.PLAYWRIGHT_BASE_URL || `http://localhost:${e2ePort}`;
            await page.goto(`chrome-extension://${extensionId}/popup.html`);

            await expect(page.locator('#save-tab')).toBeVisible();
            await expect(page.locator('.tab-button[data-tab="settings"]')).toBeVisible();

            await page.locator('.tab-button[data-tab="settings"]').click();
            await page.locator('#server-url').fill(baseURL);
            await page.locator('#write-token').fill(WRITE_TOKEN);
            await page.locator('#settings-form button[type="submit"]').click();
            await expect(page.locator('.message.success')).toBeVisible({ timeout: 15_000 });

            await page.locator('.tab-button[data-tab="save"]').click();
            await expect(page.locator('#page-select option')).not.toHaveCount(0, { timeout: 15_000 });

            const bookmarkUrl = `https://extension-smoke-${Date.now()}.example.com/`;
            await page.locator('#bookmark-url').fill(bookmarkUrl);
            await page.locator('#bookmark-name').fill('Extension smoke');
            await page.locator('#save-form button[type="submit"]').click();

            await expect(page.locator('#save-success-panel:not(.hidden)')).toBeVisible({ timeout: 15_000 });
            await expect(page.locator('#save-success-text')).toContainText(/saved/i);
        } finally {
            await context.close();
        }
    });
});
