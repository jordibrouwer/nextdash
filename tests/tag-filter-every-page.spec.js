// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * The tag filter reaches every page.
 *
 * The cloud counted tags across the whole library and the filter looked only
 * at the page on screen, so a tag that lived on another page was offered in
 * the cloud and answered with an empty grid. Picked from the cloud, a tag now
 * shows its bookmarks from every page in one flat list.
 */

async function openDashboard(page) {
    await page.setViewportSize({ width: 1500, height: 950 });
    await markWhatsNewSeen(page);
    // The bulk toolbar's promo keeps its buttons moving.
    await page.addInitScript(() => {
        localStorage.setItem('nextdash:dashboard-tag-filter-bulk-promo-confirmed-v1', '1');
        localStorage.setItem('nextdash:dashboard-tag-cloud-promo-confirmed-v1', '1');
    });
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });
    await page.evaluate(async () => {
        const d = window.dashboardInstance;
        Object.assign(d.settings, { showTagCloudButton: true, actionBarPosition: 'header', maxHeaderActions: 8 });
        await d.saveSettings?.();
        d.setupDOM?.();
        window.DashboardTagCloud?.syncFromSettings?.();
    });
}

/** A second page holding `elsewhere` bookmarks; `here` bookmarks on the current page. */
async function seed(page, { tag, here = [], elsewhere = [] }) {
    return page.evaluate(async ({ tag, here, elsewhere }) => {
        const d = window.dashboardInstance;
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        const list = await (await api('/api/pages')).json();
        let other = list.find((p) => p.name === 'Tag elsewhere');
        if (!other) {
            other = { id: Math.max(...list.filter((p) => p.id < 999999).map((p) => p.id)) + 1, name: 'Tag elsewhere' };
            await api('/api/pages', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify([...list, other]) });
        }
        const add = (pageId, b) => api('/api/bookmarks/add', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ page: pageId, bookmark: { name: b.name || b.url, url: b.url, tags: [tag] } }),
        });
        for (const b of here) await add(d.currentPageId, b);
        for (const b of elsewhere) await add(other.id, b);
        return { current: Number(d.currentPageId), other: Number(other.id), otherName: other.name };
    }, { tag, here, elsewhere });
}

async function pickFromCloud(page, tag) {
    await page.locator('body').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('/');
    const chip = page.locator('#tag-cloud-modal .tag-cloud-word', { hasText: new RegExp(`^#?${tag}`) });
    await expect(chip).toBeVisible();
    await chip.click();
    // A pick closes the cloud and lands on the grid.
    await expect(page.locator('#tag-cloud-modal')).toBeHidden();
}

const filteredUrls = (page) => page.evaluate(() => [...document.querySelectorAll(
    '#dashboard-layout.tag-filter-view .bookmark-link a.bookmark-open'
)].map((a) => a.getAttribute('href')));

test('a tag that lives only on another page shows its bookmarks', async ({ page }) => {
    await openDashboard(page);
    const tag = `elsewhere${Date.now()}`;
    const url = `https://elsewhere-${Date.now()}.example.com/`;
    await seed(page, { tag, elsewhere: [{ url }] });
    await openDashboard(page);

    await pickFromCloud(page, tag);

    await expect.poll(() => filteredUrls(page)).toContain(url);
    await expect(page.locator('#dashboard-layout .empty-state--tag-filter')).toHaveCount(0);
    // Read aloud, the banner does not place every page's matches on this one.
    await expect(page.locator('#tag-filter-banner')).not.toHaveAttribute('aria-label', /this page/i);
});

test('one flat list across pages, and a bookmark on two pages is one row', async ({ page }) => {
    await openDashboard(page);
    const tag = `twopages${Date.now()}`;
    const shared = `https://shared-${Date.now()}.example.com/`;
    const local = `https://local-${Date.now()}.example.com/`;
    const remote = `https://remote-${Date.now()}.example.com/`;
    await seed(page, {
        tag,
        here: [{ url: shared, name: 'Shared' }, { url: local }],
        elsewhere: [{ url: shared, name: 'Shared' }, { url: remote }],
    });
    await openDashboard(page);

    await pickFromCloud(page, tag);

    await expect.poll(async () => (await filteredUrls(page)).sort()).toEqual([local, remote, shared].sort());
    // Flat: no heading per page among the filter's blocks.
    await expect(page.locator('#dashboard-layout.tag-filter-view .category-title', { hasText: 'Tag elsewhere' })).toHaveCount(0);
});

