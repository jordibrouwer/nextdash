// @ts-check
const { test, expect } = require('./fixtures');
const { openBookmarksWithHealth } = require('./helpers/bookmarks-health');

/**
 * Share, from the Bookmarks view's side panel (⋯ → Share link): Health's
 * shareIssue, which hands the dashboard's right-click menu the bookmark rather
 * than reimplementing the share sheet and its clipboard fallback. What these
 * cover is that the right bookmark gets there, and how the fallback speaks.
 */

const drawer = (page) => page.locator('.lvs-drawer-host[data-lvs-drawer="library"] .lvs-drawer');

/** The first bookmark's panel, and its Share in the ⋯ menu. */
async function share(page) {
    await page.locator('#config-bm-list .config-bm-row').first().click();
    await drawer(page).locator('[data-bm-more-toggle]').click();
    await drawer(page).locator('[data-bm-more-menu] [data-bm-health-action="share"]').click();
}

async function open(page) {
    const { bookmarks } = await openBookmarksWithHealth(page);
    const first = await page.evaluate(() => {
        const cfg = window.dashboardInstance.config.instance;
        const key = document.querySelector('#config-bm-list .config-bm-row')?.getAttribute('data-bm-key');
        const b = cfg.findBookmarkByKey(key);
        return { name: b.name, url: b.url };
    });
    return { bookmarks, first };
}

/** What Share hands over: the Bookmarks view, searched for this bookmark. */
async function expectedShareUrl(page, target) {
    return page.evaluate((url) => {
        const health = window.dashboardInstance.health;
        const issue = health.report.issues.find((row) => row.url === url);
        return health.buildIssueShareUrl(issue);
    }, target.url);
}

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

test.describe('Share from the side panel', () => {
    test('the link finds the bookmark again in the Bookmarks view', async ({ page }) => {
        const { first } = await open(page);
        const url = new URL(await expectedShareUrl(page, first));
        expect(url.hash.startsWith('#bookmarks?')).toBe(true);
        expect(new URLSearchParams(url.hash.slice('#bookmarks?'.length)).get('q')).toBe(first.url);
        // And followed, it lands on that bookmark.
        await page.goto(`${url.pathname}${url.search}${url.hash}`);
        await page.waitForSelector('#config-bm-list .config-bm-row', { timeout: 15_000 });
        await expect(page.locator('#config-bm-list .config-bm-title', { hasText: first.name }).first()).toBeVisible();
        expect(await page.locator('#config-bm-list .config-bm-row').count()).toBeLessThanOrEqual(3);
    });

    /*
     * Web Share needs a secure context. Opened over plain HTTP on a LAN address
     * the sheet is not offered at all; the copy toast says why.
     */
    test('the fallback toast explains an insecure origin', async ({ page }) => {
        await page.addInitScript(() => {
            // Playwright serves the suite from localhost, which is a secure
            // context, so the LAN case has to be simulated.
            Object.defineProperty(window, 'isSecureContext', { configurable: true, value: false });
        });
        await open(page);
        await stubClipboardOnly(page);
        await share(page);
        await expect(page.locator('.app-notification')).toContainText(/HTTPS|localhost/i, { timeout: 10_000 });
    });

    test('a plain fallback toast carries no origin hint', async ({ page }) => {
        // Secure context, but no Web Share — desktop Chrome and Firefox.
        await open(page);
        await stubClipboardOnly(page);
        await share(page);
        const copied = page.locator('.app-notification', { hasText: /copied|gekopieerd|kopiert|copié/i });
        await expect(copied).toBeVisible({ timeout: 10_000 });
        await expect(copied).not.toContainText(/HTTPS/i);
    });

    test('with no share sheet it copies the name and the link', async ({ page }) => {
        const { first } = await open(page);
        await stubClipboardOnly(page);
        await share(page);
        const url = await expectedShareUrl(page, first);
        await expect.poll(() => page.evaluate(() => window.__writes)).toEqual([`${first.name} — ${url}`]);
    });

    test('it works before the context menu module has loaded', async ({ page }) => {
        const { first } = await open(page);
        await stubClipboardOnly(page);
        await page.evaluate(() => {
            const loader = window.dashboardInstance.contextMenu;
            loader._module = null;
            loader._modulePromise = null;
            delete window.DashboardContextMenu;
        });
        await share(page);
        const url = await expectedShareUrl(page, first);
        await expect.poll(() => page.evaluate(() => window.__writes)).toEqual([`${first.name} — ${url}`]);
    });

    test('the sheet gets the bookmark\'s own title and the link', async ({ page }) => {
        const { first } = await open(page);
        await page.evaluate(() => {
            window.__shared = [];
            Object.defineProperty(navigator, 'share', {
                configurable: true,
                writable: true,
                value: (data) => { window.__shared.push(data); return Promise.resolve(); },
            });
        });
        await share(page);
        await expect.poll(() => page.evaluate(() => window.__shared)).toHaveLength(1);
        const call = await page.evaluate(() => window.__shared[0]);
        expect(call.url).toBe(await expectedShareUrl(page, first));
        expect(call.title).toBe(first.name);
    });

    test('a cancelled share sheet copies nothing', async ({ page }) => {
        await open(page);
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
        await share(page);
        // The sheet has to have been opened for the cancel to mean anything.
        await expect.poll(() => page.evaluate(() => window.__shared.length)).toBe(1);
        // Dismissing the sheet is a finished decision, not a failure to route around.
        expect(await page.evaluate(() => window.__writes)).toEqual([]);
    });
});
