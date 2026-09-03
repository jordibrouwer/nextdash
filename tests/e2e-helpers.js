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
/**
 * Where the GitHub stars importer looks for its API.
 *
 * Pointed at a stub the stars spec starts, so that one spec can drive the whole
 * path -- browser, server, importer -- without a token and without reaching
 * GitHub. Harmless for every other spec: nothing reads this unless a source of
 * that kind is configured, and none of them configure one.
 */
const GITHUB_STUB_PORT = 18077;

/** Same idea for Raindrop's API. */
const RAINDROP_STUB_PORT = 18076;

const E2E_WEB_SERVER_ENV = {
    NEXTDASH_WRITE_TOKEN: WRITE_TOKEN,
    NEXTDASH_DISABLE_PREFETCH: '1',
    NEXTDASH_GITHUB_API_BASE: `http://127.0.0.1:${GITHUB_STUB_PORT}`,
    NEXTDASH_RAINDROP_API_BASE: `http://127.0.0.1:${RAINDROP_STUB_PORT}`,
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
            // The one-time "Shift + Q switches the search mode" note is keyed
            // to the release the same way, and every test starts on empty
            // storage — so it is the first load for all of them. It landed in
            // the notification slot mid-test and was read by anything waiting
            // on a toast: health-copy-share, dashboard-check-mode-menu,
            // health-check-mode and dashboard-retry-label each found it instead
            // of their own message.
            localStorage.setItem('nextdash:search-mode-key-announced', rel);
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
 * The same, for the one-time Widgets tour. Config → Widgets checks the tip
 * before it fetches the tour at all, so marking it here keeps the modal out of
 * every spec that only wants the widgets panel. The tour's own spec puts it
 * back to unseen.
 * @param {import('@playwright/test').Page} page
 */
async function markWidgetsTutorialSeen(page) {
    // Persisted, unlike the other two: specs that open Config → Widgets usually
    // write some blocks and reload first, and an in-memory marker does not
    // survive that — the tour would then open over the panel the spec is about
    // to click. The tour's own spec puts the tip back to unseen for itself.
    await page.evaluate(async () => {
        window.DiscoverabilityState?.markTipSeen?.('widgetsTutorialV1');
        await window.DiscoverabilityState?.persistNow?.();
    });
}

/**
 * Mark every registered config setting promo as seen.
 *
 * The promos are scheduled 500ms after a config section opens and are placed
 * over the control they point at, so a test that opens a section and reaches
 * for a nearby button is racing them: whichever arrives second wins. Only
 * config-setting-promo.spec.js is about the popovers themselves; everywhere
 * else they are furniture in the way. Call this after the page is loaded and
 * before opening the section -- the registry lives in the page, so the ids do
 * not have to be repeated here and a promo added later is covered too.
 *
 * @param {import('@playwright/test').Page} page
 */
async function markConfigSettingPromosSeen(page) {
    await page.evaluate(() => {
        const promo = window.ConfigSettingPromo;
        if (!promo) return;
        (promo._registry || []).forEach((p) => promo.markSeen?.(p.id));
        promo.dismissActive?.({ persist: true });
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
    await markWidgetsTutorialSeen(page);
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
    await waitForFaviconPrefetch(page);
}

/**
 * Wait out the favicon prefetch, which covers the screen while it runs.
 *
 * A fresh install fetches icons for its starter bookmarks, and that progress
 * panel is `position: fixed; inset: 0; z-index: 12000` — deliberately
 * blocking, because clicking through a batch write is not something to invite.
 * It is not a promo to be dismissed: it goes when the work is done.
 *
 * Anything driving the real mouse hits it rather than the control underneath.
 * dashboard-shortcut-tooltips hovered #search-button and read no popover, and
 * the failure named #finders-button — the last selector its loop had reached —
 * so the report pointed at the wrong control on the wrong screen.
 *
 * @param {import('@playwright/test').Page} page
 */
async function waitForFaviconPrefetch(page) {
    // Polled rather than waited on as a locator: the overlay is created once
    // and toggled with [hidden], so a `:not([hidden])` locator matches nothing
    // in the gaps and a waitFor returns at once — right before it comes back.
    await page.waitForFunction(() => {
        const blocking = [...document.querySelectorAll('#favicon-prefetch-overlay, .progress-overlay')]
            .some((el) => !el.hasAttribute('hidden') && getComputedStyle(el).display !== 'none');
        return !blocking;
    }, null, { timeout: 20_000 }).catch(() => {});

    // And the reload that follows it. fetchAllFaviconsAfterSetup runs unawaited
    // 400ms after setup and ends in loadData() + renderDashboard(), so the rows
    // are rebuilt from the server after the overlay has gone and the dashboard
    // looks settled. A spec that writes onto a bookmark in that window — a seeded
    // open count, a check mode — loses the write to the fresh copy and then reads
    // a row it never seeded. The flag is false only while that is in flight, so
    // an install that never ran setup falls straight through.
    await page.waitForFunction(
        () => window.nextdashSetupFaviconsDone !== false,
        null, { timeout: 20_000 },
    ).catch(() => {});
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

/**
 * Open the inbox toolbar's ⋯ menu, where the rarely-used actions live.
 *
 * Mark read, Clear read, CSV, JSON, Import and Stats moved off the toolbar so
 * the header stops standing between the heading and the first row. A test that
 * clicks one of them has to open the menu first, the way a user does.
 * Safe to call twice: an already-open menu is left open.
 */
async function openInboxToolbarMenu(page) {
    const menu = page.locator('[data-inbox-menu]');
    if (await menu.isVisible().catch(() => false)) {
        return menu;
    }
    await page.locator('[data-inbox-toolbar-more]').click();
    await menu.waitFor({ state: 'visible' });
    return menu;
}

/**
 * Open the health view's toolbar overflow menu, returning the menu locator.
 *
 * d4e22e33 kept the toolbar's everyday buttons and filed the rest behind `⋯`:
 * Export rows, the history export, Open broken, Merge duplicates, Fetch
 * previews, Retest all and Check off all moved into a menu that renders
 * `hidden`. A test that clicks one of them has to open the menu first, the way
 * a user does — the same move openInboxToolbarMenu makes for the inbox.
 * Safe to call twice: an already-open menu is left open.
 */
async function openHealthToolbarMenu(page) {
    const menu = page.locator('.health-view-menu--toolbar[data-menu-for="toolbar"]');
    if (await menu.isVisible().catch(() => false)) {
        return menu;
    }
    await page.locator('[data-health-toolbar-more]').click();
    await menu.waitFor({ state: 'visible' });
    return menu;
}

module.exports = {
    GITHUB_STUB_PORT,
    RAINDROP_STUB_PORT,
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
    markWidgetsTutorialSeen,
    dismissBlockingOverlays,
    markConfigSettingPromosSeen,
    prepareDashboardInteraction,
    dismissOnboardingIfPresent,
    ensurePageCategory,
    ensureSortableCategory,
    ensureBookmarksDashboardView,
    openShortcutSearch,
    tapShortcutLetter,
    selectKeyboardBookmark,
    openInboxToolbarMenu,
    openHealthToolbarMenu,
    waitForFaviconPrefetch,
};
