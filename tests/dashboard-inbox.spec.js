const { test, expect } = require('@playwright/test');
const { markWhatsNewSeen, dismissBlockingOverlays, dismissOnboardingIfPresent } = require('./e2e-helpers');

test.describe('dashboard inbox phase 1', () => {
    test.beforeEach(async ({ page }) => {
        await markWhatsNewSeen(page);
        await page.goto('/');
        await page.waitForSelector('#dashboard-layout', { timeout: 15_000 });
        await dismissOnboardingIfPresent(page);
        await dismissBlockingOverlays(page);
        await page.waitForFunction(() => window.dashboardInstance?.inbox != null, null, { timeout: 15_000 });
    });

    test('opens inbox via command palette', async ({ page }) => {
        await page.evaluate(() => {
            window.dashboardInstance.settings.inboxEnabled = true;
        });

        await page.keyboard.press(':');
        await page.keyboard.type('inbox', { delay: 20 });
        await expect(page.locator('#shortcut-search.show')).toBeVisible({ timeout: 5000 });
        await page.keyboard.press('Enter');
        await expect(page.locator('.inbox-layout')).toBeVisible();
    });

    test('triage overlay opens from toolbar', async ({ page }) => {
        await page.evaluate(() => {
            window.dashboardInstance.settings.inboxEnabled = true;
        });

        await page.locator('#page-nav-inbox-btn').click();
        await expect(page.locator('.inbox-layout')).toBeVisible();
        await page.locator('.inbox-triage-btn').click();
        await expect(page.locator('#inbox-triage-overlay')).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(page.locator('#inbox-triage-overlay')).toHaveCount(0);
    });

    test('opens inbox via 0 key', async ({ page }) => {
        await page.evaluate(() => {
            window.dashboardInstance.settings.inboxEnabled = true;
        });

        await page.keyboard.press('0');
        await expect(page.locator('.inbox-layout')).toBeVisible();
        await expect.poll(() => page.evaluate(() => window.dashboardInstance?.activeView)).toBe('inbox');
    });

    test('escape closes inbox and returns to bookmarks', async ({ page }) => {
        await page.evaluate(() => {
            window.dashboardInstance.settings.inboxEnabled = true;
        });

        await page.locator('#page-nav-inbox-btn').click();
        await expect(page.locator('.inbox-layout')).toBeVisible();

        await page.keyboard.press('Escape');
        await expect(page.locator('.inbox-layout')).toHaveCount(0);
        await expect(page.locator('#dashboard-layout .category').first()).toBeVisible();
        await expect.poll(() => page.evaluate(() => window.dashboardInstance?.activeView)).toBe('bookmarks');
    });

    test('returns to same bookmark page from inbox via number key', async ({ page }) => {
        await page.evaluate(() => {
            window.dashboardInstance.settings.inboxEnabled = true;
        });

        await page.locator('#page-nav-inbox-btn').click();
        await expect(page.locator('.inbox-layout')).toBeVisible();

        await page.keyboard.press('1');
        await expect(page.locator('.inbox-layout')).toHaveCount(0);
        await expect(page.locator('#dashboard-layout .category').first()).toBeVisible();
        await expect.poll(() => page.evaluate(() => window.dashboardInstance?.activeView)).toBe('bookmarks');
    });

    test('paste choice modal offers bookmark and inbox', async ({ page }) => {
        await page.evaluate(() => {
            window.dashboardInstance.settings.inboxEnabled = true;
            window.dashboardInstance.settings.pasteDestination = 'ask';
        });

        await page.focus('body');
        const pastedUrl = await page.evaluate(() => {
            const stamp = Date.now();
            const url = `https://inbox-paste-${stamp}.example.com/`;
            const event = new ClipboardEvent('paste', {
                bubbles: true,
                cancelable: true,
                clipboardData: new DataTransfer(),
            });
            event.clipboardData.setData('text/plain', url);
            document.dispatchEvent(event);
            return url;
        });

        const modal = page.locator('#paste-choice-modal.show');
        await expect(modal).toBeVisible({ timeout: 5000 });
        await modal.locator('[data-paste-choice="inbox"]').click();
        await expect(modal).toBeHidden();

        await page.waitForFunction((url) => (
            (window.dashboardInstance?.inbox?.items || []).some((item) => item.url === url)
        ), pastedUrl);

        await page.locator('#page-nav-inbox-btn').click();
        await expect.poll(async () => page.evaluate((url) => {
            const item = (window.dashboardInstance?.inbox?.items || []).find((entry) => entry.url === url);
            return item ? document.querySelector(`[data-inbox-id="${item.id}"]`) != null : false;
        }, pastedUrl)).toBe(true);
    });

    test('arrow keys navigate inbox items and Enter opens link', async ({ page }) => {
        await page.evaluate(() => {
            window.dashboardInstance.settings.inboxEnabled = true;
        });

        await page.locator('#page-nav-inbox-btn').click();
        await expect(page.locator('.inbox-feed .inbox-item').first()).toBeVisible();

        await page.keyboard.press('ArrowDown');
        await expect(page.locator('.inbox-item.keyboard-selected').first()).toBeVisible();

        await page.locator('.inbox-search-input').focus();
        await page.keyboard.press('ArrowDown');
        await expect(page.locator('.inbox-item.keyboard-selected').first()).toBeVisible();

        await page.keyboard.press('ArrowUp');
        await expect(page.locator('.inbox-item.keyboard-selected').first()).toBeVisible();

        const readRequest = page.waitForRequest((request) => (
            request.url().includes('/api/inbox')
            && request.method() === 'PATCH'
        ));
        await page.keyboard.press('Enter');
        await readRequest;
    });

    test('inbox keyboard survives background bookmark refresh', async ({ page }) => {
        await page.evaluate(() => {
            window.dashboardInstance.settings.inboxEnabled = true;
        });

        await page.locator('#page-nav-inbox-btn').click();
        await expect(page.locator('.inbox-feed .inbox-item').first()).toBeVisible();

        await page.evaluate(() => {
            const d = window.dashboardInstance;
            d.data._applyLoadedPageData(d.currentPageId, d.bookmarks, d.categories, { skipRender: true });
        });

        await expect.poll(() => page.evaluate(() => window.dashboardInstance?.activeView)).toBe('inbox');

        await page.keyboard.press('ArrowDown');
        await expect(page.locator('.inbox-item.keyboard-selected').first()).toBeVisible();
    });

    test('inbox search typing does not open global search modal', async ({ page }) => {
        await page.evaluate(() => {
            window.dashboardInstance.settings.inboxEnabled = true;
        });

        await page.locator('#page-nav-inbox-btn').click();
        await expect(page.locator('.inbox-layout')).toBeVisible();

        const search = page.locator('.inbox-search-input');
        await search.click();
        await search.pressSequentially('letters', { delay: 30 });
        await expect(page.locator('#shortcut-search.show')).toHaveCount(0);
        await expect(search).toHaveValue('letters');
        await expect(search).toBeFocused();
    });

    test('bookmark keyboard navigation works after leaving inbox', async ({ page }) => {
        await page.evaluate(() => {
            window.dashboardInstance.settings.inboxEnabled = true;
        });

        await page.locator('#page-nav-inbox-btn').click();
        await expect(page.locator('.inbox-layout')).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(page.locator('#dashboard-layout .bookmark-link').first()).toBeVisible();

        await page.keyboard.press('ArrowDown');
        await expect.poll(() => page.evaluate(() => (
            window.dashboardInstance?.keyboardNavigation?.currentIndex ?? -1
        ))).toBeGreaterThanOrEqual(0);
        await expect(page.locator('.bookmark-link.keyboard-selected').first()).toBeVisible();
    });

    test('stays on inbox when hash changes to a page number while inbox is active', async ({ page }) => {
        await page.evaluate(() => {
            window.dashboardInstance.settings.inboxEnabled = true;
        });

        await page.locator('#page-nav-inbox-btn').click();
        await expect(page.locator('.inbox-layout')).toBeVisible();

        await page.evaluate(() => {
            window.location.hash = '#1';
        });

        await expect(page.locator('.inbox-layout')).toBeVisible();
        await expect.poll(() => page.evaluate(() => window.dashboardInstance?.activeView)).toBe('inbox');
        await expect.poll(() => page.evaluate(() => window.location.hash)).toBe('#inbox');
    });

    test('shows one-time inbox intro toast for existing users', async ({ page }) => {
        await page.evaluate(() => {
            window.DiscoverabilityState?.markStorageKeyConfirmed?.('nextdash:layout-beta-toast-v1');
            window.DiscoverabilityState?.clearStorageKey?.('nextdash:inbox-intro-toast-v1');
            try {
                localStorage.removeItem('nextdash:inbox-intro-toast-v1');
            } catch { /* ignore */ }
            window.dashboardInstance.settings.onboardingCompleted = true;
            window.dashboardInstance.settings.inboxEnabled = true;
        });

        await page.evaluate(() => window.InboxIntroToast.scheduleShow({ delay: 0, resetAttempts: true }));

        const toastText = page.locator('#app-notification.show .app-notification-text');
        await expect(toastText).toBeVisible({ timeout: 5000 });
        await expect(toastText).toContainText(/0/);
        await expect.poll(() => page.evaluate(() => window.InboxIntroToast.hasShown())).toBe(true);

        await page.evaluate(() => window.AppNotification?.hide?.());
        await page.evaluate(() => window.InboxIntroToast.scheduleShow({ delay: 0, resetAttempts: true }));
        await page.waitForTimeout(500);
        await expect(page.locator('#app-notification.show .app-notification-text')).toHaveCount(0);
    });
});
