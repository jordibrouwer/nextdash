// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissBlockingOverlays, dismissOnboardingIfPresent } = require('./e2e-helpers');

/**
 * What a capture sends to /api/inbox.
 *
 * addFromUrl posted only the url and the source, so a caller that knew the page
 * title or wanted the link tagged had no way to say so — the fields were simply
 * dropped on the way in, with no error to notice. The endpoint accepted them
 * all along.
 */

test.describe('inbox — capture carries what the caller knows', () => {
    test('addFromUrl sends the title and tags it was given', async ({ page }) => {
        await markWhatsNewSeen(page);
        await page.goto('/');
        await page.waitForSelector('#dashboard-layout', { timeout: 15_000 });
        await dismissOnboardingIfPresent(page);
        await dismissBlockingOverlays(page);
        await page.waitForFunction(() => window.dashboardInstance?.inbox != null, null, { timeout: 15_000 });
        await page.evaluate(() => {
            window.dashboardInstance.settings.inboxEnabled = true;
        });

        /** @type {any} */
        let sent = null;
        await page.route('**/api/inbox', async (route) => {
            if (route.request().method() === 'POST') {
                sent = JSON.parse(route.request().postData() || '{}');
            }
            await route.continue();
        });

        await page.evaluate(() => window.dashboardInstance.inbox.addFromUrl(
            `https://tagged-${Date.now()}.example.com`,
            { source: 'paste', title: 'A known title', tags: ['read-later'] },
        ));

        await expect.poll(() => sent).not.toBeNull();
        expect(sent.title).toBe('A known title');
        expect(sent.tags).toEqual(['read-later']);
        expect(sent.source).toBe('paste');
    });

    // Omitted rather than sent empty, so the server's own fallback (title from
    // the domain) still applies instead of storing a blank title.
    test('fields the caller did not supply are left out entirely', async ({ page }) => {
        await markWhatsNewSeen(page);
        await page.goto('/');
        await page.waitForSelector('#dashboard-layout', { timeout: 15_000 });
        await dismissOnboardingIfPresent(page);
        await dismissBlockingOverlays(page);
        await page.waitForFunction(() => window.dashboardInstance?.inbox != null, null, { timeout: 15_000 });
        await page.evaluate(() => {
            window.dashboardInstance.settings.inboxEnabled = true;
        });

        /** @type {any} */
        let sent = null;
        await page.route('**/api/inbox', async (route) => {
            if (route.request().method() === 'POST') {
                sent = JSON.parse(route.request().postData() || '{}');
            }
            await route.continue();
        });

        await page.evaluate(() => window.dashboardInstance.inbox.addFromUrl(
            `https://plain-${Date.now()}.example.com`, { source: 'paste' },
        ));

        await expect.poll(() => sent).not.toBeNull();
        expect('title' in sent).toBe(false);
        expect('tags' in sent).toBe(false);
        expect('note' in sent).toBe(false);
    });
});
