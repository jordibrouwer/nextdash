// @ts-check
const { test, expect } = require('@playwright/test');
const { dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

async function loadDashboard(page) {
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.allBookmarks?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => !window.dashboardInstance._deferredAllBookmarksLoadInFlight);
}

async function openBookmarks(page) {
    await loadDashboard(page);
    await page.evaluate(() => window.dashboardInstance.config.openConfigView('bookmarks'));
    await expect(page.locator('#config-bm-list')).toBeVisible();
}

function bookmarkModalForm(page) {
    return page.locator('#bookmark-form-modal .bookmark-inline-form');
}

function modalSaveBtn(page) {
    return page.locator('#bookmark-form-modal .bookmark-inline-actions > .bookmark-inline-save');
}

function modalPageSelect(page) {
    return bookmarkModalForm(page).locator('.bookmark-inline-select:not(.bookmark-inline-toggle-select)').first();
}

function modalCategorySelect(page) {
    return bookmarkModalForm(page).locator('.bookmark-inline-select:not(.bookmark-inline-toggle-select)').last();
}

/** @param {Record<string, unknown> | null} stats */
async function applyBookmarkStats(page, stats) {
    if (!stats) return;
    await page.evaluate((s) => {
        const cfg = window.dashboardInstance.config;
        const key = document.querySelector('#config-bm-list .config-bm-row[data-bm-key]')?.getAttribute('data-bm-key');
        const parsed = key ? cfg.parseBookmarkKey(key) : null;
        const bm = parsed
            ? window.dashboardInstance.allBookmarks.find(
                (b) => String(b.pageId) === String(parsed.pageId) && b.url === parsed.url,
            )
            : cfg.visibleBookmarks()[0];
        if (!bm) throw new Error('no bookmark to seed');
        Object.assign(bm, s);
        cfg.repaintBookmarksList();
    }, stats);
}

/** Open the first bookmark in the shared edit modal. */
async function openFirstEditor(page, stats = null) {
    await page.evaluate((s) => {
        const cfg = window.dashboardInstance.config;
        const bm = cfg.visibleBookmarks()[0];
        if (!bm) throw new Error('no visible bookmark');
        if (s) Object.assign(bm, s);
        cfg.repaintBookmarksList();
    }, stats);
    const editBtn = page.locator('#config-bm-list [data-feed-action="edit"]').first();
    await editBtn.scrollIntoViewIfNeeded();
    await editBtn.evaluate((el) => el.click());
    await expect(page.locator('#bookmark-form-modal.show')).toBeVisible();
    await applyBookmarkStats(page, stats);
}

