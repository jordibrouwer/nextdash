// @ts-check
const { test, expect } = require('@playwright/test');
const { prepareDashboardInteraction } = require('./e2e-helpers');

/**
 * Copy URL and Share in the health view's per-row More menu.
 *
 * Both delegate to the dashboard's right-click menu rather than reimplementing
 * the share sheet and its clipboard fallback, so what these specs cover is that
 * the health rows reach that behaviour with the right bookmark — the name and
 * URL of the row whose menu was opened, not of some other row.
 *
 * The report is mocked so the row under test is a known name/URL pair rather
 * than whatever the seeded bookmarks happen to be.
 */

const TARGET = { name: 'Broken one', url: 'https://example.com/broken' };

function report() {
    return {
        generatedAt: Date.now(),
        summary: { totalBookmarks: 2, healthyCount: 1, brokenCount: 1, duplicateCount: 0, uncheckedCount: 0 },
        issues: [
            {
                pageId: 1, index: 0, pageName: 'dev', name: TARGET.name,
                url: TARGET.url, category: 'tools',
                status: 'broken', score: 25, duplicateCount: 0,
                lastChecked: 1752000000000,
                reasons: ['HTTP 500'],
                reasonDetails: [{ code: 'last_error', detail: 'HTTP 500', penalty: 60 }],
            },
            {
                pageId: 1, index: 1, pageName: 'dev', name: 'Healthy one',
                url: 'https://example.com/fine', category: 'tools',
                status: 'healthy', score: 100, duplicateCount: 0,
                lastChecked: 1752000000000,
                reasons: [], reasonDetails: [],
            },
        ],
        duplicateGroups: [],
    };
}

async function openHealthView(page) {
    await page.route('**/api/bookmark-health**', async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(report()),
        });
    });
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await prepareDashboardInteraction(page);
    await page.click('.health-link a.health-link-anchor');
    await page.waitForSelector('#dashboard-layout.health-layout .health-view-item', { timeout: 15_000 });
}

/** Record clipboard writes and remove Web Share, the no-share-sheet case. */
async function stubClipboardOnly(page) {
    await page.evaluate(() => {
        // @ts-ignore - removing an optional platform API on purpose
        delete navigator.share;
        window.__writes = [];
        Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: { writeText: (t) => { window.__writes.push(t); return Promise.resolve(); } },
        });
    });
}

/**
 * Open the first row's More menu. Clicked through the DOM because the row
 * actions only surface on hover, which a synthetic click cannot hold.
 */
async function openRowMenu(page) {
    await page.evaluate(() => document.querySelector('.health-view-more-btn').click());
    await page.waitForSelector('.health-view-menu:not([hidden])', { timeout: 10_000 });
}

async function runMenuAction(page, action) {
    await page.evaluate((a) => {
        document.querySelector(`.health-view-menu:not([hidden]) [data-menu-action="${a}"]`).click();
    }, action);
}

