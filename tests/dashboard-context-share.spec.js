// @ts-check
const { test, expect } = require('@playwright/test');
const { prepareDashboardInteraction } = require('./e2e-helpers');

/**
 * Sharing a bookmark from the dashboard right-click menu.
 *
 * navigator.share cannot be driven for real in a headless browser — there is no
 * system share sheet — so it is replaced with a stub that records its argument.
 * What is actually under test is the branching around it: that the title travels
 * with the URL, that a cancelled sheet stays silent, and that a browser without
 * Web Share still gets something on the clipboard.
 */

async function firstRow(page) {
    await page.waitForSelector('.bookmark-link', { timeout: 15_000 });
    return page.locator('.bookmark-link').first();
}

async function openContextMenu(page, row) {
    await row.click({ button: 'right' });
    await page.waitForSelector('#bookmark-context-menu', { timeout: 10_000 });
}

async function setup(page) {
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await prepareDashboardInteraction(page);
    await page.evaluate(() => document.querySelectorAll('.quickstart-card').forEach((el) => el.remove()));
}

/** Replace navigator.share with a recorder that resolves, rejects, or aborts. */
async function stubShare(page, behaviour) {
    await page.evaluate((mode) => {
        window.__shareCalls = [];
        Object.defineProperty(navigator, 'share', {
            configurable: true,
            writable: true,
            value: (data) => {
                window.__shareCalls.push(data);
                if (mode === 'abort') {
                    const err = new Error('user aborted');
                    err.name = 'AbortError';
                    return Promise.reject(err);
                }
                if (mode === 'reject') {
                    const err = new Error('not allowed');
                    err.name = 'NotAllowedError';
                    return Promise.reject(err);
                }
                return Promise.resolve();
            },
        });
    }, behaviour);
}

/** Remove Web Share entirely, the way Firefox on the desktop presents itself. */
async function removeShare(page) {
    await page.evaluate(() => {
        // @ts-ignore - deleting an optional platform API on purpose
        delete navigator.share;
        window.__clipboardWrites = [];
        Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: {
                writeText: (text) => {
                    window.__clipboardWrites.push(text);
                    return Promise.resolve();
                },
            },
        });
    });
}

test.describe('dashboard share from the right-click menu', () => {
    test.describe.configure({ mode: 'serial' });

    test('the menu offers Share', async ({ page }) => {
        await setup(page);
        const row = await firstRow(page);
        await openContextMenu(page, row);
        await expect(page.locator('[data-action="share"]')).toHaveCount(1);
    });

    /**
     * The label names what will happen. Desktop Chrome and Firefox expose no
     * navigator.share even on a secure origin, so an entry reading "Share…"
     * there opens nothing and copies instead — which reads as a broken feature
     * rather than a documented fallback.
     */
    test('the entry is labelled Share only when a share sheet exists', async ({ page }) => {
        await page.addInitScript(() => {
            Object.defineProperty(navigator, 'share', {
                configurable: true, writable: true,
                value: () => Promise.resolve(),
            });
        });
        await setup(page);
        const row = await firstRow(page);
        await openContextMenu(page, row);
        expect(await page.evaluate(() => document
            .querySelector('#bookmark-context-menu [data-action="share"]')?.textContent.trim()))
            .toContain('Share…');
    });

    test('the entry names the copy when there is no share sheet', async ({ page }) => {
        // Headless Chromium has none, which is also the desktop Chrome case.
        await setup(page);
        const row = await firstRow(page);
        await openContextMenu(page, row);
        expect(await page.evaluate(() => document
            .querySelector('#bookmark-context-menu [data-action="share"]')?.textContent.trim()))
            .toContain('Copy name + URL');
    });

    test('hands the share sheet the bookmark title and URL', async ({ page }) => {
        await setup(page);
        await stubShare(page, 'resolve');

        const row = await firstRow(page);
        const expected = await row.evaluate((el) => ({
            url: el.getAttribute('data-bookmark-url')
                || window.dashboardInstance.bookmarks[Number(el.getAttribute('data-bookmark-index'))].url,
            name: window.dashboardInstance.bookmarks[Number(el.getAttribute('data-bookmark-index'))]?.name,
        }));

        await openContextMenu(page, row);
        await page.locator('[data-action="share"]').click();

        await expect.poll(() => page.evaluate(() => window.__shareCalls.length)).toBe(1);
        const call = await page.evaluate(() => window.__shareCalls[0]);
        expect(call.url).toBe(expected.url);
        // The title is what makes this different from Copy URL one row above.
        if (expected.name) expect(call.title).toBe(expected.name);
    });

    test('a cancelled share sheet does not fall back to the clipboard', async ({ page }) => {
        await setup(page);
        await stubShare(page, 'abort');
        await page.evaluate(() => {
            window.__clipboardWrites = [];
            Object.defineProperty(navigator, 'clipboard', {
                configurable: true,
                value: {
                    writeText: (text) => {
                        window.__clipboardWrites.push(text);
                        return Promise.resolve();
                    },
                },
            });
        });

        const row = await firstRow(page);
        await openContextMenu(page, row);

        const result = await page.evaluate(async () => {
            const d = window.dashboardInstance;
            const el = document.querySelector('.bookmark-link');
            const ref = d.contextMenu.resolveRowBookmark(el);
            return d.contextMenu.shareBookmark(ref.bookmark, el);
        });

        expect(result).toBe('cancelled');
        // Closing the sheet is a finished gesture, not a failure to route around.
        expect(await page.evaluate(() => window.__clipboardWrites.length)).toBe(0);
    });

    test('copies name and URL when the browser has no share sheet', async ({ page }) => {
        await setup(page);
        await removeShare(page);

        const row = await firstRow(page);
        const result = await page.evaluate(async () => {
            const d = window.dashboardInstance;
            const el = document.querySelector('.bookmark-link');
            const ref = d.contextMenu.resolveRowBookmark(el);
            const outcome = await d.contextMenu.shareBookmark(ref.bookmark, el);
            return { outcome, written: window.__clipboardWrites, bookmark: ref.bookmark };
        });

        expect(result.outcome).toBe('copied');
        expect(result.written).toHaveLength(1);
        expect(result.written[0]).toContain(result.bookmark.url);
        if (result.bookmark.name) {
            expect(result.written[0]).toContain(result.bookmark.name);
        }
    });

    test('a rejected share still reaches the clipboard', async ({ page }) => {
        await setup(page);
        await stubShare(page, 'reject');
        await page.evaluate(() => {
            window.__clipboardWrites = [];
            Object.defineProperty(navigator, 'clipboard', {
                configurable: true,
                value: {
                    writeText: (text) => {
                        window.__clipboardWrites.push(text);
                        return Promise.resolve();
                    },
                },
            });
        });

        const result = await page.evaluate(async () => {
            const d = window.dashboardInstance;
            const el = document.querySelector('.bookmark-link');
            const ref = d.contextMenu.resolveRowBookmark(el);
            const outcome = await d.contextMenu.shareBookmark(ref.bookmark, el);
            return { outcome, written: window.__clipboardWrites };
        });

        expect(result.outcome).toBe('copied');
        expect(result.written).toHaveLength(1);
    });
});