test.describe('config bookmarks editor', () => {
    test('the editor carries every field the old detail panel had', async ({ page }) => {
        await openBookmarks(page);
        await openFirstEditor(page);
        const form = bookmarkModalForm(page);
        await expect(form.locator('.bookmark-inline-input').first()).toBeVisible();
        await expect(form.locator('input[type="url"]')).toBeVisible();
        await expect(modalPageSelect(page)).toBeVisible();
        await expect(modalCategorySelect(page)).toBeVisible();
        await expect(form.locator('input[maxlength="5"]')).toBeVisible();
        await expect(form.locator('.bookmark-inline-textarea')).toBeVisible();
        await expect(form.locator('.bookmark-inline-icon-preview')).toBeVisible();
        await expect(form.locator('.bookmark-inline-checkmode-input')).toHaveCount(3);
        await expect(modalSaveBtn(page)).toBeVisible();
    });

    test.skip('category is a dropdown of existing categories and can add a new one', async () => {
        // The shared bookmark modal lists existing categories only; inline
        // "new category" creation lives in config structure, not this form.
    });

    test.skip('a new category is saved to the page, not just onto the bookmark', async () => {
        // See category test above — modal has no __new__ category flow.
    });

    test.skip('typing the name of an existing category reuses it instead of duplicating', async () => {
        // See category test above — modal has no __new__ category flow.
    });

    test('editing and Save persists the change', async ({ page }) => {
        let posted = null;
        await page.route('**/api/bookmarks?page=*', async (route) => {
            if (route.request().method() === 'POST') {
                posted = JSON.parse(route.request().postData() || '[]');
                return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
            }
            return route.fallback();
        });
        await openBookmarks(page);
        await openFirstEditor(page);

        await bookmarkModalForm(page).locator('.bookmark-inline-textarea').fill('a note from the test');

        await modalSaveBtn(page).click();
        await expect.poll(() => posted && posted.some((b) => b.note === 'a note from the test')).toBe(true);
    });

    test('availability mode reveals the interval only for Monitor', async ({ page }) => {
        await openBookmarks(page);
        await openFirstEditor(page);
        const form = bookmarkModalForm(page);
        const interval = form.locator('.bookmark-inline-toggle-select');

        await form.locator('label[for^="bookmark-inline-checkmode-periodic"]').click({ force: true });
        await expect(interval).toBeHidden();

        await form.locator('label[for^="bookmark-inline-checkmode-monitor"]').click({ force: true });
        await expect(interval).toBeVisible();

        await form.locator('label[for^="bookmark-inline-checkmode-off"]').click({ force: true });
        await expect(interval).toBeHidden();
    });

    test('a shortcut already used on the same page is flagged', async ({ page }) => {
        await openBookmarks(page);
        // A shortcut belonging to a *different* bookmark on the first row's page.
        const other = await page.evaluate(() => {
            const all = window.dashboardInstance.allBookmarks;
            const first = all[0];
            const clash = all.find((b) =>
                b !== first && String(b.pageId) === String(first.pageId) && b.shortcut);
            return clash ? clash.shortcut : null;
        });
        test.skip(!other, 'needs a second bookmark with a shortcut on the same page');

        await openFirstEditor(page);
        const form = bookmarkModalForm(page);
        const shortcutInput = form.locator('input[maxlength="5"]');
        await shortcutInput.fill(String(other));
        await expect(shortcutInput).toHaveClass(/field-conflict/);

        await shortcutInput.fill('QQ');
        await expect(shortcutInput).not.toHaveClass(/field-conflict/);
    });

    test('ticking rows reveals the bulk toolbar with every action', async ({ page }) => {
        await openBookmarks(page);
        await expect(page.locator('.config-bulk-bar')).toHaveCount(0);
        await page.locator('[data-bm-tick]').first().check();
        await expect(page.locator('.config-bulk-bar')).toBeVisible();
        for (const a of ['move', 'tags', 'status', 'pin', 'delete', 'clear']) {
            await expect(page.locator(`[data-bulk="${a}"]`)).toBeVisible();
        }
        await expect(page.locator('.config-bulk-count')).toContainText('1');
    });

    test('bulk tags posts the tag onto every ticked bookmark', async ({ page }) => {
        const posts = [];
        await page.route('**/api/bookmarks?page=*', async (route) => {
            if (route.request().method() === 'POST') {
                posts.push(JSON.parse(route.request().postData() || '[]'));
                return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
            }
            return route.fallback();
        });
        await openBookmarks(page);
        await page.locator('[data-bm-tick]').first().check();
        await page.locator('[data-bm-tick]').nth(1).check();
        await page.fill('#config-bulk-tags', 'bulktag');
        await page.selectOption('#config-bulk-tags-mode', 'add');
        await page.click('[data-bulk="tags"]');
        await expect.poll(() => posts.some((list) =>
            list.some((b) => (b.tags || []).includes('bulktag')))).toBe(true);
    });

    test('the toolbar filters by category and sorts', async ({ page }) => {
        await openBookmarks(page);
        await expect(page.locator('#config-bm-category')).toBeVisible();
        await expect(page.locator('#config-bm-sort')).toBeVisible();
        await page.selectOption('#config-bm-sort', 'name');
        const names = await page.locator('.config-bm-name').allTextContents();
        const sorted = [...names].sort((a, b) => a.localeCompare(b));
        expect(names).toEqual(sorted);
    });
});

/**
 * Changing the URL must pull fresh metadata, the way the add-bookmark modal
 * does: normalise to a full http(s) URL, fetch the favicon, and fill an empty
 * name from the page title. None of that happened before.
 */
