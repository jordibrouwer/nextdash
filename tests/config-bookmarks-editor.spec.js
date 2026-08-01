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
    await page.locator('[data-feed-action="edit"]').first().click();
    await expect(page.locator('#new-bookmark-modal.show')).toBeVisible();
    await applyBookmarkStats(page, stats);
}

test.describe('config bookmarks editor', () => {
    test('the editor carries every field the old detail panel had', async ({ page }) => {
        await openBookmarks(page);
        await openFirstEditor(page);
        for (const f of ['name', 'url', 'pageId', 'category', 'tags', 'shortcut', 'note', 'pinned', 'icon']) {
            await expect(page.locator(`[data-bm-field="${f}"]`)).toBeVisible();
        }
        // Availability checking with its three modes.
        await expect(page.locator('input[name="new-bookmark-check-mode"]')).toHaveCount(3);
        // Icon and link-preview controls.
        await expect(page.locator('#new-bookmark-icon-file')).toBeVisible();
        await expect(page.locator('#new-bookmark-icon-clear')).toBeVisible();
        await expect(page.locator('[data-bm-preview="refresh"]')).toBeVisible();
        await expect(page.locator('[data-bm-preview="clear"]')).toBeVisible();
        // An explicit save, not a save-on-blur — offered at both ends of the form.
        await expect(page.locator("#new-bookmark-create")).toBeVisible();
    });

    test('category is a dropdown of existing categories and can add a new one', async ({ page }) => {
        await openBookmarks(page);
        await openFirstEditor(page);
        const sel = page.locator('#new-bookmark-category');
        // More than just the blank option: real categories plus the "new" entry.
        expect(await sel.locator('option').count()).toBeGreaterThan(2);
        await expect(sel.locator('option[value="__new__"]')).toHaveCount(1);

        await sel.selectOption('__new__');
        await expect(page.locator('#new-category-create')).toBeVisible();
        await page.fill('#new-category-create-input', 'freshcat');
        await page.click('#new-category-create-ok');
        // The option carries a generated id and shows the typed name.
        await expect(sel.locator('option:checked')).toHaveText('freshcat');
        expect(await sel.inputValue()).not.toBe('__new__');
    });

    /**
     * The dashboard groups bookmarks by the *page's* category list, so a category
     * invented here has to be written to that page too — otherwise the bookmark
     * lands under "Unknown category" instead of the category just created.
     */
    test('a new category is saved to the page, not just onto the bookmark', async ({ page }) => {
        await openBookmarks(page);
        await openFirstEditor(page);

        const sel = page.locator('#new-bookmark-category');
        await sel.selectOption('__new__');
        await page.fill('#new-category-create-input', 'brandnew');
        await page.click('#new-category-create-ok');
        const catId = await sel.inputValue();

        await page.locator("#new-bookmark-create").click();
        await expect(page.locator('#new-bookmark-modal.show')).toBeHidden();

        // The page now defines the category under the id the bookmark uses.
        await expect.poll(async () => page.evaluate(async (id) => {
            const bms = await fetch('/api/bookmarks?all=true').then((r) => r.json());
            const owner = bms.find((b) => b.category === id);
            if (!owner) return 'bookmark-missing-category';
            const cats = await fetch(`/api/categories?page=${owner.pageId}`).then((r) => r.json());
            return cats.find((c) => c.id === id)?.name ?? 'category-not-on-page';
        }, catId)).toBe('brandnew');

        // Nothing falls through to the orphan block on the dashboard.
        const orphans = await page.evaluate(() =>
            [...document.querySelectorAll('.category-title, .category-header')]
                .map((el) => el.textContent || '').filter((t) => /Unknown category/i.test(t)));
        expect(orphans).toEqual([]);
    });

    test('typing the name of an existing category reuses it instead of duplicating', async ({ page }) => {
        await openBookmarks(page);
        await openFirstEditor(page);

        const sel = page.locator('#new-bookmark-category');
        const existing = sel.locator('option').nth(1);
        const existingId = await existing.getAttribute('value');
        const existingLabel = (await existing.textContent() || '').trim();

        await sel.selectOption('__new__');
        await page.fill('#new-category-create-input', existingLabel);
        await page.click('#new-category-create-ok');

        // Resolved back to the existing category, and no duplicate option added.
        await expect(sel).toHaveValue(existingId || '');
        expect(await sel.locator(`option[value="${existingId}"]`).count()).toBe(1);
    });

    test('editing shows an unsaved marker and Save persists the change', async ({ page }) => {
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

        // Both save bars carry a marker; they move together.
        await expect(page.locator('[data-bm-dirty]').first()).toBeHidden();
        await page.fill('#new-bookmark-note', 'a note from the test');
        await expect(page.locator('[data-bm-dirty]').first()).toBeVisible();
        await expect(page.locator('[data-bm-dirty]').last()).toBeVisible();

        await page.locator("#new-bookmark-create").click();
        await expect.poll(() => posted && posted.some((b) => b.note === 'a note from the test')).toBe(true);
    });

    // The mode inputs are the visually-hidden half of a pill control (the same
    // markup the config panel uses), so drive them by their label the way a
    // person does rather than by checking the input directly.
    test('availability mode reveals the interval only for Monitor', async ({ page }) => {
        await openBookmarks(page);
        await openFirstEditor(page);
        const interval = page.locator('[data-bm-field="monitorIntervalMinutes"]');

        await page.locator('label[for="config-bm-mode-periodic"]').click();
        await expect(page.locator('#config-bm-mode-periodic')).toBeChecked();
        await expect(interval).toBeHidden();

        await page.locator('label[for="config-bm-mode-monitor"]').click();
        await expect(page.locator('#config-bm-mode-monitor')).toBeChecked();
        await expect(interval).toBeVisible();

        await page.locator('label[for="config-bm-mode-off"]').click();
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
        const hint = page.locator('[data-bm-conflict="shortcut"]');
        await page.fill('#new-bookmark-shortcut', String(other));
        await expect(hint).toBeVisible();

        // A free shortcut clears the warning again.
        await page.fill('#new-bookmark-shortcut', 'QQ');
        await expect(hint).toBeHidden();
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
        const url = page.locator('#new-bookmark-url');
        await url.fill('example.com/path');
        await url.blur();
        await expect(url).toHaveValue('https://example.com/path');
    });

    test('a new URL pulls the favicon and fills an empty name', async ({ page }) => {
        await mockMeta(page, { title: 'Fetched Name', icon: 'fetched.png' });
        await openBookmarks(page);
        await openFirstEditor(page);

        await page.fill('#new-bookmark-name', '');
        const url = page.locator('#new-bookmark-url');
        await url.fill('https://example.com/fresh');
        await url.blur();

        await expect(page.locator('#new-bookmark-icon-url')).toHaveValue('fetched.png');
        await expect(page.locator('#new-bookmark-name')).toHaveValue('Fetched Name');
        // Fetching counts as a change, so Save is offered.
        await expect(page.locator('[data-bm-dirty]').first()).toBeVisible();
    });

    test('a name the user already typed is never overwritten', async ({ page }) => {
        await mockMeta(page, { title: 'Should Not Win' });
        await openBookmarks(page);
        await openFirstEditor(page);
        await page.fill('#new-bookmark-name', 'My own name');
        const url = page.locator('#new-bookmark-url');
        await url.fill('https://example.com/other');
        await url.blur();
        await page.waitForTimeout(600);
        await expect(page.locator('#new-bookmark-name')).toHaveValue('My own name');
    });

    test('Retry re-fetches even when an icon is already set', async ({ page }) => {
        await mockMeta(page, { icon: 'retried.png' });
        await openBookmarks(page);
        await openFirstEditor(page);
        await page.fill('#new-bookmark-icon-url', 'old.png');
        await page.click('[data-bm-refetch]');
        await expect(page.locator('#new-bookmark-icon-url')).toHaveValue('retried.png');
    });


    test('a changed URL refreshes the favicon on blur, even with one already set', async ({ page }) => {
        await mockMeta(page, { icon: 'newsite.png', title: 'New Site' });
        await openBookmarks(page);
        await openFirstEditor(page);

        // The row starts with its own icon; changing the URL makes it stale.
        await page.fill('#new-bookmark-icon-url', 'oldsite.png');
        const url = page.locator('#new-bookmark-url');
        await url.fill('https://changed.example.com/page');
        await url.blur();

        await expect(page.locator('#new-bookmark-icon-url')).toHaveValue('newsite.png');
    });

    test('blurring an unchanged URL leaves a hand-picked icon alone', async ({ page }) => {
        await mockMeta(page, { icon: 'should-not-apply.png' });
        await openBookmarks(page);
        await openFirstEditor(page);

        // Type an icon by hand, then leave the URL field without touching the URL.
        await page.fill('#new-bookmark-icon-url', 'mine.png');
        const url = page.locator('#new-bookmark-url');
        await url.click();
        await url.blur();
        await page.waitForTimeout(700);

        await expect(page.locator('#new-bookmark-icon-url')).toHaveValue('mine.png');
    });

    test('completing a bare host to https does not count as a URL change', async ({ page }) => {
        await mockMeta(page, { icon: 'refetched.png' });
        await openBookmarks(page);
        await openFirstEditor(page);

        const current = await page.locator('#new-bookmark-url').inputValue();
        const bare = current.replace(/^https?:\/\//, '');
        await page.fill('#new-bookmark-icon-url', 'keepme.png');
        const url = page.locator('#new-bookmark-url');
        await url.fill(bare);
        await url.blur();
        await page.waitForTimeout(700);

        // Normalised back to the same address, so the icon is not replaced.
        await expect(url).toHaveValue(current);
        await expect(page.locator('#new-bookmark-icon-url')).toHaveValue('keepme.png');
    });

    test('Save and Revert appear both above and below the form', async ({ page }) => {
        await openBookmarks(page);
        await openFirstEditor(page);
        await expect(page.locator('[data-bm-save]')).toHaveCount(2);
        await expect(page.locator('[data-bm-revert]')).toHaveCount(2);
        await expect(page.locator('.config-bm-savebar--top')).toBeVisible();
        await expect(page.locator('.config-bm-savebar--bottom')).toBeVisible();
    });

    test('the pin uses the themed pill, not a bare checkbox', async ({ page }) => {
        await openBookmarks(page);
        await openFirstEditor(page);
        const pin = page.locator('.config-bm-pin');
        await expect(pin).toBeVisible();
        await expect(pin.locator('.icon-toggle-indicator svg')).toBeVisible();
    });

    test('name and URL are wider than the paired fields', async ({ page }) => {
        await openBookmarks(page);
        await openFirstEditor(page);
        const w = (sel) => page.locator(sel).evaluate((el) => el.getBoundingClientRect().width);
        const name = await w('#new-bookmark-name');
        const shortcut = await w('#new-bookmark-shortcut');
        expect(name).toBeGreaterThan(shortcut * 1.5);
        // Paired cells line up with each other.
        const pageSel = await w('#new-bookmark-page');
        const catSel = await w('#new-bookmark-category');
        expect(Math.abs(pageSel - catSel)).toBeLessThan(4);
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
        const opts = await page.locator('#new-bookmark-category option').allTextContents();
        const cats = opts.filter((t) => !/No category|New category/.test(t));
        expect(new Set(cats).size).toBe(cats.length);
    });

    test('the editor selects the bookmark\'s own category', async ({ page }) => {
        await openBookmarks(page);
        const expected = await page.evaluate(() => window.dashboardInstance.allBookmarks[0].category || '');
        await openFirstEditor(page);
        await expect(page.locator('#new-bookmark-category')).toHaveValue(expected);
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

    test('with all pages, rows show a page badge', async ({ page }) => {
        await openBookmarks(page);
        await page.selectOption('#config-bm-page', '');
        await expect(page.locator('.config-bm-page-badge').first()).toBeVisible();
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
        await expect(page.locator('#new-bookmark-modal')).toHaveClass(/show/);
        // The same modal the toolbar and :new use, so its fields must be present.
        await expect(page.locator('#new-bookmark-url')).toBeVisible();
        await expect(page.locator('#new-bookmark-page')).toBeAttached();
    });

    test('preselects the page the list is filtered to', async ({ page }) => {
        await openBookmarks(page);
        const pages = await page.evaluate(() => window.dashboardInstance.pages.map((p) => String(p.id)));
        test.skip(pages.length < 2, 'needs at least two pages');
        // Deliberately a page other than the one being viewed, so passing could
        // not be explained by the modal's own currentPageId default.
        const current = String(await page.evaluate(() => window.dashboardInstance.currentPageId));
        const target = pages.find((id) => id !== current) || pages[1];
        await page.selectOption('#config-bm-page', target);
        await page.locator('#config-bm-add').click();
        await expect(page.locator('#new-bookmark-page')).toHaveValue(target);
    });

    test('a bookmark created in the modal shows up in the config list', async ({ page }) => {
        await openBookmarks(page);
        const before = await page.locator('.config-bm-row').count();
        const stamp = Date.now();
        const name = `Config Add ${stamp}`;

        await page.locator('#config-bm-add').click();
        await expect(page.locator('#new-bookmark-modal')).toHaveClass(/show/);
        // The URL has to be unique per run, not just the name: a fixed one is
        // still in the data after the first run, so every later run is rejected
        // as a duplicate and the modal stays open to show that error.
        await page.fill('#new-bookmark-url', `https://example.com/config-add-test-${stamp}`);
        await page.fill('#new-bookmark-name', name);
        await page.locator('#new-bookmark-form').evaluate((f) => f.requestSubmit());

        // The list must repaint on its own — no reload, no re-opening the section.
        await expect(page.locator('#new-bookmark-modal')).not.toHaveClass(/show/);
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

    test('the editor shows added, open count and last opened', async ({ page }) => {
        await openBookmarks(page);
        await openFirstEditor(page, {
            createdAt: calendarDaysAgo(90),
            openCount: 47,
            lastOpened: calendarDaysAgo(1),
        });

        const stats = page.locator('[data-bm-stats]');
        await expect(stats).toBeVisible();
        await expect(stats).toContainText('47×');
        // 26h back is the previous calendar day, so the shared formatter says so.
        await expect(stats).toContainText(/yesterday/i);
    });

    test('relative labels interpolate their count', async ({ page }) => {
        await openBookmarks(page);
        const threeHoursAgo = hoursAgoOnSameDay(3);
        const twentyMinAgo = Date.now() - 20 * 60 * 1000;
        const expectedHours = await page.evaluate((ts) => window.formatLastOpened(ts).label, threeHoursAgo);
        const expectedMinutes = await page.evaluate((ts) => window.formatLastOpened(ts).label, twentyMinAgo);
        // Hours and minutes are the two labels carrying a {count}; the config
        // t() drops params, so an unwrapped translator leaks the placeholder.
        await openFirstEditor(page, { openCount: 5, lastOpened: threeHoursAgo, lastChecked: 0 });
        await expect.poll(async () => {
            await applyBookmarkStats(page, { openCount: 5, lastOpened: threeHoursAgo, lastChecked: 0 });
            return page.locator('[data-bm-stats]').innerText();
        }).toContain(expectedHours);
        await expect(page.locator('[data-bm-stats]')).not.toContainText('{count}');

        await page.evaluate(() => {
            const cfg = window.dashboardInstance.config;
            cfg.bmEditing = null;
            cfg.bmDirty = false;
            cfg.repaintBookmarksList();
        });
        await openFirstEditor(page, { openCount: 5, lastOpened: twentyMinAgo });
        await expect.poll(async () => {
            await applyBookmarkStats(page, { openCount: 5, lastOpened: twentyMinAgo });
            return page.locator('[data-bm-stats]').innerText();
        }).toContain(expectedMinutes);
        await expect(page.locator('[data-bm-stats]')).not.toContainText('{count}');
    });

    test('shows when the bookmark was last modified', async ({ page }) => {
        await openBookmarks(page);
        await openFirstEditor(page, { updatedAt: calendarDaysAgo(1) });
        const stats = page.locator('[data-bm-stats]');
        await expect(stats).toContainText(/modified/i);
        await expect(stats).toContainText(/yesterday/i);
    });

    test('a bookmark predating updatedAt shows a dash, not an invented date', async ({ page }) => {
        await openBookmarks(page);
        await openFirstEditor(page, { updatedAt: 0 });
        const row = page.locator('.config-bm-stat', { hasText: /modified/i });
        await expect(row.locator('.config-bm-stat-value')).toHaveText('—');
    });

    test('a never-opened bookmark says so instead of showing a blank', async ({ page }) => {
        await openBookmarks(page);
        await expect.poll(async () => {
            await seedStats(page, { openCount: 0, lastOpened: 0, createdAt: 0 });
            return page.locator('.config-bm-usage.is-never').first().innerText();
        }).toMatch(/never opened/i);
    });

    test('the collapsed row carries the usage summary', async ({ page }) => {
        await openBookmarks(page);
        await expect.poll(async () => {
            await seedStats(page, { openCount: 12, lastOpened: Date.now() - 5 * 60 * 1000 });
            return page.locator('.config-bm-usage').first().innerText();
        }).toContain('12×');
    });

    test('last checked appears only once the bookmark has been checked', async ({ page }) => {
        await openBookmarks(page);
        await openFirstEditor(page, { lastChecked: 0, lastError: '' });
        await expect(page.locator('[data-bm-stats]')).not.toContainText(/last checked/i);

        await page.evaluate(() => {
            const cfg = window.dashboardInstance.config;
            cfg.bmEditing = null;
            cfg.bmDirty = false;
            cfg.repaintBookmarksList();
        });
        await openFirstEditor(page, { lastChecked: Date.now() - 2 * 60 * 60 * 1000, lastError: '' });
        await expect(page.locator('[data-bm-stats]')).toContainText(/last checked/i);
    });

    test('saving an edit does not clear the statistics', async ({ page }) => {
        await openBookmarks(page);
        await openFirstEditor(page, { openCount: 33, lastOpened: Date.now() - 3 * 60 * 60 * 1000 });

        // The whole feature rests on the save spreading form fields over the
        // stored record: bind a stat to an input and it would be wiped here.
        await page.locator('#new-bookmark-note').fill('stats must survive');
        await page.locator("#new-bookmark-create").click();
        await expect(page.locator('#new-bookmark-modal.show')).toHaveCount(0);

        await expect.poll(() => page.evaluate(() => {
            const key = window.dashboardInstance.config.bmEditing
                || document.querySelector('#config-bm-list .config-bm-row[data-bm-key]')?.getAttribute('data-bm-key');
            const parsed = window.dashboardInstance.config.parseBookmarkKey(key);
            return window.dashboardInstance.allBookmarks.find(
                (b) => String(b.pageId) === String(parsed.pageId) && b.url === parsed.url,
            )?.openCount;
        })).toBe(33);
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
        const cat = await page.evaluate(() =>
            (window.dashboardInstance.allBookmarks.find((b) => b.category) || {}).category || '');
        test.skip(!cat, 'needs a categorised bookmark');

        await page.selectOption('#config-bm-category', cat);
        const shown = await page.locator('.config-bm-row').count();
        const total = await page.evaluate(() => window.dashboardInstance.allBookmarks.length);
        test.skip(shown >= total, 'filter did not narrow the list');

        // Acting on bookmarks you cannot see is how a bulk delete goes wrong.
        await page.locator('#config-bm-select-all').click();
        await expect.poll(() => page.evaluate(() =>
            window.dashboardInstance.config.bmSelected.size)).toBe(shown);
    });
});
