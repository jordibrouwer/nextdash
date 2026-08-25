// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/*
 * Local copies, on Config -> Data & backups -> Sources.
 *
 * The capture itself needs monolith on PATH, which a CI machine may not have --
 * so these tests assert what holds either way: the panel is there, it says which
 * of the two states it is in, and it says so in a way a reader can act on. The
 * capture path is covered in Go, against a real binary.
 */
test.describe('local copies', () => {
    test.beforeEach(async ({ page }) => {
        await markWhatsNewSeen(page);
        await page.goto('/');
        await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
        await dismissOnboardingIfPresent(page);
        await dismissBlockingOverlays(page);
        await page.evaluate(() => window.dashboardInstance.config.openConfigView('data-backups'));
        await page.click('[data-db-tab="sources"]');
        await expect(page.locator('[data-local-archive-panel]')).toBeVisible({ timeout: 15_000 });
    });

    test('it says whether monolith is there, and what to do if not', async ({ page }) => {
        const state = page.locator('#config-local-archive-state');
        await expect(state).not.toBeEmpty({ timeout: 15_000 });

        /*
         * Both branches, whichever the machine is in.
         *
         * A first version of this only checked the branch the test machine
         * happened to be in, so on a box with monolith installed the
         * missing-binary message could say anything at all and this still
         * passed. The answer is intercepted so each branch is really rendered.
         */
        await page.route('**/api/archives', (route) => route.fulfill({
            status: 200, contentType: 'application/json',
            body: JSON.stringify({ available: false, captures: [], totalBytes: 0 }),
        }));
        await page.evaluate(() => window.dashboardInstance.config.loadLocalArchives());
        // Names the program and says how to get it: "not available" would leave
        // a reader with a panel that does nothing and no idea why.
        await expect(state).toContainText(/monolith/, { timeout: 10_000 });
        await expect(state).toContainText(/install/i);

        await page.route('**/api/archives', (route) => route.fulfill({
            status: 200, contentType: 'application/json',
            body: JSON.stringify({ available: true, captures: [], totalBytes: 0 }),
        }));
        await page.evaluate(() => window.dashboardInstance.config.loadLocalArchives());
        await expect(state).toContainText(/No copies/i, { timeout: 10_000 });

        // And with copies: the count and what they cost, because these are whole
        // pages and a hundred of them is a gigabyte.
        await page.route('**/api/archives', (route) => route.fulfill({
            status: 200, contentType: 'application/json',
            body: JSON.stringify({
                available: true, totalBytes: 3_500_000,
                captures: [
                    { url: '/api/archives/https---example-com-20260301-120000.html', bytes: 2_000_000, at: Date.parse('2026-03-01T12:00:00Z') },
                    { url: '/api/archives/https---other-example-20260201-120000.html', bytes: 1_500_000, at: Date.parse('2026-02-01T12:00:00Z') },
                ],
            }),
        }));
        await page.evaluate(() => window.dashboardInstance.config.loadLocalArchives());
        await expect(state).toContainText('2', { timeout: 10_000 });
        await expect(state).toContainText(/MB/);

        const rows = page.locator('.config-local-archive-row');
        await expect(rows).toHaveCount(2);
        // Newest first, and each row says its own size -- in MiB, the way a
        // file manager reports it, so 2,000,000 bytes reads as 1.9 MB.
        await expect(rows.first()).toContainText(/1\.9 MB/);
        // The filename is an identifier; the host is the part worth reading.
        await expect(rows.first().locator('.config-local-archive-name')).toContainText('example com');
    });

    test('saving nothing asks for an address instead of failing', async ({ page }) => {
        await page.click('[data-local-archive-action="capture"]');
        // No request goes out for an empty field: the answer is a prompt, not
        // an error from the server about a URL nobody typed.
        await expect(page.locator('#app-notification.show')).toContainText(/address|Paste/i, { timeout: 10_000 });
    });

    test('its controls carry the styling of the panels beside it', async ({ page }) => {
        const styleOf = (selector) => page.evaluate((sel) => {
            const el = document.querySelector(sel);
            if (!el) return 'MISSING';
            const c = getComputedStyle(el);
            return [c.padding, c.borderWidth, c.borderRadius, c.fontSize].join('|');
        }, selector);

        // Against a control that was on this tab before this panel existed.
        const reference = await styleOf('[data-source-action="save"][data-source-id="github:stars"]');
        expect(reference).not.toBe('MISSING');
        expect(await styleOf('[data-local-archive-action="capture"]')).toBe(reference);

        const textReference = await styleOf('#config-stars-token');
        expect(await styleOf('#config-local-archive-url')).toBe(textReference);
    });

    /*
     * The row's link is styled, not left to the browser.
     *
     * It shipped as a bare <a> in a panel where nothing else is one, so it
     * rendered #0000EE with a full underline -- the one colour on the page that
     * belongs to no theme and looks broken in all of them.
     */
    test('a stored copy reads as a link in this app, not a default one', async ({ page }) => {
        await page.route('**/api/archives', (route) => route.fulfill({
            status: 200, contentType: 'application/json',
            body: JSON.stringify({
                available: true, totalBytes: 816,
                captures: [{ url: '/api/archives/https---example-com-20260301-120000.html', bytes: 816, at: Date.parse('2026-03-01T12:00:00Z') }],
            }),
        }));
        await page.evaluate(() => window.dashboardInstance.config.loadLocalArchives());
        const link = page.locator('.config-local-archive-name').first();
        await expect(link).toBeVisible({ timeout: 10_000 });

        const style = await link.evaluate((el) => {
            const c = getComputedStyle(el);
            return { color: c.color, decoration: c.textDecorationLine };
        });
        // The unstyled default, which is what the bug looked like.
        expect(style.color).not.toBe('rgb(0, 0, 238)');
        expect(style.decoration).not.toContain('underline');

        // And it takes its colour from the theme, like every other link here.
        const themed = await page.evaluate(() => getComputedStyle(document.body).getPropertyValue('--accent-color').trim());
        if (themed) {
            expect(style.color).not.toBe('rgb(0, 0, 0)');
        }
    });

    test('a copy can be taken out of nextDash', async ({ page }) => {
        await page.route('**/api/archives', (route) => route.fulfill({
            status: 200, contentType: 'application/json',
            body: JSON.stringify({
                available: true, totalBytes: 20,
                captures: [{ url: '/api/archives/https---example-com-20260301-120000.html', bytes: 20, at: Date.parse('2026-03-01T12:00:00Z') }],
            }),
        }));
        // The file itself, served the way the real route would.
        await page.route('**/api/archives/https---example-com-20260301-120000.html', (route) => route.fulfill({
            status: 200, contentType: 'text/html', body: '<html>a copy</html>',
        }));
        await page.evaluate(() => window.dashboardInstance.config.loadLocalArchives());

        const download = page.waitForEvent('download', { timeout: 15_000 });
        await page.locator('[data-local-archive-download]').first().click();
        const file = await download;
        // Saved under its own name: a stored page must not be trapped in
        // nextDash, and the file is self-contained by design.
        expect(file.suggestedFilename()).toBe('https---example-com-20260301-120000.html');
    });
});
