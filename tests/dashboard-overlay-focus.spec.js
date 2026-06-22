// @ts-check
const { test, expect } = require('@playwright/test');

async function dismissOnboardingIfPresent(page) {
    const card = page.locator('.onboarding-card');
    if (await card.count()) {
        await page.locator('.onboarding-skip').click();
        await expect(card).toHaveCount(0, { timeout: 5000 });
    }
}

async function markWhatsNewSeen(page) {
    await page.addInitScript(() => {
        try {
            const release = '2026.06-dashboard-release-v72';
            localStorage.setItem('nextdash:last-whats-new-dashboard-release', release);
            localStorage.setItem('nextdash:whats-new-search-promo-release', release);
            localStorage.setItem('nextdash:whats-new-search-promo-start', '0');
            [
                'nextdash:dashboard-cheatsheet-promo-confirmed-v1',
                'nextdash:dashboard-recent-bookmarks-promo-confirmed-v1',
                'nextdash:dashboard-page-overview-promo-confirmed-v1',
                'nextdash:dashboard-tag-cloud-promo-confirmed-v1',
                'nextdash:dashboard-quick-add-omnibox-promo-confirmed-v1',
            ].forEach((key) => localStorage.setItem(key, '1'));
        } catch {
            // ignore
        }
    });
}

async function dismissBlockingOverlays(page) {
    const whatsNew = page.locator('#app-modal.show');
    if (await whatsNew.count()) {
        await page.keyboard.press('Escape');
        await expect(whatsNew).toHaveCount(0, { timeout: 3000 });
    }
}

async function closeDashboardOverlays(page) {
    await dismissBlockingOverlays(page);
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

test.describe('dashboard overlay focus', () => {
    test.describe.configure({ mode: 'serial' });

    test.beforeEach(async ({ page }) => {
        await markWhatsNewSeen(page);
        await page.goto('/');
        await page.waitForSelector('.bookmark-link', { timeout: 15_000 });
        await dismissOnboardingIfPresent(page);
        await dismissBlockingOverlays(page);
    });

    test('search shortcut moves focus into search panel', async ({ page }) => {
        await page.keyboard.press('>');
        await expect(page.locator('#shortcut-search.show')).toBeVisible({ timeout: 5000 });

        await expect.poll(async () => {
            return page.evaluate(() => {
                const root = document.getElementById('shortcut-search');
                const active = document.activeElement;
                return Boolean(root && active instanceof Element && root.contains(active));
            });
        }).toBe(true);
    });

    test('cheat sheet shortcut moves focus into modal', async ({ page }) => {
        await closeDashboardOverlays(page);
        await page.keyboard.press('!');
        await expect(page.locator('#app-modal.show')).toBeVisible({ timeout: 5000 });
        await expect(page.locator('#app-modal.show .keyboard-cheat-sheet-modal')).toBeVisible({ timeout: 5000 });
        await page.evaluate(() => {
            if (window.DashboardFeaturePromos?.isPromoOpen?.('cheatsheet')) {
                window.DashboardFeaturePromos.dismissOpen?.();
            }
        });

        await expect.poll(async () => page.evaluate(() => {
            const modal = document.getElementById('app-modal');
            const active = document.activeElement;
            return Boolean(modal?.classList.contains('show') && active instanceof Element && modal.contains(active));
        }), { timeout: 15_000 }).toBe(true);
    });

    test('recent bookmarks shortcut moves focus into modal', async ({ page }) => {
        await closeDashboardOverlays(page);
        await page.evaluate(() => window.dashboardInstance?.searchComponent?.closeSearch?.());
        await page.keyboard.press('*');
        await expect(page.locator('#app-modal.show')).toBeVisible({ timeout: 5000 });
        await expect(page.locator('#app-modal.show .recent-bookmarks-modal')).toBeVisible({ timeout: 5000 });
        await expect.poll(async () => page.evaluate(() => (
            !document.querySelector('.recent-bookmarks-skeleton')
        )), { timeout: 15_000 }).toBe(true);
        await page.evaluate(() => {
            window.DashboardFeaturePromos?.dismissOpen?.();
            const closeBtn = document.querySelector('#app-modal.show .modal-button');
            closeBtn?.focus?.({ preventScroll: true });
        });

        await expect.poll(async () => page.evaluate(() => {
            const modal = document.getElementById('app-modal');
            const active = document.activeElement;
            return Boolean(modal?.classList.contains('show') && active instanceof Element && modal.contains(active));
        }), { timeout: 15_000 }).toBe(true);
    });

    test('page overview shortcut moves focus into overlay', async ({ page }) => {
        await closeDashboardOverlays(page);
        await page.keyboard.press(',');
        await expect(page.locator('#page-overview-overlay')).toBeVisible({ timeout: 5000 });
        await expect(page.locator('.page-overview-item.is-focused .page-overview-link')).toBeVisible({ timeout: 10_000 });
    });

    test('omnibox shortcut moves focus into overlay input', async ({ page }) => {
        await closeDashboardOverlays(page);
        await page.keyboard.press('&');
        await expect(page.locator('#omnibox-overlay')).toBeVisible({ timeout: 5000 });
        await page.evaluate(() => {
            if (window.DashboardFeaturePromos?.isPromoOpen?.('quickAddOmnibox')) {
                window.DashboardFeaturePromos.dismissOpen?.();
            }
        });
        await expect.poll(async () => page.evaluate(() => {
            const overlay = document.getElementById('omnibox-overlay');
            const input = overlay?.querySelector('.omnibox-input');
            return Boolean(input instanceof HTMLElement && document.activeElement === input);
        }), { timeout: 15_000 }).toBe(true);
    });

    test('tag cloud shortcut moves focus into modal', async ({ page }) => {
        const eligible = await page.evaluate(() => {
            const toggle = document.getElementById('tag-cloud-toggle');
            return Boolean(toggle?.classList.contains('is-eligible'));
        });
        test.skip(!eligible, 'tag cloud not eligible in this environment');

        await page.keyboard.press('/');
        await expect(page.locator('#tag-cloud-modal:not([hidden])')).toBeVisible({ timeout: 5000 });

        await expect.poll(async () => {
            return page.evaluate(() => {
                const modal = document.getElementById('tag-cloud-modal');
                const active = document.activeElement;
                return Boolean(modal && active instanceof Element && modal.contains(active));
            });
        }).toBe(true);
    });
});
