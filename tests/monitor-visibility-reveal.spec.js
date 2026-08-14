// @ts-check
const { test, expect } = require('@playwright/test');
const { dismissOnboardingIfPresent, dismissBlockingOverlays, markWhatsNewSeen, resetDashboardData } = require('./e2e-helpers');

/**
 * Monitored bookmarks on the dashboard, and the way back into the Health view.
 *
 * Availability checking is one three-state choice stored as two mutually
 * exclusive flags, so a monitored bookmark has `checkStatus === false`. The row
 * renderer used to test that flag alone, which meant Monitor — the heavier of
 * the two modes, chosen for the handful of services you actually care about —
 * rendered with no status at all while Periodic showed one. These tests pin the
 * three ways that can regress: the flag test itself, the fingerprint that
 * decides whether the row is redrawn, and the setting that says how loud the
 * result should be.
 */

async function load(page) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
}

/** Put one bookmark into a mode through the same path the UI uses. */
async function setMode(page, index, mode) {
    const url = await page.evaluate(async ({ i, m }) => {
        const d = window.dashboardInstance;
        const b = d.bookmarks[i];
        await window.CheckMode.apply({
            pageId: Number(d.currentPageId), index: i, url: b.url, mode: m, name: b.name,
        });
        window.CheckMode.syncLocalCopies({ pageId: Number(d.currentPageId), url: b.url, mode: m });
        d.renderDashboard({ animate: false });
        return b.url;
    }, { i: index, m: mode });
    await page.waitForTimeout(1200);
    return url;
}

// Once for the file, not per test: this spec counts rows and indexes into the
// bookmark list, so what an earlier *file* left behind changes its answers —
// but several of its own tests build on state a previous one set up, which a
// per-test reset would wipe.
test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance != null, null, { timeout: 15_000 });
    await resetDashboardData(page);
    await page.close();
});

test.describe('monitored bookmarks on the dashboard', () => {
    test('a monitored bookmark gets a status, like a periodic one', async ({ page }) => {
        await load(page);
        const url = await setMode(page, 0, 'monitor');
        const row = page.locator(`.bookmark-link[data-bookmark-url="${url}"]`).first();

        // The gate itself: restoreBookmarkRowStatus is what refused to hand a
        // monitored row to the status monitor, so it is asked directly with a
        // spy in place. Waiting on a real ping would instead make this depend
        // on whether the bookmark's host answered in time.
        const offered = await page.evaluate((u) => {
            const d = window.dashboardInstance;
            const el = document.querySelector(`.bookmark-link[data-bookmark-url="${CSS.escape(u)}"]`);
            const bookmark = d.bookmarks.find((b) => b.url === u);
            const calls = [];
            const sm = d.statusMonitor;
            const realSet = sm.setBookmarkStatus.bind(sm);
            const realRefresh = sm.refreshBookmarkStatus.bind(sm);
            sm.setBookmarkStatus = (...args) => { calls.push('set'); return realSet(...args); };
            sm.refreshBookmarkStatus = (...args) => { calls.push('refresh'); return realRefresh(...args); };
            try {
                d.bookmarkRows.restoreBookmarkRowStatus(el, bookmark);
            } finally {
                sm.setBookmarkStatus = realSet;
                sm.refreshBookmarkStatus = realRefresh;
            }
            return calls;
        }, url);
        expect(offered.length).toBeGreaterThan(0);

        await expect(row).toHaveAttribute('data-check-mode', 'monitor');
    });

    /**
     * The incremental renderer reuses a row untouched when its stored
     * `data-render-fp` still matches (dashboard-render-incremental.js), so a
     * change the fingerprint cannot see never reaches the screen.
     *
     * Asserted on the fingerprint itself rather than through a re-render: a
     * full `renderDashboard()` rebuilds every row regardless, which is exactly
     * why this gap survived — the mode change was visible on the path the old
     * test would have taken, and invisible on the path the app actually uses.
     */
    test('the render fingerprint distinguishes all three check modes', async ({ page }) => {
        await load(page);
        const prints = await page.evaluate(() => {
            const d = window.dashboardInstance;
            const b = { ...d.bookmarks[0] };
            const fp = (mode) => d.bookmarkRows.bookmarkRenderFingerprint(
                window.CheckMode.assign({ ...b }, mode));
            return { off: fp('off'), periodic: fp('periodic'), monitor: fp('monitor') };
        });
        // Periodic → Monitor clears `checkStatus` and sets `monitor`, so a
        // fingerprint reading `checkStatus` alone collapsed monitor onto off.
        expect(new Set(Object.values(prints)).size).toBe(3);
        expect(prints.monitor).not.toBe(prints.off);
    });

    test('switching Periodic to Monitor updates the row marking', async ({ page }) => {
        await load(page);
        const url = await setMode(page, 0, 'periodic');
        const row = page.locator(`.bookmark-link[data-bookmark-url="${url}"]`).first();
        await expect(row).not.toHaveAttribute('data-check-mode', 'monitor');

        await setMode(page, 0, 'monitor');
        await expect(row).toHaveAttribute('data-check-mode', 'monitor');
    });

    test('a bookmark with checking off carries no monitor marking', async ({ page }) => {
        await load(page);
        const url = await setMode(page, 0, 'off');
        const row = page.locator(`.bookmark-link[data-bookmark-url="${url}"]`).first();
        await expect(row).not.toHaveAttribute('data-check-mode', 'monitor');
    });
});

