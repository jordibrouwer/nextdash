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

/*
 * The saved-pages tab under Bookmarks.
 *
 * A list of copies belongs with the collection, not with the settings that
 * produce them -- which is why it is here and not only in Data & backups.
 */
test.describe('the local copies tab', () => {
    const CAPTURES = {
        available: true,
        totalBytes: 2_500_000,
        captures: [
            {
                url: '/api/archives/https---example-com-20260825-120000.html', bytes: 1_000_000,
                at: Date.now() - 3600_000, bookmarkName: 'Example site', bookmarkUrl: 'https://example.com/',
            },
            {
                url: '/api/archives/https---example-com-20260301-120000.html', bytes: 900_000,
                at: Date.parse('2026-03-01T12:00:00Z'), bookmarkName: 'Example site', bookmarkUrl: 'https://example.com/',
            },
            // A page nothing points at any more.
            { url: '/api/archives/https---gone-example-20260101-120000.html', bytes: 600_000, at: Date.parse('2026-01-01T12:00:00Z') },
        ],
    };

    test.beforeEach(async ({ page }) => {
        await markWhatsNewSeen(page);
        await page.goto('/');
        await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
        await dismissOnboardingIfPresent(page);
        await dismissBlockingOverlays(page);
        await page.route('**/api/archives', (route) => route.fulfill({
            status: 200, contentType: 'application/json', body: JSON.stringify(CAPTURES),
        }));
        await page.evaluate(() => window.dashboardInstance.config.openConfigView('bookmarks'));
        await page.click('[data-bm-tab="local-copies"]');
        await expect(page.locator('#config-copies-list')).toBeVisible({ timeout: 15_000 });
    });

    test('copies are grouped under the bookmark they belong to', async ({ page }) => {
        const groups = page.locator('.config-copies-group');
        await expect(groups).toHaveCount(2, { timeout: 10_000 });

        // Two captures of one page are one group, not two rows in a flat list --
        // the question is "what do I have of this page".
        const named = page.locator('.config-copies-group').filter({ hasText: 'Example site' });
        await expect(named.locator('.config-local-archive-row')).toHaveCount(2);
        await expect(named).toContainText('https://example.com/');

        /*
         * The orphan gets its own group and is marked as one. These are the
         * copies worth reviewing: no bookmark leads back to them, so without a
         * place to see them they sit on disk unnoticed for ever.
         */
        const orphan = page.locator('.config-copies-group--orphan');
        await expect(orphan).toHaveCount(1);
        await expect(orphan).toContainText(/No longer bookmarked/i);
    });

    test('the time a copy was saved reads as a time, not a timestamp', async ({ page }) => {
        const rows = page.locator('.config-copies-group').filter({ hasText: 'Example site' })
            .locator('.config-local-archive-name');
        // An hour ago is "today HH:MM"; months back is a date, because "180
        // days ago" is arithmetic homework.
        await expect(rows.first()).toContainText(/today/i);
        await expect(rows.nth(1)).not.toContainText(/today|yesterday/i);
        // The exact moment is never lost, only moved to the title.
        const title = await page.locator('.config-copies-group .config-local-archive-meta').first().getAttribute('title');
        expect(title).toMatch(/\d/);
    });

    test('search narrows to one page', async ({ page }) => {
        await page.fill('#config-copies-search', 'example.com');
        await expect(page.locator('.config-copies-group')).toHaveCount(1, { timeout: 10_000 });

        await page.fill('#config-copies-search', 'nothing matches this');
        await expect(page.locator('#config-copies-list')).toContainText(/No saved page matches/i);

        await page.fill('#config-copies-search', '');
        await expect(page.locator('.config-copies-group')).toHaveCount(2);
    });
});
