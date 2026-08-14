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
    'nextdash:inbox-intro-modal-v1',
    'nextdash:inbox-intro-modal-v2',
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
    // Mark the running release as seen first. Closing the modal does not record
    // it, so on a release the browser has not seen — every time the cache token
    // is bumped — it simply reopens a second or two later and marks the grid
    // inert again, mid-test.
    await page.evaluate(() => {
        const release = window.NEXTDASH_WHATS_NEW_RELEASE;
        if (release) {
            try {
                localStorage.setItem('nextdash:last-whats-new-dashboard-release', release);
            } catch { /* storage unavailable — modal may reopen, nothing else to do */ }
        }
    });
    const modal = page.locator('#app-modal.show');
    if (await modal.count()) {
        await page.keyboard.press('Escape');
        await expect(modal).toHaveCount(0, { timeout: 5000 });
    }
}

/**
 * Mark the one-time Health tutorial as seen so opening the Health view in a
 * test does not pop the modal mid-flow. Written straight into
 * DiscoverabilityState rather than relying on a later save: the tutorial
 * checks hasSeenTip() synchronously the instant openHealthView() finishes
 * rendering, before any test would have a chance to dismiss it first.
 * @param {import('@playwright/test').Page} page
 */
async function markHealthTutorialSeen(page) {
    await page.evaluate(() => {
        window.DiscoverabilityState?.markTipSeen?.('healthTutorialV1', { persist: false });
    });
}

/**
 * The same, for the one-time Inbox tutorial. openInboxView() checks the tip
 * before it even fetches the tour's script, so marking it here is enough to
 * keep the modal out of every spec that only wants the inbox list.
 * @param {import('@playwright/test').Page} page
 */
async function markInboxTutorialSeen(page) {
    await page.evaluate(() => {
        window.DiscoverabilityState?.markTipSeen?.('inboxTutorialV1', { persist: false });
    });
}

/**
 * Dismiss What's new, search promo, and grid keyboard promo when they block interaction.
 * @param {import('@playwright/test').Page} page
 */
async function dismissBlockingOverlays(page) {
    await dismissWhatsNewIfPresent(page);
    await dismissAppNotificationIfPresent(page);
    await suppressStatusEmptyHint(page);
    await markHealthTutorialSeen(page);
    await markInboxTutorialSeen(page);
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
        // type('>') sends key '>' like a real keyboard. press('Shift+.') sends key '.'
        // with shiftKey — a combination no keyboard produces — which triggers the
        // collapse-all shortcut ('.') and leaves every category collapsed, so the
        // keyboard grid has nothing left to navigate afterwards.
        await page.keyboard.type('>');
    }
    await expect.poll(async () => page.evaluate((wantedPrefix) => {
        const search = document.getElementById('shortcut-search');
        const sc = window.dashboardInstance?.searchComponent;
        if (!search?.classList.contains('show')) {
            sc?.openSearchInterface?.();
            const query = String(sc?.currentQuery || '');
            if (wantedPrefix === ':' && !query.startsWith(':')) {
                const selected = window.dashboardInstance?.keyboardNavigation?.getSelectedBookmark?.();
                if (selected) {
                    sc.commandsComponent.contextBookmark = selected;
                    sc.commandsComponent.expandedGroups?.add?.('bookmarks');
                }
                sc?.addToQuery?.(':');
            }
        }
        return search?.classList.contains('show') === true;
    }, prefix), { timeout: 8000 }).toBe(true);
}

/**
 * Select a bookmark row in dashboard keyboard navigation.
 * @param {import('@playwright/test').Page} page
 * @param {{ urlEquals?: string, nameEquals?: string, urlIncludes?: string, nameIncludes?: string }} [options]
 */
async function selectKeyboardBookmark(page, options = {}) {
    const picked = await page.evaluate(({ urlEquals, nameEquals, urlIncludes, nameIncludes }) => {
        const kn = window.dashboardInstance?.keyboardNavigation;
        if (!kn) {
            throw new Error('keyboard navigation unavailable');
        }
        kn.updateNavigableElements?.();
        const rows = kn.navigableElements || [];
        const normalizedUrlEquals = String(urlEquals || '').trim().toLowerCase();
        const normalizedNameEquals = String(nameEquals || '').trim().toLowerCase();
        const normalizedUrlNeedle = String(urlIncludes || '').trim().toLowerCase();
        const normalizedNameNeedle = String(nameIncludes || '').trim().toLowerCase();

        let idx = rows.findIndex((row) => {
            const url = String(row.getAttribute('data-bookmark-url') || '').trim().toLowerCase();
            const name = row.querySelector('.bookmark-text')?.textContent?.trim().toLowerCase() || '';
            if (normalizedUrlEquals && url === normalizedUrlEquals) {
                return true;
            }
            if (normalizedNameEquals && name === normalizedNameEquals) {
                return true;
            }
            if (normalizedUrlNeedle && url.includes(normalizedUrlNeedle)) {
                if (normalizedNameNeedle && !name.includes(normalizedNameNeedle)) {
                    return false;
                }
                return true;
            }
            if (normalizedNameNeedle && name.includes(normalizedNameNeedle)) {
                return true;
            }
            return false;
        });

        if (idx < 0) {
            idx = rows.findIndex((row) => {
                const name = row.querySelector('.bookmark-text')?.textContent?.trim() || '';
                return name.length > 0;
            });
        }
        if (idx < 0) {
            return false;
        }

        kn.currentIndex = idx;
        kn.highlightCurrentElement?.({ keyboardNav: true });
        const bookmark = kn.getSelectedBookmark?.();
        return {
            index: idx,
            url: bookmark?.url || rows[idx]?.getAttribute('data-bookmark-url') || '',
            name: bookmark?.name || rows[idx]?.querySelector('.bookmark-text')?.textContent?.trim() || '',
        };
    }, {
        urlEquals: options.urlEquals || '',
        nameEquals: options.nameEquals || 'GitHub',
        urlIncludes: options.urlIncludes || '',
        nameIncludes: options.nameIncludes || '',
    });
    expect(picked).toBeTruthy();
    expect(picked.index).toBeGreaterThanOrEqual(0);
    await expect.poll(async () => page.evaluate(() => (
        window.dashboardInstance?.keyboardNavigation?.getSelectedBookmark?.()?.url || ''
    ))).not.toBe('');
}