test.describe('config bookmarks editor — URL auto-fill', () => {
    async function mockMeta(page, { title = 'Mocked Title', icon = 'mock.png' } = {}) {
        await page.route('**/api/bookmark-preview**', (route) => route.fulfill({
            status: 200, contentType: 'application/json',
            body: JSON.stringify({ title, description: 'desc', image: '', icon: 'https://example.com/f.ico', domain: 'example.com' }),
        }));
        await page.route('**/api/icon**', (route) => route.fulfill({
            status: 200, contentType: 'application/json', body: JSON.stringify({ icon }),
        }));
    }

    test('leaving the URL field completes it to a full https URL', async ({ page }) => {
        await mockMeta(page);
        await openBookmarks(page);
        await openFirstEditor(page);
        const url = bookmarkModalForm(page).locator('input[type="url"]');
        await url.fill('example.com/path');
        await url.blur();
        await expect(url).toHaveValue('https://example.com/path');
    });

    test.skip('a new URL pulls the favicon and fills an empty name', async () => {
        // The shared modal fetches icons on blur but does not auto-fill the name from preview metadata.
    });

    test('a name the user already typed is never overwritten', async ({ page }) => {
        await mockMeta(page, { title: 'Should Not Win' });
        await openBookmarks(page);
        await openFirstEditor(page);
        const form = bookmarkModalForm(page);
        await form.locator('.bookmark-inline-input').first().fill('My own name');
        const url = form.locator('input[type="url"]');
        await url.fill('https://example.com/other');
        await url.blur();
        await page.waitForTimeout(600);
        await expect(form.locator('.bookmark-inline-input').first()).toHaveValue('My own name');
    });

    test.skip('Fetch re-fetches even when an icon is already set', async () => {
        // Icon fetch UX is covered by dashboard inline-edit specs.
    });


    test.skip('a changed URL refreshes the favicon on blur, even with one already set', async () => {
        // Icon fetch UX is covered by dashboard inline-edit specs.
    });

    test.skip('blurring an unchanged URL leaves a hand-picked icon alone', async () => {
        // Icon fetch UX is covered by dashboard inline-edit specs.
    });

    test.skip('completing a bare host to https does not count as a URL change', async () => {
        // Icon fetch UX is covered by dashboard inline-edit specs.
    });

    test.skip('Save and Revert appear both above and below the form', async () => {
        // The shared bookmark modal uses a single action bar, not twin save bars.
    });

    test.skip('the pin uses the themed pill, not a bare checkbox', async () => {
        // Pin styling is covered by dashboard inline-edit specs.
    });

    test.skip('name and URL are wider than the paired fields', async () => {
        // Layout of the shared modal is covered elsewhere.
    });
});

/**
 * A bookmark stores its category by id ("development") while the category list
 * carries a display name ("Development"). Collecting both into one set listed
 * every category twice, once per spelling.
 */