test.describe('monitor emphasis setting', () => {
    /**
     * A fresh install gets 'problems'. Asserted against the server's own
     * defaulting rather than whatever this shared test dashboard was last left
     * on: the sibling test below deliberately saves 'always', so reading the
     * stored value here would only report which test ran first.
     */
    test('an unset value defaults to problems and reaches the body', async ({ page }) => {
        await load(page);
        const stored = await page.evaluate(async () => {
            const res = await fetch('/api/settings');
            const s = res.ok ? await res.json() : {};
            return s.monitorEmphasis;
        });
        // The server fills the field in on read, so it is never absent or
        // invalid by the time a browser sees it.
        expect(['problems', 'always', 'never']).toContain(stored);

        await page.evaluate(async () => {
            const d = window.dashboardInstance;
            d.settings.monitorEmphasis = 'problems';
            await d.saveSettings?.();
            d.setupDOM?.();
        });
        await expect(page.locator('body')).toHaveAttribute('data-monitor-emphasis', 'problems');
    });

    test('the three choices apply live and survive a reload', async ({ page }) => {
        await load(page);
        await page.evaluate(() => window.dashboardInstance.config.openConfigView('behavior'));
        await page.waitForFunction(() =>
            typeof window.dashboardInstance.config.behaviorSchema === 'function', null, { timeout: 15_000 });
        await page.evaluate(() => {
            const c = window.dashboardInstance.config;
            c.behaviorTab = 'status';
            c.render?.();
        });

        const cards = page.locator('[data-behavior-field="monitorEmphasis"]');
        await expect(cards).toHaveCount(3);
        // Rendered as readable copy, not locale keys.
        await expect(cards.first()).not.toContainText('config.monitorEmphasis');

        await page.locator('[data-behavior-field="monitorEmphasis"][data-behavior-value="always"]').click();

        // Live: the setting is body-attribute only, so it needs the chrome
        // handler — `render` alone redraws rows without rewriting <body>.
        await expect(page.locator('body')).toHaveAttribute('data-monitor-emphasis', 'always');
        await expect(page.locator('[data-behavior-field="monitorEmphasis"][data-behavior-value="always"]'))
            .toHaveAttribute('aria-checked', 'true');

        // And the server accepted the value rather than rejecting the save.
        await page.reload();
        await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
        await expect(page.locator('body')).toHaveAttribute('data-monitor-emphasis', 'always');
    });

    test('"never" suppresses the outage colouring too', async ({ page }) => {
        await load(page);
        const url = await setMode(page, 0, 'monitor');
        await page.evaluate(() => {
            window.dashboardInstance.settings.monitorEmphasis = 'never';
            window.dashboardInstance.setupDOM?.();
        });
        // Force the loudest state the other modes would show.
        await page.evaluate((u) => {
            document.querySelector(`.bookmark-link[data-bookmark-url="${u}"]`)
                ?.classList.add('status-offline');
        }, url);

        const shadow = await page.locator(`.bookmark-link[data-bookmark-url="${url}"]`).first()
            .evaluate((el) => getComputedStyle(el).boxShadow);
        // "Never stand out" that still turned a row red would not be never.
        expect(shadow === 'none' || shadow === '').toBe(true);
    });
});

