// @ts-check
const { test, expect } = require('@playwright/test');
const { dismissOnboardingIfPresent, dismissBlockingOverlays, markWhatsNewSeen } = require('./e2e-helpers');

/**
 * Fresh: a bookmark that says when its page has published something.
 *
 * The polling and the counting are the server's (feeds.go, covered by Go tests
 * against a real feed). What is pinned here is what the dashboard does with the
 * answer: a quiet count on the row, a collection ordered by publication rather
 * than by anything you did, and a count that clears the moment you open the
 * bookmark — because lastOpened is the only read state there is.
 *
 * The endpoint is stubbed rather than fed a real blog: the e2e install has no
 * feed to poll, and what is under test here is the painting, not the polling.
 */

async function withFeeds(page, entries, { enabled = true } = {}) {
    await page.route('**/api/feeds', (route) => route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ enabled, lastPoll: Date.now(), feeds: entries }),
    }));
}

async function loadDashboard(page) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.allBookmarks?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
}

/** The first bookmark on the current page, and the key the server would use. */
async function firstBookmark(page) {
    return page.evaluate(() => {
        const bookmark = window.dashboardInstance.bookmarks[0];
        return {
            url: bookmark.url,
            name: bookmark.name,
            key: window.BookmarkUrlUtils.canonicalBookmarkURLKey(bookmark.url),
        };
    });
}

test.describe('a bookmark with something new', () => {
    test('carries the count, and opening it clears it', async ({ page }) => {
        await loadDashboard(page);
        const target = await firstBookmark(page);

        await withFeeds(page, {
            [target.key]: { feedUrl: 'https://example.com/feed.xml', newCount: 3, lastItemAt: Date.now() },
        });
        await page.reload();
        await loadDashboard(page);

        const badge = page.locator(
            `#dashboard-layout .bookmark-link[data-bookmark-url="${target.url}"] .bookmark-fresh-badge`
        ).first();
        await expect(badge).toBeVisible({ timeout: 10_000 });
        await expect(badge).toHaveText('3');
        // The count says what it means on hover and to a screen reader, rather
        // than being a bare number nobody can interpret.
        await expect(badge).toHaveAttribute('aria-label', /3/);

        // Opening is the read state. The server recomputes against lastOpened;
        // this is the half that has to happen before the next page load.
        await page.evaluate(() => {
            const d = window.dashboardInstance;
            d.recordBookmarkOpened(d.bookmarks[0], 0, 'test');
            d.renderDashboard();
        });
        await expect(page.locator(
            `#dashboard-layout .bookmark-link[data-bookmark-url="${target.url}"] .bookmark-fresh-badge`
        ).first()).toBeHidden();
    });

    test('no badge at all when feed polling is off', async ({ page }) => {
        await loadDashboard(page);
        const target = await firstBookmark(page);

        // The server answers with an empty map when the setting is off; a
        // dashboard that painted badges from a disabled feature would be
        // reporting on polling that never ran.
        await withFeeds(page, {}, { enabled: false });
        await page.reload();
        await loadDashboard(page);

        await expect(page.locator(
            `#dashboard-layout .bookmark-link[data-bookmark-url="${target.url}"] .bookmark-fresh-badge`
        ).first()).toBeHidden();
        expect(await page.evaluate(() => window.dashboardInstance.feeds.enabled)).toBe(false);
    });
});

test.describe('the Fresh collection', () => {
    test('appears only when something is fresh, newest publication first', async ({ page }) => {
        await loadDashboard(page);
        const targets = await page.evaluate(() => window.dashboardInstance.bookmarks.slice(0, 2).map((b) => ({
            url: b.url,
            name: b.name,
            key: window.BookmarkUrlUtils.canonicalBookmarkURLKey(b.url),
        })));
        test.skip(targets.length < 2, 'needs two bookmarks on the current page');

        const now = Date.now();
        await withFeeds(page, {
            // The older publication first in the map, so the ordering under test
            // cannot come from insertion order.
            [targets[0].key]: { feedUrl: 'https://example.com/a.xml', newCount: 1, lastItemAt: now - 86_400_000 },
            [targets[1].key]: { feedUrl: 'https://example.com/b.xml', newCount: 5, lastItemAt: now },
        });
        await page.reload();
        await loadDashboard(page);

        const fresh = page.locator('#dashboard-layout .category[data-category-id="__smart_fresh__"]');
        await expect(fresh).toBeVisible({ timeout: 10_000 });
        await expect(fresh.locator('.category-title-name')).toContainText('2');

        const order = await fresh.locator('.bookmark-link').evaluateAll(
            (links) => links.map((link) => link.getAttribute('data-bookmark-url')));
        expect(order.slice(0, 2)).toEqual([targets[1].url, targets[0].url]);
    });

    test('is absent when nothing has published', async ({ page }) => {
        await loadDashboard(page);
        await withFeeds(page, {});
        await page.reload();
        await loadDashboard(page);

        // A Fresh heading over an empty list would be a section explaining that
        // nothing happened.
        await expect(page.locator('#dashboard-layout .category[data-category-id="__smart_fresh__"]')).toHaveCount(0);
    });
});