test('with the header button off, / still reaches tags on other pages', async ({ page }) => {
    await openDashboard(page);
    const tag = `nobutton${Date.now()}`;
    const url = `https://nobutton-${Date.now()}.example.com/`;
    await seed(page, { tag, elsewhere: [{ url }] });
    // Off, and nothing else that loads other pages at startup.
    await page.evaluate(async () => {
        const d = window.dashboardInstance;
        Object.assign(d.settings, {
            showTagCloudButton: false, globalShortcuts: false, showTagCollections: false,
            showSmartRecentCollection: false, showSmartStaleCollection: false,
            showSmartMostUsedCollection: false, showSmartTodayCollection: false,
        });
        await d.saveSettings?.();
    });
    await page.reload();
    await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });
    await dismissBlockingOverlays(page);
    expect(await page.evaluate(() => window.dashboardInstance._unsortedLoaded === true)).toBe(false);

    await pickFromCloud(page, tag);

    await expect.poll(() => filteredUrls(page)).toContain(url);
});

const readPage = (page, id) => page.evaluate(async (id) => {
    const res = await fetch(`/api/bookmarks?page=${id}`);
    const body = await res.json();
    return (Array.isArray(body) ? body : body.bookmarks || []).map((b) => b.url);
}, id);

const rowFor = (page, url) => page.locator('#dashboard-layout.tag-filter-view .bookmark-link', {
    has: page.locator(`a.bookmark-open[href="${url}"]`),
});

test.describe('matches from another page', () => {
    let tag; let local; let remote; let ids;

    test.beforeEach(async ({ page }) => {
        await openDashboard(page);
        tag = `remote${Date.now()}`;
        local = `https://local-${Date.now()}.example.com/`;
        remote = `https://remote-${Date.now()}.example.com/`;
        ids = await seed(page, { tag, here: [{ url: local }], elsewhere: [{ url: remote }] });
        await openDashboard(page);
        await pickFromCloud(page, tag);
        await expect(rowFor(page, remote)).toHaveCount(1);
    });

    test('carry the name of their page; rows from this page do not', async ({ page }) => {
        await expect(rowFor(page, remote).locator('.bookmark-page-origin')).toHaveText(ids.otherName);
        await expect(rowFor(page, local).locator('.bookmark-page-origin')).toHaveCount(0);
    });

    test('cannot be dragged, nor can anything else in the filter', async ({ page }) => {
        // An inline edit re-arms reordering on every list in the grid.
        const armed = await page.evaluate(() => {
            const d = window.dashboardInstance;
            d.initializeCategoryReorder();
            return (d.categoryReorderInstances || [])
                .filter((inst) => inst?.container?.closest?.('.tag-filter-view')).length;
        });
        expect(armed).toBe(0);
    });

    test('delete and undo put a remote match back on its own page', async ({ page }) => {
        await page.evaluate(() => {
            const d = window.dashboardInstance;
            window.AppModal.danger = async (opts) => { window.__confirmMessage = opts?.message; return true; };
            const original = d.showGroupedNotification.bind(d);
            d.showGroupedNotification = (...args) => {
                window.__undo = args[4]?.undoCallback || null;
                return original(...args);
            };
        });
        await page.locator('#tag-filter-banner .tag-filter-delete-btn').click();
        // The question must not say "on this page" about rows from two pages.
        await expect.poll(() => page.evaluate(() => window.__confirmMessage)).toMatch(/2/);
        expect(await page.evaluate(() => window.__confirmMessage)).not.toMatch(/this page/i);

        await expect.poll(() => readPage(page, ids.other)).not.toContain(remote);
        await expect.poll(() => readPage(page, ids.current)).not.toContain(local);

        await page.evaluate(() => window.__undo());
        await expect.poll(() => readPage(page, ids.other), { timeout: 10_000 }).toContain(remote);
        await expect.poll(() => readPage(page, ids.current), { timeout: 10_000 }).toContain(local);
        expect(await readPage(page, ids.current)).not.toContain(remote);
    });

    test('move to page takes each match from its own page', async ({ page }) => {
        await page.locator('#tag-filter-banner .tag-filter-move-btn').click();
        const popover = page.locator('#move-popover');
        await expect(popover).toBeVisible();
        // Categories belong to one page; these matches stand on two.
        await expect(popover.locator('.move-popover-item[data-type="category"]')).toHaveCount(0);
        await expect(popover.locator('.move-popover-category-hint')).toBeVisible();
        // The page on screen is a destination too: the remote match can come here.
        await popover.locator(`.move-popover-item[data-type="page"][data-id="${ids.current}"]`).click();

        await expect.poll(() => readPage(page, ids.current), { timeout: 10_000 }).toContain(remote);
        await expect.poll(() => readPage(page, ids.other)).not.toContain(remote);
        expect((await readPage(page, ids.current)).filter((u) => u === local)).toHaveLength(1);
    });
});