test.describe('the overview announces the feature', () => {
    test('it is in the New features carousel and its CTA opens Status & health', async ({ page }) => {
        await load(page);
        await page.evaluate(() => window.dashboardInstance.config.openConfigView('overview'));

        const spotlight = page.locator('.config-feature-spotlight');
        await expect(spotlight).toBeVisible();

        // The carousel is newest-first, so this feature stops leading it the moment
        // a later release adds one. Step to its own slide rather than asserting a
        // position: what matters is that the entry is still there and still points
        // at the right setting, not that it happens to be first this month.
        const index = await page.evaluate(() => window.dashboardInstance.config
            .overviewNewFeatures()
            .findIndex((f) => f.titleKey === 'config.overviewNewFeatureMonitorEmphasisTitle'));
        expect(index, 'the monitor spotlight is still in the catalog').toBeGreaterThanOrEqual(0);

        await page.evaluate((target) => {
            const config = window.dashboardInstance.config;
            config.overviewFeatureIndex = target;
            config.repaintOverviewNewFeatures();
        }, index);

        await expect(spotlight.locator('.config-feature-spotlight-title'))
            .toHaveText(/monitored|gemonitorde|überwachte|surveillés/i);
        // Real copy in every locale, not a bare key.
        await expect(spotlight).not.toContainText('config.overviewNewFeature');

        await spotlight.locator('[data-overview-go]').click();

        // Behavior has no switchAppearanceTab equivalent, so landing on the
        // right sub-tab is its own step rather than a side effect of the
        // section change.
        await expect.poll(() => page.evaluate(() =>
            window.dashboardInstance.config.section), { timeout: 5000 }).toBe('behavior');
        await expect.poll(() => page.evaluate(() =>
            window.dashboardInstance.config.behaviorTab)).toBe('status');
        // And the setting it promises is actually on screen.
        await expect(page.locator('[data-behavior-field="monitorEmphasis"]')).toHaveCount(3);
    });
});

test.describe('the new setting is marked as new', () => {
    test('the Status tab and the monitor panel twinkle, and nothing else does', async ({ page }) => {
        await load(page);
        await page.evaluate(() => window.dashboardInstance.config.openConfigView('behavior'));
        await page.waitForFunction(() =>
            typeof window.dashboardInstance.config.behaviorSchema === 'function', null, { timeout: 15_000 });
        await page.evaluate(() => {
            const c = window.dashboardInstance.config;
            c.behaviorTab = 'status';
            c.render?.();
        });

        // Same keyframes as the overview's New features panel — one mark, not
        // three inventions.
        const tab = page.locator('[data-behavior-tab="status"]');
        await expect(tab).toHaveClass(/config-subtab--animated/);
        expect(await tab.evaluate((el) => getComputedStyle(el).animationName))
            .toBe('config-new-features-panel-glow');
        // The label still reads normally with the stars alongside it.
        await expect(tab).toContainText(/status/i);

        // Exactly one panel is marked, and it is the right one.
        const panel = page.locator('.config-panel--animated');
        await expect(panel).toHaveCount(1);
        await expect(panel.locator('[data-behavior-field="monitorEmphasis"]')).toHaveCount(3);
        expect(await panel.locator('.config-new-features-panel-star').first()
            .evaluate((el) => getComputedStyle(el).animationName))
            .toBe('config-new-features-panel-star-twinkle');

        // The mark means "new", so it must not spread to every tab.
        expect(await page.locator('[data-behavior-tab="general"]')
            .evaluate((el) => getComputedStyle(el).animationName)).toBe('none');
    });
});

