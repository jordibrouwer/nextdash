// @ts-check
const { test, expect } = require('./fixtures');
const { dismissOnboardingIfPresent, dismissBlockingOverlays, markWhatsNewSeen, resetDashboardData, WRITE_TOKEN } = require('./e2e-helpers');

/**
 * Ignoring a bookmark's error from its tile.
 *
 * The report already stops counting an ignored failure; what these pin is the
 * tile itself, which used to stay red because it read lastError directly, and
 * the way back, which has to be as close as the way in.
 */
test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance != null, null, { timeout: 15_000 });
    await resetDashboardData(page);
    await page.close();
});

test('a tile turns plain when its error is ignored, and red again when reported again', async ({ page }) => {
    await page.request.post('/api/settings', { data: { showStatus: true }, headers: { 'X-NextDash-Token': WRITE_TOKEN } });
    // Every ping answers "down": a live check would otherwise decide the tile.
    await page.route('**/api/ping*', (route) => route.fulfill({
        json: { status: 'offline', ping: null, errorDetail: 'Timeout' },
    }));
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);

    // A failure on the first bookmark, on the page's own copy: the same state a
    // check leaves behind, without waiting on a host to be down.
    const url = await page.evaluate(() => {
        const d = window.dashboardInstance;
        // The row's own index, not 0: the menu reads d.bookmarks[index] of the
        // row it was opened on.
        const row = document.querySelector('.bookmarks-list[data-bookmarks-list="true"]:not([data-smart-collection="true"]) .bookmark-link[data-bookmark-index]');
        const index = Number(row.getAttribute('data-bookmark-index'));
        const b = d.bookmarks[index];
        window.__ignoreIndex = index;
        b.lastError = 'Timeout';
        return b.url;
    });
    // Checked for real, on the server, so the copies the ignore refreshes stay checked.
    await page.evaluate(async () => {
        const d = window.dashboardInstance;
        const i = window.__ignoreIndex;
        const b = d.bookmarks[i];
        await window.CheckMode.apply({ pageId: Number(d.currentPageId), index: i, url: b.url, mode: 'periodic', name: b.name });
        window.CheckMode.syncLocalCopies({ pageId: Number(d.currentPageId), url: b.url, mode: 'periodic' });
        d.bookmarks[i].lastError = 'Timeout';
        d.renderDashboard({ animate: false });
    });
    await expect(page.locator(`.bookmark-link[data-bookmark-url="${url}"]`).first()).toBeVisible();
    await page.evaluate(() => {
        const d = window.dashboardInstance;
        const b = d.bookmarks[window.__ignoreIndex];
        // The cached answer wins over the stored one, so it is set too: a live
        // check that came back down is the case the tile has to handle.
        d.statusMonitor.cacheStatusResult(b.url, {
            status: 'offline', ping: null, failStreak: 3, confirmed: true, errorDetail: 'Timeout',
        });
        d.statusMonitor.applyCachedStatuses(d.bookmarks);
    });
    // The category's own row: a smart collection can show the same bookmark
    // first, and status is never drawn there.
    const row = page.locator(
        `.bookmarks-list[data-bookmarks-list="true"]:not([data-smart-collection="true"]) .bookmark-link[data-bookmark-url="${url}"]`,
    ).first();
    await expect(row).toHaveClass(/status-offline/);

    // The dashboard swaps its bookmark objects for fresh ones now and then, and
    // the failure only lives on the page's copy here: put it back on the current
    // one right before the menu reads it.
    const failing = () => page.evaluate(() => {
        const b = window.dashboardInstance.bookmarks[window.__ignoreIndex];
        b.lastError = 'Timeout';
    });
    await failing();
    await row.click({ button: 'right' });
    await page.locator('#bookmark-context-menu [data-action="ignore-error"]').click();
    await expect(row).not.toHaveClass(/status-offline/);
    expect(await page.evaluate(() => window.dashboardInstance.bookmarks[window.__ignoreIndex].healthIgnored))
        .toEqual([{ flag: 'broken' }]);

    await failing();
    await row.click({ button: 'right' });
    await page.locator('#bookmark-context-menu [data-action="unignore-error"]').click();
    await expect(row).toHaveClass(/status-offline/);
});

