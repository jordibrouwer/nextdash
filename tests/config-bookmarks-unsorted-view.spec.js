// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');
const { sidePanel } = require('./config-bookmarks-helpers');

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

    await page.evaluate(() => window.dashboardInstance.config.openLibraryView());
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
    // The box shows on hover (rows keep it out of sight at rest, as in Health).
    await page.locator('#config-bm-list [data-bm-key*="cfg-move.example"]').hover();
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
    // The box shows on hover (rows keep it out of sight at rest, as in Health).
    await page.locator('#config-bm-list [data-bm-key*="cfg-bulkone.example"]').hover();
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

/*
 * Promote, as the Inbox does it: the same bookmark form, opened on a real page,
 * and saving it files the bookmark there.
 */
test('an unsorted bookmark is promoted from its side panel, through the bookmark form', async ({ page }) => {
    await openBookmarksSection(page, [kept('promote')]);
    await openUnsortedView(page);
    await clearSelection(page);
    await page.locator('#config-bm-search').fill('Cfg promote');
    await expect.poll(async () => (await configView(page)).visible, { timeout: 10_000 }).toEqual(['Cfg promote']);

    await page.locator('#config-bm-list [data-bm-key*="cfg-promote.example"] .config-bm-title').click();
    const panel = sidePanel(page);
    const promote = panel.locator('[data-bm-panel-action="promote"]');
    await expect(promote).toBeVisible();
    await expect(promote).toHaveClass(/config-btn--primary/);
    await promote.click();

    const form = page.locator('#bookmark-form-modal');
    await expect(form.locator('#bookmark-form-modal-title')).toHaveText('Promote bookmark');
    // It opens on the page the Inbox would promote to, not on Unsorted.
    const destination = await page.evaluate(() => {
        const d = window.dashboardInstance;
        return String((d.config.instance || d.config).bookmarkPromoteDestination());
    });
    const pageValue = () => page.evaluate(() => [...document.querySelectorAll('#bookmark-form-modal .bookmark-inline-select')]
        .filter((s) => !s.classList.contains('bookmark-inline-toggle-select'))
        .find((s) => [...s.options].some((o) => o.value === '999999'))?.value);
    await expect.poll(pageValue).toBe(destination);

    await form.locator('.bookmark-inline-actions .bookmark-inline-save').click();
    await expect(form).toBeHidden();
    await expect.poll(async () => page.evaluate(async () => {
        const res = await fetch('/api/bookmarks?all=true', { cache: 'no-store' });
        const list = await res.json();
        return (Array.isArray(list) ? list : []).filter((b) => b.name === 'Cfg promote').map((b) => String(b.pageId));
    }), { timeout: 15_000 }).toEqual([destination]);
    await expect.poll(async () => page.evaluate(async () => {
        const res = await fetch('/api/unsorted', { cache: 'no-store' });
        const data = await res.json();
        return (data.bookmarks || []).filter((b) => b.name === 'Cfg promote').length;
    }), { timeout: 15_000 }).toBe(0);
});

/*
 * The form loads two category lists on open: the destination page's, for the
 * promote, and Unsorted's, because the bookmark lives on a page other than the
 * current one. Unsorted's is a network fetch that usually lands last, and it
 * used to overwrite the destination's list -- the page said "Home", the
 * category said "—", and the save filed the bookmark with no category. Slowing
 * that fetch down makes the order certain.
 */
test('promoting keeps the destination page\'s category when Unsorted\'s categories load late', async ({ page }) => {
    await openBookmarksSection(page, [kept('late')]);
    await openUnsortedView(page);
    await clearSelection(page);
    await page.locator('#config-bm-search').fill('Cfg late');
    await expect.poll(async () => (await configView(page)).visible, { timeout: 10_000 }).toEqual(['Cfg late']);

    let unsortedCategoriesServed = false;
    await page.route('**/api/categories?page=999999*', async (route) => {
        await new Promise((resolve) => setTimeout(resolve, 800));
        await route.continue();
        unsortedCategoriesServed = true;
    });
    const expected = await page.evaluate(() => {
        const d = window.dashboardInstance;
        const destination = (d.config.instance || d.config).bookmarkPromoteDestination();
        return destination === Number(d.currentPageId) ? String(d.categories?.[0]?.id || '') : null;
    });
    expect(expected).toBeTruthy();

    await page.locator('#config-bm-list [data-bm-key*="cfg-late.example"] .config-bm-title').click();
    await sidePanel(page).locator('[data-bm-panel-action="promote"]').click();
    const form = page.locator('#bookmark-form-modal');
    await expect(form.locator('#bookmark-form-modal-title')).toHaveText('Promote bookmark');
    await expect.poll(() => unsortedCategoriesServed, { timeout: 5_000 }).toBe(true);
    // Give the late list a moment to be applied, had it been going to be.
    await page.waitForTimeout(200);
    const category = () => page.evaluate(() => window.dashboardInstance._inlineEditContext?.fields?.catSelect?.value);
    expect(await category()).toBe(expected);

    await form.locator('.bookmark-inline-actions .bookmark-inline-save').click();
    await expect(form).toBeHidden();
    await expect.poll(async () => page.evaluate(async () => {
        const res = await fetch('/api/bookmarks?all=true', { cache: 'no-store' });
        const list = await res.json();
        return (Array.isArray(list) ? list : []).filter((b) => b.name === 'Cfg late').map((b) => String(b.category));
    }), { timeout: 15_000 }).toEqual([expected]);
});

test('the row menu offers Promote on an unsorted bookmark only', async ({ page }) => {
    await openBookmarksSection(page, [kept('menu')]);
    await clearSelection(page);
    // A filed bookmark: no Promote, in the menu or the panel.
    const filedRow = page.locator('#config-bm-list .config-bm-row').first();
    await filedRow.click({ button: 'right' });
    await expect(page.locator('#config-bm-context-menu')).toBeVisible();
    await expect(page.locator('#config-bm-context-menu [data-action="promote"]')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await filedRow.locator('.config-bm-title').click();
    await expect(sidePanel(page)).toBeVisible();
    await expect(sidePanel(page).locator('[data-bm-panel-action="promote"]')).toHaveCount(0);

    await openUnsortedView(page);
    await page.locator('#config-bm-search').fill('Cfg menu');
    await expect.poll(async () => (await configView(page)).visible, { timeout: 10_000 }).toEqual(['Cfg menu']);
    await page.locator('#config-bm-list [data-bm-key*="cfg-menu.example"]').click({ button: 'right' });
    await page.locator('#config-bm-context-menu [data-action="promote"]').click();
    await expect(page.locator('#bookmark-form-modal #bookmark-form-modal-title')).toHaveText('Promote bookmark');
});
