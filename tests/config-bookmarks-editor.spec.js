// @ts-check
const { test, expect } = require('@playwright/test');
const { dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

async function openBookmarks(page) {
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.allBookmarks?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.evaluate(() => window.dashboardInstance.config.openConfigView('bookmarks'));
    await expect(page.locator('#config-bm-list')).toBeVisible();
}

async function openFirstEditor(page) {
    await page.locator('[data-bm-edit]').first().click();
    await expect(page.locator('.config-bm-editor')).toBeVisible();
}

test.describe('config bookmarks editor', () => {
    test('the editor carries every field the old detail panel had', async ({ page }) => {
        await openBookmarks(page);
        await openFirstEditor(page);
        for (const f of ['name', 'url', 'pageId', 'category', 'tags', 'shortcut', 'note', 'pinned', 'icon']) {
            await expect(page.locator(`[data-bm-field="${f}"]`)).toBeVisible();
        }
        // Availability checking with its three modes.
        await expect(page.locator('input[name="config-bm-mode"]')).toHaveCount(3);
        // Icon and link-preview controls.
        await expect(page.locator('[data-bm-icon="upload"]')).toBeVisible();
        await expect(page.locator('[data-bm-icon="clear"]')).toBeVisible();
        await expect(page.locator('[data-bm-preview="refresh"]')).toBeVisible();
        await expect(page.locator('[data-bm-preview="clear"]')).toBeVisible();
        // An explicit save, not a save-on-blur — offered at both ends of the form.
        await expect(page.locator('[data-bm-save]').first()).toBeVisible();
    });

    test('category is a dropdown of existing categories and can add a new one', async ({ page }) => {
        await openBookmarks(page);
        await openFirstEditor(page);
        const sel = page.locator('[data-bm-field="category"]');
        // More than just the blank option: real categories plus the "new" entry.
        expect(await sel.locator('option').count()).toBeGreaterThan(2);
        await expect(sel.locator('option[value="__new__"]')).toHaveCount(1);

        await sel.selectOption('__new__');
        await expect(page.locator('[data-bm-newcat]')).toBeVisible();
        await page.fill('[data-bm-newcat-input]', 'freshcat');
        await page.click('[data-bm-newcat-ok]');
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

        const sel = page.locator('[data-bm-field="category"]');
        await sel.selectOption('__new__');
        await page.fill('[data-bm-newcat-input]', 'brandnew');
        await page.click('[data-bm-newcat-ok]');
        const catId = await sel.inputValue();

        await page.locator('[data-bm-save]').first().click();
        await expect(page.locator('.config-bm-editor')).toBeHidden();

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

        const sel = page.locator('[data-bm-field="category"]');
        const existing = sel.locator('option').nth(1);
        const existingId = await existing.getAttribute('value');
        const existingLabel = (await existing.textContent() || '').trim();

        await sel.selectOption('__new__');
        await page.fill('[data-bm-newcat-input]', existingLabel);
        await page.click('[data-bm-newcat-ok]');

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
        await page.fill('[data-bm-field="note"]', 'a note from the test');
        await expect(page.locator('[data-bm-dirty]').first()).toBeVisible();
        await expect(page.locator('[data-bm-dirty]').last()).toBeVisible();

        await page.locator('[data-bm-save]').first().click();
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
        await page.fill('[data-bm-field="shortcut"]', String(other));
        await expect(hint).toBeVisible();

        // A free shortcut clears the warning again.
        await page.fill('[data-bm-field="shortcut"]', 'QQ');
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
        const url = page.locator('[data-bm-field="url"]');
        await url.fill('example.com/path');
        await url.blur();
        await expect(url).toHaveValue('https://example.com/path');
    });

    test('a new URL pulls the favicon and fills an empty name', async ({ page }) => {
        await mockMeta(page, { title: 'Fetched Name', icon: 'fetched.png' });
        await openBookmarks(page);
        await openFirstEditor(page);

        await page.fill('[data-bm-field="name"]', '');
        const url = page.locator('[data-bm-field="url"]');
        await url.fill('https://example.com/fresh');
        await url.blur();

        await expect(page.locator('[data-bm-field="icon"]')).toHaveValue('fetched.png');
        await expect(page.locator('[data-bm-field="name"]')).toHaveValue('Fetched Name');
        // Fetching counts as a change, so Save is offered.
        await expect(page.locator('[data-bm-dirty]').first()).toBeVisible();
    });

    test('a name the user already typed is never overwritten', async ({ page }) => {
        await mockMeta(page, { title: 'Should Not Win' });
        await openBookmarks(page);
        await openFirstEditor(page);
        await page.fill('[data-bm-field="name"]', 'My own name');
        const url = page.locator('[data-bm-field="url"]');
        await url.fill('https://example.com/other');
        await url.blur();
        await page.waitForTimeout(600);
        await expect(page.locator('[data-bm-field="name"]')).toHaveValue('My own name');
    });

    test('Retry re-fetches even when an icon is already set', async ({ page }) => {
        await mockMeta(page, { icon: 'retried.png' });
        await openBookmarks(page);
        await openFirstEditor(page);
        await page.fill('[data-bm-field="icon"]', 'old.png');
        await page.click('[data-bm-refetch]');
        await expect(page.locator('[data-bm-field="icon"]')).toHaveValue('retried.png');
    });


    test('a changed URL refreshes the favicon on blur, even with one already set', async ({ page }) => {
        await mockMeta(page, { icon: 'newsite.png', title: 'New Site' });
        await openBookmarks(page);
        await openFirstEditor(page);

        // The row starts with its own icon; changing the URL makes it stale.
        await page.fill('[data-bm-field="icon"]', 'oldsite.png');
        const url = page.locator('[data-bm-field="url"]');
        await url.fill('https://changed.example.com/page');
        await url.blur();

        await expect(page.locator('[data-bm-field="icon"]')).toHaveValue('newsite.png');
    });

    test('blurring an unchanged URL leaves a hand-picked icon alone', async ({ page }) => {
        await mockMeta(page, { icon: 'should-not-apply.png' });
        await openBookmarks(page);
        await openFirstEditor(page);

        // Type an icon by hand, then leave the URL field without touching the URL.
        await page.fill('[data-bm-field="icon"]', 'mine.png');
        const url = page.locator('[data-bm-field="url"]');
        await url.click();
        await url.blur();
        await page.waitForTimeout(700);

        await expect(page.locator('[data-bm-field="icon"]')).toHaveValue('mine.png');
    });

    test('completing a bare host to https does not count as a URL change', async ({ page }) => {
        await mockMeta(page, { icon: 'refetched.png' });
        await openBookmarks(page);
        await openFirstEditor(page);

        const current = await page.locator('[data-bm-field="url"]').inputValue();
        const bare = current.replace(/^https?:\/\//, '');
        await page.fill('[data-bm-field="icon"]', 'keepme.png');
        const url = page.locator('[data-bm-field="url"]');
        await url.fill(bare);
        await url.blur();
        await page.waitForTimeout(700);

        // Normalised back to the same address, so the icon is not replaced.
        await expect(url).toHaveValue(current);
        await expect(page.locator('[data-bm-field="icon"]')).toHaveValue('keepme.png');
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
        const name = await w('[data-bm-field="name"]');
        const shortcut = await w('[data-bm-field="shortcut"]');
        expect(name).toBeGreaterThan(shortcut * 1.5);
        // Paired cells line up with each other.
        const pageSel = await w('[data-bm-field="pageId"]');
        const catSel = await w('[data-bm-field="category"]');
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
        const opts = await page.locator('[data-bm-field="category"] option').allTextContents();
        const cats = opts.filter((t) => !/No category|New category/.test(t));
        expect(new Set(cats).size).toBe(cats.length);
    });

    test('the editor selects the bookmark\'s own category', async ({ page }) => {
        await openBookmarks(page);
        const expected = await page.evaluate(() => window.dashboardInstance.allBookmarks[0].category || '');
        await openFirstEditor(page);
        await expect(page.locator('[data-bm-field="category"]')).toHaveValue(expected);
    });

    test('filtering by a category keeps only its bookmarks', async ({ page }) => {
        await openBookmarks(page);
        const id = await page.evaluate(() =>
            (window.dashboardInstance.allBookmarks.find((b) => b.category) || {}).category || '');
        test.skip(!id, 'needs a categorised bookmark');
        await page.selectOption('#config-bm-category', id);
        const shown = await page.locator('.config-bm-row').count();
        const expected = await page.evaluate((c) =>
            window.dashboardInstance.allBookmarks.filter((b) => (b.category || '') === c).length, id);
        expect(shown).toBe(expected);
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
        const name = `Config Add ${Date.now()}`;

        await page.locator('#config-bm-add').click();
        await expect(page.locator('#new-bookmark-modal')).toHaveClass(/show/);
        await page.fill('#new-bookmark-url', 'https://example.com/config-add-test');
        await page.fill('#new-bookmark-name', name);
        await page.locator('#new-bookmark-form').evaluate((f) => f.requestSubmit());

        // The list must repaint on its own — no reload, no re-opening the section.
        await expect(page.locator('#new-bookmark-modal')).not.toHaveClass(/show/);
        await expect(page.locator('.config-bm-row')).toHaveCount(before + 1);
        await expect(page.locator('#config-bm-list')).toContainText(name);
    });
});
