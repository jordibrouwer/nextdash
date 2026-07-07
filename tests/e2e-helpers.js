// @ts-check
/** Shared Playwright e2e settings (write token, webServer env). */

const fs = require('fs');
const path = require('path');
const { expect } = require('@playwright/test');

const WRITE_TOKEN = process.env.NEXTDASH_WRITE_TOKEN || 'playwright-e2e-write-token';

/** Matches `DASHBOARD_RELEASE` in static/js/whats-new-stub.js */
const DASHBOARD_WHATS_NEW_RELEASE = (() => {
    const stubPath = path.join(__dirname, '..', 'static', 'js', 'whats-new-stub.js');
    const src = fs.readFileSync(stubPath, 'utf8');
    const match = src.match(/const DASHBOARD_RELEASE = '([^']+)'/);
    if (!match) {
        throw new Error('Could not read DASHBOARD_RELEASE from whats-new-stub.js');
    }
    return match[1];
})();

/** Discoverability keys dismissed before navigation in most dashboard e2e runs. */
const DEFAULT_DISCOVERABILITY_KEYS = [
    'nextdash:inbox-intro-toast-v1',
];

/** Env vars for the Playwright-managed `go run .` server. */
const E2E_WEB_SERVER_ENV = {
    NEXTDASH_WRITE_TOKEN: WRITE_TOKEN,
    NEXTDASH_DISABLE_PREFETCH: '1',
    ...(process.env.NEXTDASH_DATA_DIR ? { NEXTDASH_DATA_DIR: process.env.NEXTDASH_DATA_DIR } : {}),
};

/**
 * Mark the current dashboard What's new release as seen before navigation.
 * @param {import('@playwright/test').Page} page
 * @param {{ confirmCheatsheetPromo?: boolean, extraPromoConfirmedKeys?: string[] }} [options]
 */
async function markWhatsNewSeen(page, options = {}) {
    const release = DASHBOARD_WHATS_NEW_RELEASE;
    const confirmCheatsheetPromo = options.confirmCheatsheetPromo === true;
    const extraPromoConfirmedKeys = Array.isArray(options.extraPromoConfirmedKeys)
        ? [...new Set([...DEFAULT_DISCOVERABILITY_KEYS, ...options.extraPromoConfirmedKeys])]
        : [...DEFAULT_DISCOVERABILITY_KEYS];
    await page.addInitScript(({ rel, confirmCheatsheet, extraKeys }) => {
        try {
            localStorage.setItem('nextdash:last-whats-new-dashboard-release', rel);
            localStorage.setItem('nextdash:whats-new-search-promo-release', rel);
            localStorage.setItem('nextdash:whats-new-search-promo-start', '0');
            if (confirmCheatsheet) {
                localStorage.setItem('nextdash:dashboard-cheatsheet-promo-confirmed-v1', '1');
            }
            extraKeys.forEach((key) => localStorage.setItem(key, '1'));
        } catch {
            // ignore
        }
    }, { rel: release, confirmCheatsheet: confirmCheatsheetPromo, extraKeys: extraPromoConfirmedKeys });
}

/** @param {import('@playwright/test').Page} page */
async function dismissAppNotificationIfPresent(page) {
    const toast = page.locator('#app-notification.show');
    if (await toast.count()) {
        await page.evaluate(() => window.AppNotification?.hide?.());
        await expect(toast).toHaveCount(0, { timeout: 5000 });
    }
}

/** @param {import('@playwright/test').Page} page */
async function suppressStatusEmptyHint(page) {
    await page.evaluate(() => {
        const monitor = window.dashboardInstance?.statusMonitor;
        if (monitor) {
            monitor.emptyStatusHintShown = true;
        }
    });
}

/** @param {import('@playwright/test').Page} page */
async function dismissWhatsNewIfPresent(page) {
    const modal = page.locator('#app-modal.show');
    if (await modal.count()) {
        await page.keyboard.press('Escape');
        await expect(modal).toHaveCount(0, { timeout: 5000 });
    }
}

/**
 * Dismiss What's new, search promo, and grid keyboard promo when they block interaction.
 * @param {import('@playwright/test').Page} page
 */
