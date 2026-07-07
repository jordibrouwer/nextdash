// @ts-check
const { test, expect } = require('@playwright/test');
const { markWhatsNewSeen, dismissWhatsNewIfPresent, dismissOnboardingIfPresent } = require('./e2e-helpers');

async function resetOnboarding(page) {
    await page.evaluate(async () => {
        localStorage.removeItem('nextDashOnboardingSeenV2');
        localStorage.removeItem('nextDashOnboardingVersionV2');
        const response = await fetch('/api/settings');
        if (response.ok) {
            const settings = await response.json();
            settings.onboardingCompleted = false;
            const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
            await api('/api/settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(settings),
            });
        }
    });
}

async function seedRecentBookmarks(page, count) {
    await page.evaluate(async (bookmarkCount) => {
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        const dash = window.dashboardInstance;
        if (!dash) throw new Error('dashboardInstance missing');

        const pageId = dash.currentPageId;
        const base = Date.now();
        const additions = Array.from({ length: bookmarkCount }, (_, index) => ({
            name: `Recent e2e ${index + 1}`,
            url: `https://example.com/recent-e2e-${base}-${index}`,
            shortcut: '',
            category: '',
            checkStatus: false,
            lastOpened: base - index * 1000,
            openCount: 1,
            createdAt: base - index * 1000,
        }));

        for (let attempt = 0; attempt < 5; attempt += 1) {
            const response = await fetch(`/api/bookmarks?page=${pageId}`);
            if (!response.ok) throw new Error(`fetch bookmarks failed: ${response.status}`);
            const existing = await response.json();
            const missing = additions.filter((bm) => !existing.some((entry) => entry.url === bm.url));
            const payload = missing.length ? [...existing, ...missing] : existing;
            if (missing.length) {
                const save = await api(`/api/bookmarks?page=${pageId}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                });
                if (!save.ok) {
                    await new Promise((resolve) => setTimeout(resolve, 100 * (attempt + 1)));
                    continue;
                }
            }
            await dash.loadPageBookmarks(pageId, { forceFetch: true });
            const recent = dash.recent.getRecentBookmarksWithUrls(dash.bookmarks, 0);
            if (recent.length >= bookmarkCount) {
                return;
            }
            await new Promise((resolve) => setTimeout(resolve, 100 * (attempt + 1)));
        }
        throw new Error('failed to seed recent bookmarks');
    }, count);
}

async function closeDashboardOverlays(page) {
    await dismissWhatsNewIfPresent(page);
    await page.evaluate(() => {
        window.AppModal?.hide?.();
        window.dashboardInstance?.searchComponent?.closeSearch?.();
        document.querySelector('#app-modal.show .page-overview-modal') && window.AppModal?.hide?.();
        document.getElementById('omnibox-overlay')?.remove();
        document.getElementById('tag-popover')?.remove();
        document.getElementById('move-popover')?.remove();
        document.getElementById('delete-popover')?.remove();
    });
}

test.describe('recent bookmarks modal', () => {
    test.beforeEach(async ({ page }) => {
        await markWhatsNewSeen(page);
        await page.goto('/');
        await page.waitForSelector('.bookmark-link', { timeout: 15_000 });
        await dismissOnboardingIfPresent(page);
        await dismissWhatsNewIfPresent(page);
    });

    test('splits open-tabs plans at 15 when more than 15 recent bookmarks exist', async ({ page }) => {
        await seedRecentBookmarks(page, 18);

        const capCheck = await page.evaluate(() => {
            const dash = window.dashboardInstance;
            const recent = dash.recent;
            const cap = window.DashboardBookmarkRows.OPEN_TABS_CAP;
            const displayLimit = window.DashboardBookmarkRows.RECENT_MODAL_DISPLAY_LIMIT;
            const allRecent = recent.getRecentBookmarksWithUrls(dash.bookmarks, 0);
            const plans = recent.buildOpenTabsPlans(allRecent, {
                all: 'recentOpenShown',
                first: 'recentOpenShownFirst',
            });

            return {
                cap,
                displayLimit,
                recentCount: allRecent.length,
                planCount: plans.length,
                firstBatchSize: plans[0]?.bookmarks?.length ?? 0,
                secondBatchSize: plans[1]?.bookmarks?.length ?? 0,
            };
        });

        expect(capCheck.cap).toBe(15);
        expect(capCheck.displayLimit).toBe(10);
        expect(capCheck.recentCount).toBeGreaterThanOrEqual(18);
        expect(capCheck.planCount).toBe(2);
        expect(capCheck.firstBatchSize).toBe(15);
        expect(capCheck.secondBatchSize).toBe(capCheck.recentCount);

        await closeDashboardOverlays(page);
        await page.evaluate(() => window.dashboardInstance.toggleRecentBookmarksModal());
        const modal = page.locator('#app-modal.show .recent-bookmarks-modal');
        await expect.poll(async () => modal.count()).toBeGreaterThan(0);
        await expect(modal).toBeVisible({ timeout: 5000 });
        await expect(modal.locator('.recent-bookmarks-modal-item')).toHaveCount(10);
        await expect(modal.locator('.recent-bookmarks-open-btn').first()).toBeVisible({ timeout: 5000 });
    });

    test('shows recency and open count on recent modal rows (D8)', async ({ page }) => {
        await seedRecentBookmarks(page, 3);

        await closeDashboardOverlays(page);
        await page.evaluate(() => window.dashboardInstance.toggleRecentBookmarksModal());
        const modal = page.locator('#app-modal.show .recent-bookmarks-modal');
        await expect(modal).toBeVisible({ timeout: 5000 });

        const first = modal.locator('.recent-bookmarks-modal-item').first();
        await expect(first.locator('.recent-bookmarks-modal-rank')).toHaveText('1');
        await expect(first.locator('.recent-bookmarks-modal-recency')).not.toBeEmpty();
        await expect(first.locator('.recent-bookmarks-modal-opens')).toContainText('×');
        await expect(first.locator('.recent-bookmarks-modal-detail')).toBeVisible();
    });
});

test.describe('layout modern nudge after onboarding', () => {
    test('shows layout spotlight when nudge key cleared for manual replay', async ({ page }) => {
        const pageErrors = [];
        page.on('pageerror', (e) => pageErrors.push(e.message));

        await page.goto('/');
        await resetOnboarding(page);
        await page.reload();
        await page.waitForSelector('.onboarding-card', { timeout: 15_000 });
        await page.locator('.onboarding-skip').click();
        await expect(page.locator('.onboarding-card')).toHaveCount(0, { timeout: 5000 });
        await expect.poll(async () => page.evaluate(() => (
            window.dashboardInstance?.settings?.onboardingCompleted === true
        ))).toBe(true);
        await expect.poll(async () => page.evaluate(() => (
            window.DiscoverabilityState?.isStorageKeyConfirmed?.('nextdash:layout-modern-nudge-v1') === true
        ))).toBe(true);

        await page.evaluate(() => {
            const dash = window.dashboardInstance;
            if (!dash) throw new Error('dashboardInstance missing');

            window.DiscoverabilityState?.clearStorageKey?.('nextdash:layout-modern-nudge-v1');

            dash.settings.layoutVersion = 'classic';
            dash.settings.onboardingCompleted = true;
            dash.onboardingStartedInSession = false;
            document.documentElement.setAttribute('data-layout-version', 'classic');
            document.body.setAttribute('data-layout-version', 'classic');

            if (!window.LayoutVersionNudge?.shouldOffer?.(dash)) {
                throw new Error('LayoutVersionNudge.shouldOffer expected true after clear');
            }
            const spotlight = window.LayoutVersionNudge.create(dash);
            if (!spotlight?.show(0, { canShow: () => true })) {
                throw new Error('LayoutVersionNudge spotlight failed to start');
            }
        });

        const spotlight = page.locator('.feature-spotlight.show');
        await expect(spotlight).toBeVisible({ timeout: 10_000 });
        await expect(spotlight.locator('.feature-spotlight-try')).toBeVisible();
        await expect(spotlight.locator('.feature-spotlight-try-secondary')).toBeVisible();
        expect(pageErrors).toEqual([]);
    });
});
