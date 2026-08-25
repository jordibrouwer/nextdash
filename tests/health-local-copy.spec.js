// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/*
 * Saving a page from a health row, and what a row says about the copies it has.
 */
test.describe('local copies in the health view', () => {
    test.beforeEach(async ({ page }) => {
        await markWhatsNewSeen(page);
        await page.goto('/');
        await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
        await dismissOnboardingIfPresent(page);
        await dismissBlockingOverlays(page);
    });

    /*
     * A bookmark pointed at the Web Archive shows the page it is a copy of.
     *
     * "Use the last archived copy" rewrites the address to
     * web.archive.org/web/<timestamp>/<original>. Printed raw that is a wayback
     * timestamp with the real site buried in the middle, which reads as two URLs
     * run together and tells the reader nothing about which bookmark this is.
     */
    test('an archived bookmark shows the page behind it', async ({ page }) => {
        const shown = await page.evaluate(async () => {
            const h = window.dashboardInstance.health;
            return {
                archived: String(await h.formatUrlDisplay('https://web.archive.org/web/20160926060646/https://github.com/')),
                plain: String(await h.formatUrlDisplay('https://github.com/issues')),
                original: String(await h.archivedOriginalUrl('https://web.archive.org/web/20160926060646/https://github.com/')),
                notArchived: String(await h.archivedOriginalUrl('https://github.com/')),
            };
        });

        expect(shown.archived).toContain('github.com');
        // The wayback timestamp is not what identifies this bookmark.
        expect(shown.archived).not.toContain('20160926060646');
        expect(shown.archived).not.toContain('web.archive.org');
        // And it says where it now points, or the row would claim to be the
        // live site.
        expect(shown.archived).toMatch(/archiv/i);

        // An ordinary URL is untouched.
        expect(shown.plain).toBe('github.com/issues');
        expect(shown.original).toBe('https://github.com/');
        expect(shown.notArchived).toBe('');
    });

    /*
     * Saving takes seconds -- monolith fetches every asset on the page -- and
     * without the overlay the app looks frozen. The same overlay config shows
     * for an import, from the same module.
     */
    test('saving a copy shows the working overlay', async ({ page }) => {
        // A capture that never answers, so the overlay can be observed while it
        // is up rather than raced against a fast local page.
        await page.route('**/api/archives/capture**', async (route) => {
            await new Promise((resolve) => setTimeout(resolve, 2500));
            await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ bytes: 816 }) });
        });

        await page.evaluate(() => {
            window.dashboardInstance.health.captureLocalCopy({ url: 'https://example.com/', pageId: 1, index: 0 });
        });

        const overlay = page.locator('#nextdash-progress-overlay');
        await expect(overlay).toBeVisible({ timeout: 10_000 });
        await expect(overlay).toContainText(/Saving/i);
        // Indeterminate: the work is one request of unknown length, and a bar
        // stuck at zero is the thing this exists to avoid.
        const indeterminate = await page.evaluate(() =>
            document.querySelector('[data-progress-fill]')?.classList.contains('progress-overlay-fill--indeterminate'));
        expect(indeterminate).toBe(true);
    });

    // The count travels with the report, so a row can say it without a request.
    test('a row says how many copies it has', async ({ page }) => {
        const label = await page.evaluate(async () => {
            const h = window.dashboardInstance.health;
            const strip = (v) => String(v).replace(/<[^>]+>/g, '|').replace(/\|+/g, ' ').trim();
            return {
                one: strip(await h.renderLocalCopies({ localCopies: 1, localCopyAt: Date.parse('2026-03-01') })),
                many: strip(await h.renderLocalCopies({ localCopies: 3, localCopyAt: Date.parse('2026-03-01') })),
                none: strip(await h.renderLocalCopies({ localCopies: 0 })),
            };
        });
        expect(label.one).toMatch(/copy/i);
        expect(label.many).toContain('3');
        // Nothing saved says nothing: an empty row is not news.
        expect(label.none).toBe('');
    });
});