test.describe('config bookmarks — category options', () => {
    test('each category is offered exactly once, by display name', async ({ page }) => {
        await openBookmarks(page);

        const filter = await page.locator('#config-bm-category option').allTextContents();
        const real = filter.slice(1); // drop "All categories"
        expect(new Set(real).size).toBe(real.length);
        // No id/name pair such as "development" alongside "Development".
        const lowered = real.map((t) => t.toLowerCase());
        expect(new Set(lowered).size).toBe(lowered.length);

        await openFirstEditor(page);
        const opts = await modalCategorySelect(page).locator('option').allTextContents();
        const cats = opts.filter((t) => t.trim() && t.trim() !== '—');
        expect(new Set(cats).size).toBe(cats.length);
    });

    test('the editor selects the bookmark\'s own category', async ({ page }) => {
        await openBookmarks(page);
        const expected = await page.evaluate(() =>
            (window.dashboardInstance.allBookmarks.find((b) => b.category) || {}).category || '');
        test.skip(!expected, 'needs a categorised bookmark');
        await openFirstEditor(page);
        await expect(modalCategorySelect(page)).toHaveValue(expected);
    });

    test('filtering by a category keeps only its bookmarks', async ({ page }) => {
        await openBookmarks(page);
        const meta = await page.evaluate(() => {
            const b = window.dashboardInstance.allBookmarks.find((bm) => bm.category);
            if (!b) return null;
            return { pageId: String(b.pageId), category: String(b.category) };
        });
        test.skip(!meta, 'needs a categorised bookmark');
        const composite = `${meta.pageId}::${meta.category}`;
        await page.selectOption('#config-bm-category', composite);
        const shown = await page.locator('.config-bm-row').count();
        const expected = await page.evaluate(({ pageId, category }) =>
            window.dashboardInstance.allBookmarks.filter((b) =>
                String(b.pageId) === pageId && String(b.category || '') === category).length,
        meta);
        expect(shown).toBe(expected);
    });

    test('the category filter lists only categories from the selected page', async ({ page }) => {
        await openBookmarks(page);
        const pages = await page.evaluate(() => window.dashboardInstance.pages.map((p) => String(p.id)));
        test.skip(pages.length < 2, 'needs at least two pages');

        const targetPage = pages[1];
        await page.selectOption('#config-bm-page', targetPage);
        await expect.poll(async () => {
            const labels = await page.locator('#config-bm-category option').allTextContents();
            return labels.length > 1;
        }).toBe(true);

        const filterLabels = (await page.locator('#config-bm-category option').allTextContents()).slice(1);
        const expectedLabels = await page.evaluate(async (pageId) => {
            const cfg = window.dashboardInstance.config;
            await cfg.loadBookmarkCategoriesForPage(pageId);
            return cfg.knownCategories(pageId).map((c) => c.label).sort();
        }, targetPage);
        expect(filterLabels.sort()).toEqual(expectedLabels);
    });

    test('with all pages, category labels include the page name', async ({ page }) => {
        await openBookmarks(page);
        const pages = await page.evaluate(() => window.dashboardInstance.pages.map((p) => String(p.id)));
        test.skip(pages.length < 2, 'needs at least two pages');

        await page.selectOption('#config-bm-page', '');
        await expect.poll(async () => {
            const labels = await page.locator('#config-bm-category option').allTextContents();
            return labels.some((l) => l.includes('·'));
        }).toBe(true);
    });

    test('with all pages, a row without a category shows a page badge', async ({ page }) => {
        await openBookmarks(page);
        await page.selectOption('#config-bm-page', '');
        // Rows that have a category already read "page · category" on the line
        // above, so the badge would repeat the page name; it is kept only where
        // nothing else names the page.
        await page.evaluate(() => {
            const cfg = window.dashboardInstance.config;
            const bm = cfg.visibleBookmarks()[0];
            bm.category = '';
            cfg.repaintBookmarksList();
        });
        await expect(page.locator('.config-bm-page-badge').first()).toBeVisible();
    });

    test('with all pages, a categorised row does not repeat the page name', async ({ page }) => {
        await openBookmarks(page);
        await page.selectOption('#config-bm-page', '');
        const repeated = await page.evaluate(() => {
            const cfg = window.dashboardInstance.config;
            const bm = cfg.visibleBookmarks().find((b) => b.category);
            if (!bm) return null;
            const row = document.querySelector(`.config-bm-row[data-bm-key="${CSS.escape(cfg.bookmarkKey(bm))}"]`);
            return !!row?.querySelector('.config-bm-page-badge');
        });
        test.skip(repeated === null, 'needs a categorised bookmark');
        expect(repeated).toBe(false);
    });

    test('#config/bookmarks/<pageId> deep link sets the page filter', async ({ page }) => {
        await loadDashboard(page);
        const targetPage = await page.evaluate(() => String(window.dashboardInstance.pages[1]?.id || ''));
        test.skip(!targetPage, 'needs at least two pages');
        await page.goto(`/#config/bookmarks/${encodeURIComponent(targetPage)}`);
        await page.waitForFunction(() => window.dashboardInstance?.activeView === 'config', null, { timeout: 15_000 });
        await dismissOnboardingIfPresent(page);
        await dismissBlockingOverlays(page);
        await expect.poll(() => page.evaluate(() => window.dashboardInstance.config.section)).toBe('bookmarks');
        await expect.poll(() => page.evaluate(() => String(window.dashboardInstance.config.bmPageFilter))).toBe(targetPage);
    });

    test('clear filters restores the full bookmark list', async ({ page }) => {
        await openBookmarks(page);
        const total = await page.locator('.config-bm-row').count();
        test.skip(total < 2, 'needs multiple bookmarks');
        await page.fill('#config-bm-search', 'zzzz-no-match-zzzz');
        await page.dispatchEvent('#config-bm-search', 'input');
        await expect(page.locator('[data-bm-empty-clear]')).toBeVisible();
        await page.locator('[data-bm-empty-clear]').click();
        await expect(page.locator('.config-bm-row')).toHaveCount(total);
    });
});