async function dismissBlockingOverlays(page) {
    await dismissWhatsNewIfPresent(page);
    await dismissAppNotificationIfPresent(page);
    await suppressStatusEmptyHint(page);
    const searchPromo = page.locator('.dashboard-search-promo');
    if (await searchPromo.count()) {
        await searchPromo.locator('button').first().click();
        await expect(searchPromo).toHaveCount(0, { timeout: 3000 });
    }
    const gridPromoClose = page.locator('.dashboard-grid-kbd-promo-close');
    if (await gridPromoClose.count()) {
        await page.evaluate(() => window.DashboardGridKeyboardPromo?.confirmPromo?.());
        await expect(page.locator('.dashboard-grid-kbd-promo')).toHaveCount(0, { timeout: 3000 });
    }
    await dismissAppNotificationIfPresent(page);
}

/** @param {import('@playwright/test').Page} page */
async function ensureBookmarksDashboardView(page) {
    await page.evaluate(() => {
        const dash = window.dashboardInstance;
        dash?.inbox?.closeInboxView?.();
        if (dash) {
            dash.activeView = 'bookmarks';
        }
        document.getElementById('dashboard-layout')?.classList.remove('inbox-layout');
        document.body.focus();
    });
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {{ prefix?: string }} [options]
 */
async function openShortcutSearch(page, options = {}) {
    const prefix = options.prefix || '';
    await ensureBookmarksDashboardView(page);
    await page.evaluate(() => {
        window.DashboardGridKeyboardPromo?.confirmPromo?.();
        document.body.focus();
    });
    if (prefix === ':') {
        await page.keyboard.press(':');
    } else if (prefix === '>') {
        await page.keyboard.press('Shift+.');
    }
    await expect.poll(async () => page.evaluate((wantedPrefix) => {
        const search = document.getElementById('shortcut-search');
        const sc = window.dashboardInstance?.searchComponent;
        if (!search?.classList.contains('show')) {
            sc?.openSearchInterface?.();
            if (wantedPrefix === ':') {
                sc?.addToQuery?.(':');
            }
        }
        return search?.classList.contains('show') === true;
    }, prefix), { timeout: 8000 }).toBe(true);
}

/**
 * Dismiss onboarding, promos, and toasts that steal clicks from dashboard tests.
 * @param {import('@playwright/test').Page} page
 */
async function prepareDashboardInteraction(page) {
    await dismissOnboardingIfPresent(page);
    await ensureBookmarksDashboardView(page);
    await dismissBlockingOverlays(page);
}

/** @param {import('@playwright/test').Page} page */
async function resetOnboarding(page) {
    await page.evaluate(async () => {
        localStorage.removeItem('nextDashOnboardingSeenV2');
        localStorage.removeItem('nextDashOnboardingVersionV2');
        const response = await fetch('/api/settings');
        if (!response.ok) return;
        const settings = await response.json();
        settings.onboardingCompleted = false;
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        await api('/api/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(settings),
        });
    });
}

/** @param {import('@playwright/test').Page} page */
async function openOnboarding(page) {
    await page.goto('/');
    await resetOnboarding(page);
    await page.reload();
    await page.waitForSelector('.onboarding-card', { timeout: 15_000 });
}

/**
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<{ current: number, total: number }>}
 */
async function getOnboardingProgress(page) {
    const text = await page.locator('.onboarding-progress').textContent();
    const match = text?.trim().match(/^(\d+)\/(\d+)$/);
    if (!match) {
        throw new Error(`Unexpected onboarding progress text: ${text}`);
    }
    return { current: Number(match[1]), total: Number(match[2]) };
}

/**
 * Click Next until the onboarding wizard reaches `targetStep` (1-based).
 * @param {import('@playwright/test').Page} page
 * @param {number} targetStep
 */
async function advanceOnboardingToStep(page, targetStep) {
    const progress = page.locator('.onboarding-progress');
    const next = page.locator('.onboarding-next');
    let { current, total } = await getOnboardingProgress(page);
    if (targetStep > total) {
        throw new Error(`Cannot advance to step ${targetStep}; onboarding has ${total} steps`);
    }
    while (current < targetStep) {
        await next.click();
        current += 1;
        await progress.waitFor({ state: 'visible' });
        await page.waitForFunction(
            (expected) => document.querySelector('.onboarding-progress')?.textContent?.trim() === expected,
            `${current}/${total}`,
        );
    }
}

