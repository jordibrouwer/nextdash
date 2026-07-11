// @ts-check
const { test, expect } = require('@playwright/test');
const { markWhatsNewSeen, dismissOnboardingIfPresent } = require('./e2e-helpers');

const OVERLAY_FOCUS_PROMO_KEYS = [
    'nextdash:dashboard-cheatsheet-promo-confirmed-v1',
    'nextdash:dashboard-recent-bookmarks-promo-confirmed-v1',
    'nextdash:dashboard-page-overview-promo-confirmed-v1',
    'nextdash:dashboard-tag-cloud-promo-confirmed-v1',
    'nextdash:dashboard-quick-add-omnibox-promo-confirmed-v1',
];

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
        document.getElementById('omnibox-overlay')?.remove();
        document.getElementById('tag-popover')?.remove();
        document.getElementById('move-popover')?.remove();
        document.getElementById('delete-popover')?.remove();
    });
}

test.describe('dashboard overlay focus', () => {
    test.describe.configure({ mode: 'serial' });

    test.beforeEach(async ({ page }) => {
        await markWhatsNewSeen(page, { extraPromoConfirmedKeys: OVERLAY_FOCUS_PROMO_KEYS });
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

    test('cheat sheet keeps tab focus trapped and supports keyboard scrolling', async ({ page }) => {
        await closeDashboardOverlays(page);
        await page.keyboard.press('!');
        await expect(page.locator('#app-modal.show .keyboard-cheat-sheet-modal')).toBeVisible({ timeout: 5000 });
        await page.evaluate(() => {
            window.DashboardFeaturePromos?.dismissOpen?.();
            const modal = document.querySelector('#app-modal.show .keyboard-cheat-sheet-modal');
            const body = modal?.querySelector('.modal-body');
            if (body instanceof HTMLElement) {
                body.scrollTop = 0;
            }
        });

        // Move focus off the input so PageDown scrolls the modal body.
        await page.keyboard.press('Tab');
        await expect.poll(async () => page.evaluate(() => {
            const modal = document.querySelector('#app-modal.show .keyboard-cheat-sheet-modal');
            const active = document.activeElement;
            return Boolean(modal && active instanceof Element && modal.contains(active));
        })).toBe(true);

        const scrolled = await page.evaluate(async () => {
            const modal = document.querySelector('#app-modal.show .keyboard-cheat-sheet-modal');
            const body = modal?.querySelector('.modal-body');
            if (!(body instanceof HTMLElement)) {
                return false;
            }
            const before = body.scrollTop;
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageDown', bubbles: true, cancelable: true }));
            await new Promise((resolve) => setTimeout(resolve, 260));
            return body.scrollTop > before;
        });
        expect(scrolled).toBe(true);

        // Tab stays trapped inside the modal.
        for (let i = 0; i < 8; i += 1) {
            await page.keyboard.press('Tab');
            await expect.poll(async () => page.evaluate(() => {
                const modal = document.getElementById('app-modal');
                const active = document.activeElement;
                return Boolean(modal?.classList.contains('show') && active instanceof Element && modal.contains(active));
            })).toBe(true);
        }
    });

    test('cheat sheet toggles focused section with Space', async ({ page }) => {
        await closeDashboardOverlays(page);
        await page.keyboard.press('!');
        await expect(page.locator('#app-modal.show .keyboard-cheat-sheet-modal')).toBeVisible({ timeout: 5000 });
        await page.evaluate(() => {
            window.DashboardFeaturePromos?.dismissOpen?.();
        });

        const state = await page.evaluate(() => {
            const groups = Array.from(document.querySelectorAll(
                '#app-modal.show .keyboard-cheat-sheet-modal details.cheat-sheet-group'
            ));
            if (groups.length < 2) {
                return { ok: false };
            }
            const target = groups[1];
            const summary = target.querySelector('.cheat-sheet-group-title');
            if (!(summary instanceof HTMLElement)) {
                return { ok: false };
            }
            summary.focus({ preventScroll: true });
            const before = target.open;
            document.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }));
            const afterFirst = target.open;
            document.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }));
            const afterSecond = target.open;
            return { ok: true, before, afterFirst, afterSecond };
        });

        expect(state.ok).toBe(true);
        expect(state.afterFirst).toBe(!state.before);
        expect(state.afterSecond).toBe(state.before);
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
        await expect(page.locator('#app-modal.show .page-overview-modal')).toBeVisible({ timeout: 5000 });
        await expect(page.locator('.page-overview-modal-item.is-focused .page-overview-modal-link')).toBeVisible({ timeout: 10_000 });
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
