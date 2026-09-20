// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * The Unsorted view in Config → Bookmarks.
 *
 * Kept bookmarks are held out of this list by default — they are not filed, and
 * every other view here is about the filed library. This view is how you ask
 * for them, and the page and category controls that are already on the panel
 * are how you file one: giving it a page moves it off the hidden page and onto
 * the dashboard.
 */

function kept(slug) {
    return {
        name: `Cfg ${slug}`,
        url: `https://cfg-${slug}.example/a`,
        category: '',
        createdAt: 5000,
    };
}

async function openBookmarksSection(page, rows) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });

    await page.evaluate(async (items) => {
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        for (const bookmark of items) {
            await api('/api/bookmarks/add', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ page: 999999, bookmark }),
            });
        }
        await window.dashboardInstance.loadAllBookmarks();
    }, rows);

    await page.evaluate(() => window.dashboardInstance.config.openConfigView('bookmarks'));
    await expect(page.locator('#config-bm-list')).toBeVisible({ timeout: 15_000 });
}

/** The config view object, whether or not it is behind its loader. */
function configView(page) {
    return page.evaluate(() => {
        const d = window.dashboardInstance;
        const c = d.config.instance || d.config;
        return {
            filter: c.bmCleanupFilter,
            visible: c.visibleBookmarks().map((b) => b.name),
            unsortedView: c.isUnsortedBookmarkView(),
            poolLen: c.configBookmarkPool().length,
        };
    });
}

/**
 * Start from nothing ticked.
 *
 * The selection is remembered across reloads, so a test that follows another
 * one in this file can open the section with rows already ticked — and the
 * panel then shows the bulk form, whose page field writes a draft nothing
 * applies until the Apply button is pressed.
 */
async function clearSelection(page) {
    await page.evaluate(() => {
        const d = window.dashboardInstance;
        const c = d.config.instance || d.config;
        c.bmSelected?.clear?.();
        c.afterSelectionChange?.();
    });
    await expect.poll(async () => page.evaluate(() => {
        const d = window.dashboardInstance;
        return (d.config.instance || d.config).bmSelected?.size ?? 0;
    })).toBe(0);
}

async function openUnsortedView(page) {
    const button = page.locator('[data-bm-rail="cleanup"][data-value="unsorted"]');
    await expect(button).toBeVisible();
    if ((await configView(page)).unsortedView !== true) {
        await button.click();
    }
    await expect.poll(async () => (await configView(page)).unsortedView, { timeout: 10_000 }).toBe(true);
}

test('the rail offers an Unsorted view, and the list ignores it until then', async ({ page }) => {
    await openBookmarksSection(page, [kept('listed')]);

    // Out of the way by default.
    expect((await configView(page)).visible).not.toContain('Cfg listed');
    const button = page.locator('[data-bm-rail="cleanup"][data-value="unsorted"]');
    await expect(button.locator('.config-bm-rail-label')).toHaveText('Unsorted');
    await expect(button.locator('.config-bm-rail-count')).toHaveText('1');

    await openUnsortedView(page);

    const state = await configView(page);
    expect(state.visible).toEqual(['Cfg listed']);
    // The count beside the section name follows the pool being shown.
    await expect(page.locator('.config-bm-header-badge')).toHaveText(String(state.poolLen));
});

test('the other views keep describing the filed library', async ({ page }) => {
    await openBookmarksSection(page, [kept('counts')]);
    const filed = await page.evaluate(() => window.dashboardInstance.allBookmarks.length);

    await openUnsortedView(page);

    // Computed over the filed bookmarks even while the kept ones are on
    // screen: those views are questions about the library this pool is not
    // part of.
    await expect(page.locator('[data-bm-rail="cleanup"][data-value=""] .config-bm-rail-count'))
        .toHaveText(String(filed));
});