/** @param {import('@playwright/test').Page} page */
async function dismissConfigTourOverlays(page) {
    await page.evaluate(() => {
        window.configManager?.dismissOtherConfigTabTours?.();
        [
            'ConfigGeneralTour',
            'ConfigFindersTour',
            'ConfigBookmarksTour',
            'ConfigCategoriesTour',
            'ConfigTagsTour',
            'ConfigPagesTour',
            'ConfigCollectionsTour',
            'ConfigThemeTour',
            'ConfigStatsTour',
        ].forEach((name) => window[name]?.teardownStaleDom?.());
    });
}

/**
 * Earlier config tests can replace the default category list; ensure a column exists.
 * @param {import('@playwright/test').Page} page
 * @param {string} categoryId
 * @param {string} [categoryName]
 */
async function ensurePageCategory(page, categoryId, categoryName = categoryId) {
    await page.evaluate(async ({ id, name }) => {
        const pageId = Number(window.dashboardInstance?.currentPageId) || 1;
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        const res = await api(`/api/categories?page=${pageId}`);
        let categories = res.ok ? await res.json() : [];
        if (!Array.isArray(categories)) {
            categories = [];
        }
        if (!categories.some((category) => category.id === id)) {
            categories.push({ id, name, icon: '' });
            await api(`/api/categories?page=${pageId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(categories),
            });
        }
    }, { id: categoryId, name: categoryName });
}

/**
 * Return a dashboard category id with at least two bookmarks, seeding one if needed.
 * @param {import('@playwright/test').Page} page
 */
async function ensureSortableCategory(page) {
    return page.evaluate(async () => {
        const pickFromDom = () => {
            for (const category of document.querySelectorAll('#dashboard-layout .category:not([data-smart-collection="true"])')) {
                const count = category.querySelectorAll('.bookmark-link .bookmark-text').length;
                if (count > 1) {
                    return category.getAttribute('data-category-id') || '';
                }
            }
            return '';
        };

        let categoryId = pickFromDom();
        if (categoryId) {
            return categoryId;
        }

        const pageId = Number(window.dashboardInstance?.currentPageId) || 1;
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        const catRes = await api(`/api/categories?page=${pageId}`);
        let categories = catRes.ok ? await catRes.json() : [];
        if (!Array.isArray(categories) || categories.length === 0) {
            categories = [{ id: 'sort-test', name: 'Sort Test', icon: '' }];
            await api(`/api/categories?page=${pageId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(categories),
            });
            categoryId = 'sort-test';
        } else {
            categoryId = String(categories[0]?.id || '').trim();
        }
        if (!categoryId) {
            return '';
        }

        const stamp = Date.now();
        const seeds = [
            { name: `Zebra ${stamp}`, url: `https://sort-test-z-${stamp}.example`, category: categoryId },
            { name: `Alpha ${stamp}`, url: `https://sort-test-a-${stamp}.example`, category: categoryId },
        ];
        for (const bookmark of seeds) {
            await api('/api/bookmarks', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ page: pageId, bookmark }),
            });
        }
        await window.dashboardInstance?.data?.refreshAfterBookmarkAdded?.(pageId);
        return pickFromDom() || categoryId;
    });
}

/** @param {import('@playwright/test').Page} page */
async function dismissOnboardingIfPresent(page) {
    const card = page.locator('.onboarding-card');
    if (await card.count()) {
        await page.locator('.onboarding-skip').click();
        await card.waitFor({ state: 'hidden', timeout: 5000 });
    }
}

module.exports = {
    WRITE_TOKEN,
    DASHBOARD_WHATS_NEW_RELEASE,
    DEFAULT_DISCOVERABILITY_KEYS,
    E2E_WEB_SERVER_ENV,
    markWhatsNewSeen,
    dismissWhatsNewIfPresent,
    dismissAppNotificationIfPresent,
    suppressStatusEmptyHint,
    dismissBlockingOverlays,
    prepareDashboardInteraction,
    resetOnboarding,
    openOnboarding,
    getOnboardingProgress,
    advanceOnboardingToStep,
    dismissOnboardingIfPresent,
    dismissConfigTourOverlays,
    ensurePageCategory,
    ensureSortableCategory,
    ensureBookmarksDashboardView,
    openShortcutSearch,
};