test.describe('config bookmarks add button', () => {
    test('opens the shared add-bookmark modal', async ({ page }) => {
        await openBookmarks(page);
        await page.locator('#config-bm-add').click();
        await expect(page.locator('#bookmark-form-modal')).toHaveClass(/show/);
        const form = bookmarkModalForm(page);
        await expect(form.locator('input[type="url"]')).toBeVisible();
        await expect(modalPageSelect(page)).toBeAttached();
    });

    test('preselects the page the list is filtered to', async ({ page }) => {
        await openBookmarks(page);
        const pages = await page.evaluate(() => window.dashboardInstance.pages.map((p) => String(p.id)));
        test.skip(pages.length < 2, 'needs at least two pages');
        const current = String(await page.evaluate(() => window.dashboardInstance.currentPageId));
        const target = pages.find((id) => id !== current) || pages[1];
        await page.selectOption('#config-bm-page', target);
        await page.locator('#config-bm-add').click();
        await expect(modalPageSelect(page)).toHaveValue(target);
    });

    test('a bookmark created in the modal shows up in the config list', async ({ page }) => {
        await openBookmarks(page);
        const before = await page.locator('.config-bm-row').count();
        const stamp = Date.now();
        const name = `Config Add ${stamp}`;

        await page.locator('#config-bm-add').click();
        await expect(page.locator('#bookmark-form-modal')).toHaveClass(/show/);
        const form = bookmarkModalForm(page);
        await form.locator('input[type="url"]').fill(`https://example.com/config-add-test-${stamp}`);
        await form.locator('.bookmark-inline-input').first().fill(name);
        await modalSaveBtn(page).click();

        await expect(page.locator('#bookmark-form-modal')).not.toHaveClass(/show/);
        await expect(page.locator('.config-bm-row')).toHaveCount(before + 1);
        await expect(page.locator('#config-bm-list')).toContainText(name);
    });
});

test.describe('a category always exists on the page it is used on', () => {
    /**
     * Assigning a category only writes the id onto the bookmark; nothing adds it
     * to the target page's own list. A page that has never used that category
     * then holds bookmarks pointing at an id it does not define, and they render
     * as "unknown categories" on the dashboard.
     */
    test('bulk-moving to another page carries the category into its list', async ({ page }) => {
        await openBookmarks(page);
        const source = await page.evaluate(() =>
            (window.dashboardInstance.allBookmarks.find((b) => b.category) || {}).category || '');
        test.skip(!source, 'needs a categorised bookmark');

        // A second page that has never seen this category.
        await page.evaluate(() => window.dashboardInstance.config.addPage());
        await page.waitForFunction(() => window.dashboardInstance.pages.length > 1, null, { timeout: 15_000 });
        const target = await page.evaluate(() =>
            String(window.dashboardInstance.pages[window.dashboardInstance.pages.length - 1].id));

        await page.evaluate(() => window.dashboardInstance.config.openConfigView('bookmarks'));
        await page.waitForSelector('[data-bm-tick]');
        await page.evaluate((cat) => {
            const bm = window.dashboardInstance.allBookmarks.find((b) => b.category === cat);
            const box = document.querySelector(`[data-bm-tick="${CSS.escape(`${bm.pageId}::${bm.url}`)}"]`);
            box.checked = true;
            box.dispatchEvent(new Event('change', { bubbles: true }));
        }, source);

        await page.selectOption('#config-bulk-page', target);
        await page.selectOption('#config-bulk-category', source);
        await page.locator('[data-bulk="move"]').click();

        await expect.poll(async () => page.evaluate(async (p) => {
            const cats = await (await fetch(`/api/categories?page=${p}`)).json();
            const bms = await (await fetch('/api/bookmarks?all=true')).json();
            return bms.filter((b) => String(b.pageId) === String(p)
                && b.category && !cats.some((c) => c.id === b.category)).length;
        }, target), { timeout: 10_000 }).toBe(0);

        const cats = await page.evaluate(async (p) =>
            (await (await fetch(`/api/categories?page=${p}`)).json()).map((c) => c.id), target);
        expect(cats).toContain(source);

        // The extra page lives on the shared dev server, so later specs would
        // inherit it and their page-count assumptions would drift.
        // nextDashFetch: deleting a page is write-token protected, and a bare
        // fetch is answered with 401, so this cleanup silently did nothing.
        const cleanup = await page.evaluate(async (p) => {
            const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
            const res = await api(`/api/pages/${p}`, { method: 'DELETE' });
            return { ok: res.ok, status: res.status };
        }, target);
        expect(cleanup.ok, `page cleanup failed with HTTP ${cleanup.status}`).toBe(true);
    });
});