test('giving a kept bookmark a page and a category files it', async ({ page }) => {
    await openBookmarksSection(page, [kept('move')]);
    await openUnsortedView(page);

    await page.locator('#config-bm-search').fill('Cfg move');
    await expect.poll(async () => (await configView(page)).visible, { timeout: 10_000 })
        .toEqual(['Cfg move']);

    await clearSelection(page);
    // By key, not by position: the model filters before the list repaints, so
    // the first rendered row can still be the previous query's.
    await page.locator('#config-bm-list [data-bm-key*="cfg-move.example"] input[type="checkbox"]')
        .check();
    await expect.poll(async () => page.evaluate(() => {
        const d = window.dashboardInstance;
        return (d.config.instance || d.config).bmSelected.size;
    })).toBe(1);
    const pageSelect = page.locator('.config-bm-panel select[data-bm-field="page"]').first();
    await expect(pageSelect).toBeVisible();
    // Its own page is an option rather than a gap, so staying put is the
    // default and picking a page is a deliberate act.
    await expect(pageSelect).toHaveValue('999999');

    await pageSelect.selectOption('1');


    await expect.poll(async () => page.evaluate(async () => {
        const res = await fetch('/api/unsorted', { cache: 'no-store' });
        const data = await res.json();
        return (data.bookmarks || []).filter((b) => b.name === 'Cfg move').length;
    }), { timeout: 15_000 }).toBe(0);

    // Polled, not read once: the move is a delete from one page followed by an
    // append to the other, and the row is briefly on neither.
    await expect.poll(async () => page.evaluate(async () => {
        const res = await fetch('/api/bookmarks?all=true', { cache: 'no-store' });
        const list = await res.json();
        return (Array.isArray(list) ? list : [])
            .filter((b) => b.name === 'Cfg move')
            .map((b) => Number(b.pageId));
    }), { timeout: 15_000 }).toEqual([1]);
});

test('a whole selection can be filed at once, with a category', async ({ page }) => {
    await openBookmarksSection(page, [kept('bulkone'), kept('bulktwo')]);
    await openUnsortedView(page);

    await page.locator('#config-bm-search').fill('cfg-bulk');
    await expect.poll(async () => (await configView(page)).visible.length, { timeout: 10_000 }).toBe(2);

    await clearSelection(page);
    await page.locator('#config-bm-list [data-bm-key*="cfg-bulkone.example"] input[type="checkbox"]')
        .check();
    await page.locator('#config-bm-list [data-bm-key*="cfg-bulktwo.example"] input[type="checkbox"]')
        .check();
    await expect.poll(async () => page.evaluate(() => {
        const d = window.dashboardInstance;
        return (d.config.instance || d.config).bmSelected.size;
    })).toBe(2);

    // The bulk form sits in a drawer on a narrow workbench; this is the call the
    // toolbar's own buttons make to bring it out.
    await page.evaluate(() => {
        const d = window.dashboardInstance;
        (d.config.instance || d.config).focusWorkbenchBulkField?.('page');
    });
    const panel = page.locator('.config-bm-panel');
    // The bulk form's fields carry data-bm-bulk-field; the single-row panel's
    // carry data-bm-field.
    const bulkPage = panel.locator('select[data-bm-bulk-field="page"]');
    await expect(bulkPage).toBeVisible({ timeout: 15_000 });
    await bulkPage.selectOption('1');
    // The category list follows the target page, so the one chosen here is a
    // category that page actually has.
    const category = panel.locator('select[data-bm-bulk-field="category"]');
    const categoryId = await category.locator('option').nth(2).getAttribute('value');
    await category.selectOption(categoryId || '');
    await panel.locator('button', { hasText: 'Apply to' }).click();

    await expect.poll(async () => page.evaluate(async () => {
        const res = await fetch('/api/unsorted', { cache: 'no-store' });
        const data = await res.json();
        return (data.bookmarks || []).filter((b) => b.name.startsWith('Cfg bulk')).length;
    }), { timeout: 15_000 }).toBe(0);
    await expect.poll(async () => page.evaluate(async () => {
        const res = await fetch('/api/bookmarks?page=1', { cache: 'no-store' });
        const list = await res.json();
        return (Array.isArray(list) ? list : [])
            .filter((b) => b.name.startsWith('Cfg bulk')).length;
    }), { timeout: 15_000 }).toBe(2);

    const filed = await page.evaluate(async () => {
        const res = await fetch('/api/bookmarks?page=1', { cache: 'no-store' });
        const list = await res.json();
        return (Array.isArray(list) ? list : [])
            .filter((b) => b.name.startsWith('Cfg bulk'))
            .map((b) => b.category);
    });
    expect(filed).toHaveLength(2);

    expect(new Set(filed).size).toBe(1);
    expect(filed[0]).toBe(categoryId);
});