test.describe('health view row menu — copy and share', () => {
    test.describe.configure({ mode: 'serial' });

    test('the More menu offers Copy URL and Share', async ({ page }) => {
        await openHealthView(page);
        await openRowMenu(page);

        const actions = await page.evaluate(() => Array.from(
            document.querySelectorAll('.health-view-menu:not([hidden]) [data-menu-action]')
        ).map((el) => el.getAttribute('data-menu-action')));

        expect(actions).toContain('copy-url');
        expect(actions).toContain('share');
        // Placed with the other link actions rather than among the repair or
        // remove entries, so Delete stays last and alone under its own label.
        expect(actions.indexOf('copy-url')).toBeLessThan(actions.indexOf('delete'));
    });

    /**
     * The entry names what will actually happen. Promising a share sheet and
     * then copying instead is what made the feature read as broken: on desktop
     * Chrome and Firefox there is no navigator.share, so clicking "Share…" put
     * text on the clipboard and opened nothing.
     */
    test('the share entry is labelled Share when a share sheet exists', async ({ page }) => {
        // Installed before any script runs, since the row markup is built once.
        await page.addInitScript(() => {
            Object.defineProperty(navigator, 'share', {
                configurable: true, writable: true,
                value: () => Promise.resolve(),
            });
        });
        await openHealthView(page);
        await openRowMenu(page);

        const label = await page.evaluate(() => document
            .querySelector('.health-view-menu:not([hidden]) [data-menu-action="share"]')?.textContent.trim());
        expect(label).toBe('Share…');
    });

    test('the share entry names the copy when there is no share sheet', async ({ page }) => {
        // Headless Chromium has no navigator.share, so this is the default path.
        await openHealthView(page);
        await openRowMenu(page);

        const label = await page.evaluate(() => document
            .querySelector('.health-view-menu:not([hidden]) [data-menu-action="share"]')?.textContent.trim());
        expect(label).toBe('Copy name + URL');
    });

    /**
     * The toast names the reason when the origin is what withheld the share
     * sheet, because that one is the user's to fix: Safari and Chromium both
     * implement Web Share and both hide it outside a secure context, so a
     * dashboard on http://192.168.x.x has no sheet while the same instance over
     * HTTPS does. Without the hint the copy reads as the share having failed.
     */
    test('the fallback toast explains an insecure origin', async ({ page }) => {
        await page.addInitScript(() => {
            // Playwright serves the suite from localhost, which is a secure
            // context, so the LAN case has to be simulated.
            Object.defineProperty(window, 'isSecureContext', { configurable: true, value: false });
        });
        await openHealthView(page);
        await stubClipboardOnly(page);
        await openRowMenu(page);
        await runMenuAction(page, 'share');

        await expect(page.locator('.app-notification')).toContainText(/HTTPS|localhost/i, { timeout: 10_000 });
    });

    test('a plain fallback toast carries no origin hint', async ({ page }) => {
        // Secure context, but no Web Share — desktop Chrome and Firefox. Nothing
        // about the address is wrong here, so naming HTTPS would misdirect.
        await openHealthView(page);
        await stubClipboardOnly(page);
        await openRowMenu(page);
        await runMenuAction(page, 'share');

        await expect(page.locator('.app-notification')).toBeVisible({ timeout: 10_000 });
        await expect(page.locator('.app-notification')).not.toContainText(/HTTPS/i);
    });

    /**
     * navigator.share can exist and still refuse every call. Safari on macOS
     * exposes it over plain HTTP — localhost included, which it otherwise
     * reports as a secure context — and answers NotAllowedError each time.
     * Feature detection alone therefore promises a sheet the browser will not
     * open, which is how this reached a user as "share does nothing".
     */
    test('a refused share re-labels the entry and says why', async ({ page }) => {
        await page.addInitScript(() => {
            Object.defineProperty(navigator, 'share', {
                configurable: true, writable: true,
                value: () => {
                    const err = new Error('refused');
                    err.name = 'NotAllowedError';
                    return Promise.reject(err);
                },
            });
        });
        await openHealthView(page);
        await page.evaluate(() => {
            window.__writes = [];
            Object.defineProperty(navigator, 'clipboard', {
                configurable: true,
                value: { writeText: (t) => { window.__writes.push(t); return Promise.resolve(); } },
            });
        });

        // Advertised, because the browser claims the capability.
        await openRowMenu(page);
        expect(await page.evaluate(() => document
            .querySelector('.health-view-menu:not([hidden]) [data-menu-action="share"]')?.textContent.trim()))
            .toBe('Share…');

        await runMenuAction(page, 'share');

        // The link still reaches the clipboard, and the message names the real
        // reason rather than sending the user after HTTPS they already have.
        await expect.poll(() => page.evaluate(() => window.__writes.length)).toBe(1);
        await expect(page.locator('.app-notification')).toContainText(/will not open a share sheet/i);

        // And the entry stops promising a sheet it has already failed to open.
        await openRowMenu(page);
        await expect.poll(() => page.evaluate(() => document
            .querySelector('.health-view-menu:not([hidden]) [data-menu-action="share"]')?.textContent.trim()))
            .toBe('Copy name + URL');
    });

    test('Copy URL copies that row\'s address and closes the menu', async ({ page }) => {
        await openHealthView(page);
        await stubClipboardOnly(page);
        await openRowMenu(page);
        await runMenuAction(page, 'copy-url');

        await expect.poll(() => page.evaluate(() => window.__writes)).toEqual([TARGET.url]);
        await expect(page.locator('.health-view-menu:not([hidden])')).toHaveCount(0);
    });

    test('Share falls back to name and URL when there is no share sheet', async ({ page }) => {
        await openHealthView(page);
        await stubClipboardOnly(page);
        await openRowMenu(page);
        await runMenuAction(page, 'share');

        // The title travels with the link, exactly as on the dashboard — that is
        // what separates Share from Copy URL two rows above it.
        await expect.poll(() => page.evaluate(() => window.__writes))
            .toEqual([`${TARGET.name} — ${TARGET.url}`]);
    });

    test('Share hands the sheet the row\'s own title and URL', async ({ page }) => {
        await openHealthView(page);
        await page.evaluate(() => {
            window.__shared = [];
            Object.defineProperty(navigator, 'share', {
                configurable: true,
                writable: true,
                value: (data) => { window.__shared.push(data); return Promise.resolve(); },
            });
        });
        await openRowMenu(page);
        await runMenuAction(page, 'share');

        await expect.poll(() => page.evaluate(() => window.__shared)).toHaveLength(1);
        const call = await page.evaluate(() => window.__shared[0]);
        expect(call.url).toBe(TARGET.url);
        expect(call.title).toBe(TARGET.name);
    });

    /**
     * navigator.share() is gesture-gated: it only opens a sheet while the click
     * that triggered it is still the active user activation. closeAllMenus()
     * hides the menu holding the focused button, and hiding the focused element
     * ends that gesture in Safari — so closing before sharing meant the sheet
     * was refused and only the clipboard fallback ran, while the dashboard's
     * own menu worked. The call has to be reached with the menu still open.
     */
    test('the share sheet is reached before the menu closes', async ({ page }) => {
        await openHealthView(page);
        await page.evaluate(() => {
            window.__menuOpenAtShare = null;
            const d = window.dashboardInstance;
            const orig = d.contextMenu.shareBookmark.bind(d.contextMenu);
            d.contextMenu.shareBookmark = (bookmark, row) => {
                window.__menuOpenAtShare = Array.from(
                    document.querySelectorAll('.health-view-menu')
                ).some((m) => !m.hidden);
                return orig(bookmark, row);
            };
            Object.defineProperty(navigator, 'share', {
                configurable: true, writable: true, value: () => Promise.resolve(),
            });
        });

        await openRowMenu(page);
        await runMenuAction(page, 'share');

        await expect.poll(() => page.evaluate(() => window.__menuOpenAtShare)).toBe(true);
        // And it still closes once the sheet has been handed the bookmark.
        await expect(page.locator('.health-view-menu:not([hidden])')).toHaveCount(0);
    });

    test('a cancelled share sheet copies nothing', async ({ page }) => {
        await openHealthView(page);
        await page.evaluate(() => {
            window.__writes = [];
            window.__shared = [];
            Object.defineProperty(navigator, 'clipboard', {
                configurable: true,
                value: { writeText: (t) => { window.__writes.push(t); return Promise.resolve(); } },
            });
            Object.defineProperty(navigator, 'share', {
                configurable: true,
                writable: true,
                value: (data) => {
                    window.__shared.push(data);
                    const err = new Error('user aborted');
                    err.name = 'AbortError';
                    return Promise.reject(err);
                },
            });
        });
        await openRowMenu(page);
        await runMenuAction(page, 'share');

        // The sheet has to have been opened for the cancel to mean anything —
        // without this the assertion below passes just as well when the menu
        // entry does nothing at all.
        await expect.poll(() => page.evaluate(() => window.__shared.length)).toBe(1);

        // Dismissing the sheet is a finished decision, not a failure to route around.
        expect(await page.evaluate(() => window.__writes)).toEqual([]);
    });
});