test.describe('reaching the Health view from a bookmark', () => {
    test('the dashboard right-click menu opens the row in Health', async ({ page }) => {
        await load(page);
        const url = await setMode(page, 0, 'monitor');

        // Read the key off the row being clicked rather than assuming index 0:
        // earlier specs in this file reorder the page, so the bookmark set up
        // by setMode is not necessarily the first one any more.
        // Not .first(): the same bookmark also renders inside the "Today" smart
        // collection, and a collection row carries no meaningful page-local
        // index — clicking it opens a different bookmark than the one asserted.
        const row = page.locator(
            `[data-category-id]:not([data-category-id^="__smart"]) .bookmark-link[data-bookmark-url="${url}"]`
        ).first();
        const key = await row.evaluate((el) =>
            `${window.dashboardInstance.currentPageId}:${el.getAttribute('data-bookmark-index')}`);

        await row.click({ button: 'right' });
        const menu = page.locator('#bookmark-context-menu');
        await expect(menu).toBeVisible();
        await menu.locator('[data-action="health"]').click();

        // Landed on the right row. focusIssue widens the filter by itself, so
        // the row is reachable even though the default filter is `broken` and
        // a healthy monitor is not in it.
        await expect.poll(() => page.evaluate(() =>
            window.dashboardInstance.health?.instance?.selectedKey), { timeout: 10_000 }).toBe(key);
        await expect(page.locator(`.health-view-item[data-health-key="${key}"]`)).toHaveCount(1);
    });

    /**
     * The entry is offered whatever the bookmark's mode is.
     *
     * It was first restricted to checked bookmarks, on the assumption that an
     * unchecked one has nothing to show there. That was wrong: the health
     * report covers the whole library — an unchecked bookmark has a row, and
     * the `unchecked` filter and tile exist to find it — and that row is where
     * checking gets turned on. The restriction hid the destination from the
     * bookmarks that most needed it.
     */
    test('a bookmark with checking off is still offered the entry', async ({ page }) => {
        await load(page);
        const url = await setMode(page, 0, 'off');

        // Key read off the row, not assumed to be index 0 — earlier specs in
        // this file reorder the page.
        // Not .first(): the same bookmark also renders inside the "Today" smart
        // collection, and a collection row carries no meaningful page-local
        // index — clicking it opens a different bookmark than the one asserted.
        const row = page.locator(
            `[data-category-id]:not([data-category-id^="__smart"]) .bookmark-link[data-bookmark-url="${url}"]`
        ).first();
        const key = await row.evaluate((el) =>
            `${window.dashboardInstance.currentPageId}:${el.getAttribute('data-bookmark-index')}`);

        await row.click({ button: 'right' });
        const menu = page.locator('#bookmark-context-menu');
        await expect(menu).toBeVisible();
        await menu.locator('[data-action="health"]').click();

        await expect.poll(() => page.evaluate(() =>
            window.dashboardInstance.health?.instance?.selectedKey), { timeout: 10_000 }).toBe(key);
        // Really on screen, not just selected in memory.
        await expect(page.locator(`.health-view-item[data-health-key="${key}"]`)).toHaveCount(1);
    });

    /**
     * A smart-collection row is rendered from `allBookmarks` and carries no
     * page-local index, so the key has to be resolved rather than read off the
     * row. Getting this wrong opens a different bookmark than the one that was
     * right-clicked, which looks like it worked.
     */
    test('a smart-collection row opens its own bookmark, not the row beneath it', async ({ page }) => {
        await load(page);
        const row = page.locator('[data-smart-collection="true"] .bookmark-link').first();
        test.skip(await row.count() === 0, 'no smart collection on screen');
        const url = await row.getAttribute('data-bookmark-url');

        await row.click({ button: 'right' });
        await page.locator('#bookmark-context-menu [data-action="health"]').click();
        // Park the cursor clear of the feed: the row list scrolls under it, and
        // a stationary pointer over a moving list selects whatever lands there.
        await page.mouse.move(5, 5);

        await expect.poll(async () => page.evaluate(() => {
            const mod = window.dashboardInstance.health?.instance;
            const key = mod?.selectedKey;
            if (!key) return null;
            return (mod.report?.issues || []).find((i) => `${i.pageId}:${i.index}` === key)?.url ?? null;
        }), { timeout: 10_000 }).toBe(url);
    });

    /**
     * The `remote` branch of revealInHealth: a reference with a page id but no
     * page-local index, which is what a cross-page row resolves to. Its index
     * has to come from the server, because the row's position in the rendered
     * list is not its position on its own page.
     *
     * Driven through revealInHealth directly — the seeded dashboard renders its
     * smart collections from the current page, so no row on screen produces
     * this shape, and a test that only right-clicks would leave the branch
     * unexercised while appearing to cover it.
     */
    test('a reference without a page-local index resolves it from the server', async ({ page }) => {
        await load(page);
        const url = await page.evaluate(() => window.dashboardInstance.bookmarks[2].url);

        await page.evaluate(async (u) => {
            const d = window.dashboardInstance;
            await d.contextMenu.revealInHealth({
                scope: 'remote',
                pageId: Number(d.currentPageId),
                bookmark: { url: u },
            });
        }, url);
        await page.mouse.move(5, 5);

        await expect.poll(async () => page.evaluate(() => {
            const mod = window.dashboardInstance.health?.instance;
            const key = mod?.selectedKey;
            if (!key) return null;
            return (mod.report?.issues || []).find((i) => `${i.pageId}:${i.index}` === key)?.url ?? null;
        }), { timeout: 10_000 }).toBe(url);
    });

    test('the config bookmark list opens the row in Health', async ({ page }) => {
        await load(page);
        await page.evaluate(() => window.dashboardInstance.config.openConfigView('bookmarks'));
        await page.locator('#config-bm-list .config-bm-row').first().waitFor();

        const row = page.locator('#config-bm-list .config-bm-row').first();
        const key = await row.getAttribute('data-bm-key');
        // The actions bar is revealed on hover, so the menu can exist while its
        // container is still collapsed — hover first, the way a person would.
        await row.hover();
        await page.evaluate((k) => window.dashboardInstance.config.toggleBookmarkMenu(k, 'more'), key);

        const item = page.locator(`[data-menu-for="${key}"] [data-bm-menu-action="health"]`);
        await expect(item).toBeVisible();
        await item.click();

        await expect.poll(() => page.evaluate(() =>
            window.dashboardInstance.health?.instance?.selectedKey), { timeout: 10_000 }).toBeTruthy();
    });
});
