// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * Swiping sideways moves between dashboard pages on the bookmarks view. It
 * fired in every view: a slider dragged in Config, or a flick in Inbox, left
 * the view for the next page.
 */

test('a swipe outside the bookmarks view does not change the page', async ({ page }) => {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });

    const result = await page.evaluate(async () => {
        const d = window.dashboardInstance;
        const swipe = new window.SwipeNavigation(d);
        swipe.cleanup();
        let navigated = 0;
        swipe.navigateToNextPage = async () => { navigated += 1; };
        swipe.navigateToPreviousPage = async () => { navigated += 1; };
        const flick = () => {
            swipe.handleTouchStart({ changedTouches: [{ clientX: 300, clientY: 200 }], target: document.body });
            swipe.touchEndX = 100;
            swipe.touchEndY = 200;
            swipe.navigationLockUntil = 0;
            swipe.handleSwipe();
        };
        const onBookmarks = d.isBookmarksView();
        flick();
        const onDashboard = navigated;
        const realView = d.isBookmarksView;
        d.isBookmarksView = () => false;
        flick();
        d.isBookmarksView = realView;
        return { onBookmarks, onDashboard, elsewhere: navigated - onDashboard };
    });
    expect(result.onBookmarks).toBe(true);
    expect(result.onDashboard, 'a swipe on the bookmarks view should still navigate').toBe(1);
    expect(result.elsewhere).toBe(0);
});