/**
 * Quick-tap a letter shortcut (e.g. G) to open shortcut search with that prefix.
 * @param {import('@playwright/test').Page} page
 * @param {string} letter
 */
async function tapShortcutLetter(page, letter) {
    const expected = String(letter || '').toUpperCase();
    expect(expected).toMatch(/^[A-Z]$/);
    await ensureBookmarksDashboardView(page);
    await page.evaluate(() => {
        window.DashboardGridKeyboardPromo?.confirmPromo?.();
        document.body.focus();
    });
    await page.keyboard.press(expected.toLowerCase());
    await expect.poll(async () => page.evaluate((wanted) => {
        const search = document.getElementById('shortcut-search');
        if (!search?.classList.contains('show')) {
            return false;
        }
        const query = String(window.dashboardInstance?.searchComponent?.currentQuery || '').toUpperCase();
        return query.startsWith(wanted);
    }, expected), { timeout: 5000 }).toBe(true);
}

/**
 * Dismiss onboarding, promos, and toasts that steal clicks from dashboard tests.
 * @param {import('@playwright/test').Page} page
 */
async function prepareDashboardInteraction(page) {
    await dismissOnboardingIfPresent(page);
    await ensureBookmarksDashboardView(page);
    await dismissBlockingOverlays(page);
    await page.evaluate(() => {
        window.GuidedFlowGuard?.sync?.();
        document.body.classList.remove('guided-flow-locked');
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
    const legacy = page.locator('.onboarding-card');
    if (await legacy.count()) {
        await page.locator('.onboarding-skip').click();
        await legacy.waitFor({ state: 'hidden', timeout: 5000 });
    }

    const setup = page.locator('.quickstart-setup');
    if (await setup.count()) {
        await setup.locator('[data-qs-action="skip-setup"]').click();
        await setup.waitFor({ state: 'hidden', timeout: 5000 });
    }

    const checklist = page.locator('.quickstart-checklist');
    if (await checklist.count()) {
        await checklist.locator('[data-qs-action="dismiss"]').click();
        await checklist.waitFor({ state: 'hidden', timeout: 5000 });
    }

    await page.evaluate(() => {
        const d = window.dashboardInstance;
        if (!d) return;
        if (d.settings?.onboardingCompleted !== true) {
            d.settings.onboardingCompleted = true;
        }
        d.onboardingStartedInSession = false;
    });
}

/**
 * Wait until the config view can actually be driven from a test.
 *
 * `#dashboard-layout` is in the document well before the dashboard has finished
 * wiring itself up, and `dashboardInstance.config` is a lazy-loading stub until
 * it has — so a spec that waits on the element and then calls
 * `config.openConfigView()` reads `config` off an undefined instance. It only
 * bit the first test of a run, which is what made it look like a random flake
 * rather than a missing wait.
 */
async function waitForConfigReady(page) {
    await page.waitForFunction(
        () => typeof window.dashboardInstance?.config?.openConfigView === 'function',
        null,
        { timeout: 15_000 }
    );
}

/**
 * Put the data directory back to a fresh install.
 *
 * The suite shares one data directory across all 170 spec files with no reset
 * between them, so a spec that renames a category or deletes a bookmark changes
 * what every later spec sees. Most cope; the ones that count rows or index into
 * dashboardInstance.bookmarks do not, and they fail differently depending on
 * what ran before them.
 *
 * /api/reset re-seeds the defaults on the way out (ResetAllData calls
 * initializeDefaultFiles), so this restores the seven default bookmarks rather
 * than leaving an empty install — measured at well under 100ms, cheap enough
 * for a beforeEach in the specs that need it.
 *
 * Opt-in rather than global: a spec that is happy with whatever it finds should
 * not pay for a reset, and a few deliberately build on their own seeded state.
 */
async function resetDashboardData(page) {
    const result = await page.evaluate(async () => {
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        const res = await api('/api/reset', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ confirm: true }),
        });
        return { ok: res.ok, status: res.status };
    });
    if (!result.ok) {
        throw new Error(`resetDashboardData: /api/reset returned HTTP ${result.status}`);
    }
    return result;
}

module.exports = {
    resetDashboardData,
    WRITE_TOKEN,
    DASHBOARD_WHATS_NEW_RELEASE,
    DEFAULT_DISCOVERABILITY_KEYS,
    E2E_WEB_SERVER_ENV,
    waitForConfigReady,
    markWhatsNewSeen,
    dismissWhatsNewIfPresent,
    dismissAppNotificationIfPresent,
    suppressStatusEmptyHint,
    markHealthTutorialSeen,
    markInboxTutorialSeen,
    dismissBlockingOverlays,
    prepareDashboardInteraction,
    dismissOnboardingIfPresent,
    ensurePageCategory,
    ensureSortableCategory,
    ensureBookmarksDashboardView,
    openShortcutSearch,
    tapShortcutLetter,
    selectKeyboardBookmark,
};
