// @ts-check
const { test, expect } = require('@playwright/test');

async function dismissOnboardingIfPresent(page) {
    const card = page.locator('.onboarding-card');
    if (await card.count()) {
        await page.locator('.onboarding-skip').click();
        await expect(card).toHaveCount(0, { timeout: 5000 });
    }
}

async function dismissWhatsNewIfPresent(page) {
    const modal = page.locator('#app-modal.show');
    if (await modal.count()) {
        await page.keyboard.press('Escape');
        await expect(modal).toHaveCount(0, { timeout: 5000 });
    }
}

async function markWhatsNewSeen(page) {
    await page.addInitScript(() => {
        try {
            const release = '2026.06-dashboard-release-v71';
            localStorage.setItem('nextdash:last-whats-new-dashboard-release', release);
            localStorage.setItem('nextdash:whats-new-search-promo-release', release);
            localStorage.setItem('nextdash:whats-new-search-promo-start', '0');
        } catch {
            // ignore
        }
    });
}

async function resetOnboarding(page) {
    await page.evaluate(async () => {
        localStorage.removeItem('nextDashOnboardingSeenV2');
        localStorage.removeItem('nextDashOnboardingVersionV2');
        const response = await fetch('/api/settings');
        if (response.ok) {
            const settings = await response.json();
            settings.onboardingCompleted = false;
            await fetch('/api/settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(settings),
            });
        }
    });
}

async function seedRecentBookmarks(page, count) {
    await page.evaluate(async (bookmarkCount) => {
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
                const save = await fetch(`/api/bookmarks?page=${pageId}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                });
                if (!save.ok) {
                    await new Promise((resolve) => setTimeout(resolve, 100 * (attempt + 1)));
                    continue;
                }
            }
            await dash.loadPageBookmarks(pageId);
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
        document.getElementById('page-overview-overlay')?.remove();
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
});

test.describe('layout modern nudge after onboarding', () => {
    test('shows layout spotlight when nudge key cleared after onboarding skip', async ({ page }) => {
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
            localStorage.getItem('nextdash:layout-modern-nudge-v1') === '1'
        ))).toBe(true);

        await page.evaluate(() => {
            const dash = window.dashboardInstance;
            if (!dash) throw new Error('dashboardInstance missing');

            try {
                localStorage.removeItem('nextdash:layout-modern-nudge-v1');
                localStorage.setItem('nextdash:feature-spotlight-paste-v1', '1');
                localStorage.setItem('nextdash:feature-spotlight-preview-cards-v1', '1');
                if (window.NEXTDASH_WHATS_NEW_RELEASE) {
                    localStorage.setItem(
                        'nextdash:last-whats-new-dashboard-release',
                        window.NEXTDASH_WHATS_NEW_RELEASE
                    );
                }
            } catch {
                // ignore
            }

            dash.settings.layoutVersion = 'classic';
            dash.settings.onboardingCompleted = true;
            dash.onboardingStartedInSession = false;
            document.documentElement.setAttribute('data-layout-version', 'classic');
            document.body.setAttribute('data-layout-version', 'classic');

            dash.schedulePostOnboardingPrompts({
                delay: 0,
                resetAttempts: true,
                skipWhatsNew: true,
                skipPasteSpotlight: true,
                skipPreviewCardSpotlight: true,
            });
        });

        const spotlight = page.locator('.feature-spotlight.show');
        await expect(spotlight).toBeVisible({ timeout: 10_000 });
        await expect(spotlight.locator('.feature-spotlight-try')).toBeVisible();
        await expect(spotlight.locator('.feature-spotlight-try-secondary')).toBeVisible();
        expect(pageErrors).toEqual([]);
    });
});