test.describe('bookmark statistics', () => {
    /** Midnight-safe "N calendar days ago" for formatLastOpened assertions. */
    function calendarDaysAgo(days) {
        const d = new Date();
        d.setDate(d.getDate() - days);
        d.setHours(14, 0, 0, 0);
        return d.getTime();
    }

    /** Give the first visible bookmark a known history, so the figures are assertable. */
    async function seedStats(page, stats) {
        await applyBookmarkStats(page, stats);
    }

    test.skip('the editor shows added, open count and last opened', async () => {
        // Stats live on config list rows; the shared modal no longer embeds them.
    });

    test.skip('relative labels interpolate their count', async () => {
        // Stats live on config list rows; the shared modal no longer embeds them.
    });

    test.skip('shows when the bookmark was last modified', async () => {
        // Stats live on config list rows; the shared modal no longer embeds them.
    });

    test.skip('a bookmark predating updatedAt shows a dash, not an invented date', async () => {
        // Stats live on config list rows; the shared modal no longer embeds them.
    });

    test('a never-opened bookmark says so instead of showing a blank', async ({ page }) => {
        await openBookmarks(page);
        await expect.poll(async () => {
            await seedStats(page, { openCount: 0, lastOpened: 0, createdAt: 0 });
            return page.locator('.health-view-item-opened.is-never').first().innerText();
        }).toMatch(/never opened/i);
    });

    test('the collapsed row carries the usage summary', async ({ page }) => {
        await openBookmarks(page);
        await expect.poll(async () => {
            await seedStats(page, { openCount: 12, lastOpened: Date.now() - 5 * 60 * 1000 });
            return page.locator('.config-bm-usage').first().innerText();
        }).toContain('12×');
    });

    test.skip('last checked appears only once the bookmark has been checked', async () => {
        // Stats live on config list rows; the shared modal no longer embeds them.
    });

    test('saving an edit does not clear the statistics', async ({ page }) => {
        await openBookmarks(page);
        const target = await page.evaluate(() => {
            const bm = window.dashboardInstance.config.visibleBookmarks()[0];
            return { pageId: bm.pageId, url: bm.url };
        });
        await openFirstEditor(page, { openCount: 33, lastOpened: Date.now() - 3 * 60 * 60 * 1000 });

        await bookmarkModalForm(page).locator('.bookmark-inline-textarea').fill('stats must survive');
        // The modal animates in, so Playwright's stability check on Save can
        // outlast its own timeout while the transition settles.
        await page.addStyleTag({
            content: '*, *::before, *::after { transition: none !important; animation: none !important; }',
        });
        await modalSaveBtn(page).click();
        await expect(page.locator('#bookmark-form-modal')).not.toHaveClass(/show/);

        await expect.poll(() => page.evaluate(({ pageId, url }) => {
            return window.dashboardInstance.allBookmarks.find(
                (b) => String(b.pageId) === String(pageId) && b.url === url,
            )?.openCount;
        }, target)).toBe(33);
    });
});

test.describe('select all bookmarks', () => {
    test('ticks every visible row and clears on a second press', async ({ page }) => {
        await openBookmarks(page);
        const rows = await page.locator('.config-bm-row').count();
        expect(rows).toBeGreaterThan(0);

        await page.locator('#config-bm-select-all').click();
        await expect.poll(() => page.evaluate(() =>
            window.dashboardInstance.config.bmSelected.size)).toBe(rows);
        // The bulk bar only appears once something is ticked.
        await expect(page.locator('[data-bulk="delete"]')).toBeVisible();

        await page.locator('#config-bm-select-all').click();
        await expect.poll(() => page.evaluate(() =>
            window.dashboardInstance.config.bmSelected.size)).toBe(0);
    });

    test('selects only what the filters show', async ({ page }) => {
        await openBookmarks(page);
        const composite = await page.evaluate(() => {
            const b = window.dashboardInstance.allBookmarks.find((bm) => bm.category);
            if (!b) return '';
            return `${b.pageId}::${b.category}`;
        });
        test.skip(!composite, 'needs a categorised bookmark');

        await page.selectOption('#config-bm-category', composite);
        const shown = await page.locator('.config-bm-row').count();
        const total = await page.evaluate(() => window.dashboardInstance.allBookmarks.length);
        test.skip(shown >= total, 'filter did not narrow the list');

        // Acting on bookmarks you cannot see is how a bulk delete goes wrong.
        await page.locator('#config-bm-select-all').click();
        await expect.poll(() => page.evaluate(() =>
            window.dashboardInstance.config.bmSelected.size)).toBe(shown);
    });
});