test('the Bookmarks view panel says what is ignored and offers to report it again', async ({ page }) => {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.evaluate(() => window.dashboardInstance.config.openLibraryView());
    await page.waitForFunction(() => {
        const c = window.dashboardInstance.config;
        return Boolean(c._bmHealthModule && c.bmHealthIssue(window.dashboardInstance.bookmarks[0]));
    }, null, { timeout: 20_000 });

    // The report's own issue for the first bookmark, told it hides a broken
    // failure: the panel is drawn from exactly this object.
    const html = await page.evaluate(() => {
        const c = window.dashboardInstance.config;
        const b = window.dashboardInstance.bookmarks[0];
        const real = c.bmHealthIssue(b);
        c.bmHealthIssue = () => ({
            ...real,
            ignoredFlags: [{ flag: 'broken' }, { flag: 'stale', until: Date.now() + 5 * 864e5 }],
            // The monitor's own numbers still say it is down: the panel must not.
            monitorStats: { ...(real.monitorStats || {}), downSince: Date.now() - 60_000 },
        });
        return c.renderBmHealthPane(b);
    });
    expect(html).toContain('Ignoring “Broken” · for good');
    expect(html).toMatch(/Ignoring “Stale” · until /);
    expect(html.match(/data-bm-unignore=/g)).toHaveLength(2);
    expect(html).toMatch(/config-bm-health-state is-off">Ignored</);
    expect(html).not.toContain('Monitor down');
});

async function loadDashboard(page) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
}

test('an ignore on one of two bookmarks with the same address is not an ignore on the other', async ({ page }) => {
    await loadDashboard(page);
    const result = await page.evaluate(() => {
        const d = window.dashboardInstance;
        const url = d.bookmarks[0].url;
        // Two bookmarks at one address, only the first told to ignore its failure.
        d.bookmarks[1].url = url;
        d.bookmarks[0].healthIgnored = [{ flag: 'broken' }];
        d.bookmarks[1].healthIgnored = [];
        const make = (index) => {
            const row = document.createElement('div');
            row.className = 'bookmark-link';
            row.setAttribute('data-bookmark-url', url);
            row.setAttribute('data-bookmark-index', String(index));
            document.body.appendChild(row);
            return row;
        };
        const a = make(0);
        const b = make(1);
        d.statusMonitor.setBookmarkStatus(a, 'offline', '', url);
        d.statusMonitor.setBookmarkStatus(b, 'offline', '', url);
        const out = { a: a.classList.contains('status-offline'), b: b.classList.contains('status-offline') };
        a.remove();
        b.remove();
        return out;
    });
    expect(result).toEqual({ a: false, b: true });
});

test('the tile menu offers to report again an ignore left over from another kind of failure', async ({ page }) => {
    await loadDashboard(page);
    const index = await page.evaluate(() => {
        const row = document.querySelector('.bookmarks-list[data-bookmarks-list="true"]:not([data-smart-collection="true"]) .bookmark-link[data-bookmark-index]');
        return Number(row.getAttribute('data-bookmark-index'));
    });
    const prepare = () => page.evaluate((i) => {
        // A content ignore from before, and a timeout now: a different kind.
        const b = window.dashboardInstance.bookmarks[i];
        b.lastError = 'Timeout';
        b.healthIgnored = [{ flag: 'content' }];
    }, index);
    const row = page.locator(
        `.bookmarks-list[data-bookmarks-list="true"]:not([data-smart-collection="true"]) .bookmark-link[data-bookmark-index="${index}"]`,
    ).first();
    await expect(row).toBeVisible();
    // The dashboard swaps its bookmark objects now and then: set the state on the
    // current one right before the menu reads it.
    await expect(async () => {
        await prepare();
        await row.click({ button: 'right' });
        await expect(page.locator('#bookmark-context-menu [data-action="ignore-error"]')).toBeVisible({ timeout: 1500 });
    }).toPass({ timeout: 15_000 });
    await expect(page.locator('#bookmark-context-menu [data-action="unignore-error"]')).toBeVisible();
});

