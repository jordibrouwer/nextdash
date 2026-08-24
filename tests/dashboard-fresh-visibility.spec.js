// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissBlockingOverlays, dismissOnboardingIfPresent } = require('./e2e-helpers');

/**
 * Which bookmarks take part in Fresh at all.
 *
 * A row with a feed and nothing new is identical to a row with no feed, and the
 * count on the Fresh tab says how many there are without saying which. Three
 * answers, in order of how loud they are: the feed address in the editor, a
 * `status:feed` search, and — only if asked for — a quiet mark on the row.
 */

const FEED_URL = 'https://blog.example/feed.xml';

/** Put one bookmark's feed into the client's map, as /api/feeds would. */
async function withKnownFeed(page) {
    return page.evaluate(() => {
        const d = window.dashboardInstance;
        const bookmark = d.bookmarks[0];
        d.feeds.enabled = true;
        d.feeds.byKey = new Map([[d.feeds.key(bookmark.url), {
            feedUrl: 'https://blog.example/feed.xml', newCount: 0, lastItemAt: Date.now(),
        }]]);
        return bookmark.url;
    });
}

async function openDashboard(page) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
}

test.describe('finding out which bookmarks publish', () => {
    test('status:feed narrows to the ones taking part', async ({ page }) => {
        await openDashboard(page);
        const url = await withKnownFeed(page);

        const matched = await page.evaluate((feedUrl) => {
            const d = window.dashboardInstance;
            const search = d.searchComponent || d.search;
            const match = (bookmark, filter) => search.matchesFilterKey(bookmark, 'status', filter);
            const withFeed = d.bookmarks.filter((b) => match(b, 'feed')).map((b) => b.url);
            const without = d.bookmarks.filter((b) => match(b, 'unfed')).map((b) => b.url);
            return { withFeed, without, total: d.bookmarks.length, feedUrl };
        }, url);

        expect(matched.withFeed).toEqual([url]);
        // And its negation is everything else, so the pair can be trusted.
        expect(matched.without).not.toContain(url);
        expect(matched.without.length).toBe(matched.total - 1);
    });

    test('the row stays silent unless the reader asks for the mark', async ({ page }) => {
        await openDashboard(page);
        await withKnownFeed(page);

        await page.evaluate(() => {
            window.dashboardInstance.settings.feedsMarkQuiet = false;
            window.dashboardInstance.renderDashboard({ animate: false, forceFull: true });
        });
        // Nothing new means nothing on the row: a mark on every participating
        // row is the noise Fresh exists to avoid.
        await expect(page.locator('.bookmark-fresh-badge.is-quiet')).toHaveCount(0);

        await page.evaluate(() => {
            window.dashboardInstance.settings.feedsMarkQuiet = true;
            window.dashboardInstance.renderDashboard({ animate: false, forceFull: true });
        });
        // The same bookmark can be drawn more than once — a smart collection
        // shows the real row — so count rows, not bookmarks.
        const mark = page.locator('.bookmark-fresh-badge.is-quiet');
        await expect.poll(() => mark.count()).toBeGreaterThan(0);
        // Named for a screen reader rather than left as a bare dot.
        await expect(mark.first()).toHaveAttribute('aria-label', /feed/i);
    });

    test('a count still wins over the quiet mark', async ({ page }) => {
        await openDashboard(page);
        await page.evaluate(() => {
            const d = window.dashboardInstance;
            const bookmark = d.bookmarks[0];
            d.settings.feedsMarkQuiet = true;
            d.feeds.enabled = true;
            d.feeds.byKey = new Map([[d.feeds.key(bookmark.url), {
                feedUrl: 'https://blog.example/feed.xml', newCount: 3, lastItemAt: Date.now(),
            }]]);
            d.renderDashboard({ animate: false, forceFull: true });
        });

        await expect(page.locator('.bookmark-fresh-badge.is-quiet')).toHaveCount(0);
        await expect(page.locator('.bookmark-fresh-badge').first()).toHaveText('3');
    });
});