test('ignoring a failure asks for a fresh badge count, which feeds the tab title and icon', async ({ page }) => {
    await loadDashboard(page);
    const calls = await page.evaluate(async () => {
        const d = window.dashboardInstance;
        const health = await d.health.load();
        // The write's own work only: the report reload and the live channel also
        // ask for a badge, which would hide whether the write does.
        health.loadAndRender = async () => {};
        health.refreshBookmarkCopies = async () => {};
        let n = 0;
        d.updateHealthBadge = () => { n += 1; return Promise.resolve(); };
        const b = d.bookmarks[0];
        const target = { pageId: Number(d.currentPageId), index: 0, url: b.url };
        await health.writeIgnores(target, { add: ['broken'] });
        const afterAdd = n;
        await health.writeIgnores(target, { clear: true });
        return { afterAdd, afterClear: n };
    });
    expect(calls).toEqual({ afterAdd: 1, afterClear: 2 });
});

test('the Bookmarks view rail has an Ignored filter that narrows the list to ignored bookmarks', async ({ page }) => {
    await loadDashboard(page);
    await page.evaluate(() => window.dashboardInstance.config.openLibraryView());
    await page.waitForFunction(() => Boolean(window.dashboardInstance.config._bmHealthByUrl), null, { timeout: 20_000 });
    const rail = page.locator('.config-bm-rail-item', { hasText: 'Ignored' });
    await expect(rail).toHaveCount(1);

    // Nothing is ignored in a fresh data set, so it filters to nothing; ignoring
    // one bookmark through the real write makes it the only row.
    await page.evaluate(async () => {
        const d = window.dashboardInstance;
        const b = d.allBookmarks[0];
        const health = await d.health.load();
        await health.writeIgnores({ pageId: Number(b.pageId), index: d.allBookmarks.filter((x) => x.pageId === b.pageId).indexOf(b), url: b.url }, { add: ['unused'] });
    });
    await page.evaluate(() => window.dashboardInstance.config.refreshBmHealth({ refresh: true }));
    await page.locator('.config-bm-rail-item', { hasText: 'Ignored' }).click();
    await expect(page).toHaveURL(/health=ignored/);
    await expect(page.locator('#config-bm-list .config-bm-row')).toHaveCount(1);
});

test('a row from another page gets no ignore entry, since the write needs its place on its page', async ({ page }) => {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    // A collection row: no page-local index, its bookmark only on another page.
    await page.evaluate(() => {
        const d = window.dashboardInstance;
        const otherPage = d.pages.find((p) => Number(p.id) !== Number(d.currentPageId)) || { id: 999 };
        const url = 'https://ignore-remote.test/';
        d.allBookmarks.push({ name: 'Remote failing', url, pageId: Number(otherPage.id), lastError: 'Timeout', checkStatus: true });
        const row = document.createElement('a');
        row.className = 'bookmark-link';
        row.id = 'remote-row';
        row.setAttribute('data-bookmark-url', url);
        row.innerHTML = '<span class="bookmark-text">Remote failing</span>';
        document.querySelector('.bookmarks-list').appendChild(row);
        d.contextMenu.bindRow(row);
    });
    await page.locator('#remote-row').click({ button: 'right' });
    await expect(page.locator('#bookmark-context-menu')).toBeVisible();
    await expect(page.locator('#bookmark-context-menu [data-action="ignore-error"]')).toHaveCount(0);
    await expect(page.locator('#bookmark-context-menu [data-action="snooze-error"]')).toHaveCount(0);
});
