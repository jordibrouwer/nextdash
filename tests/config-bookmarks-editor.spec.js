// @ts-check
const { test, expect } = require('./fixtures');
const {
    dismissOnboardingIfPresent, dismissBlockingOverlays, resetDashboardData, markWhatsNewSeen, WRITE_TOKEN,
} = require('./e2e-helpers');

async function loadDashboard(page) {
    // Before the first navigation: the promo cards and the What's new modal
    // are decided on load. Without this the config-setting promo lands on the
    // page mid-test, moves the modal's Save button a few pixels, and Playwright
    // waits for an element that never settles.
    await markWhatsNewSeen(page);
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

/** Put the cursor on the first row and press `e`; returns the panel. */
async function openFirstEditor(page, stats = null) {
    await applyBookmarkStats(page, stats);
    // The list answers j with nothing focused; a click on its corner can land
    // under the sticky view header once the page has scrolled.
    await page.evaluate(() => document.activeElement?.blur?.());
    await page.keyboard.press('j');
    await expect(page.locator('#config-bm-list .config-bm-row.keyboard-selected')).toHaveCount(1);
    await page.keyboard.press('e');
    const panel = page.locator('#config-bm-panel');
    await expect(panel).toHaveAttribute('data-bm-panel-mode', 'single');
    return panel;
}

/** Capture page writes instead of storing them. */
async function capturePosts(page) {
    const posts = [];
    await page.route('**/api/bookmarks?page=*', async (route) => {
        if (route.request().method() === 'POST') {
            posts.push(JSON.parse(route.request().postData() || '[]'));
            return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
        }
        return route.fallback();
    });
    return posts;
}

/** Sort the list flat, so each row carries its own page › category crumb. */
async function sortFlat(page) {
    await page.selectOption('#config-bm-sort', 'name');
    await expect(page.locator('#config-bm-list .config-bm-feed')).not.toHaveClass(/is-grouped/);
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

test.describe('config bookmarks editor', () => {
    test('the panel carries every field of a bookmark', async ({ page }) => {
        await openBookmarks(page);
        const panel = await openFirstEditor(page);
        for (const name of ['name', 'url', 'page', 'category', 'tags', 'shortcut', 'note', 'pinned', 'checkMode']) {
            await expect(panel.locator(`[data-bm-field="${name}"]`)).toHaveCount(1);
        }
    });

    test('leaving an edited field saves it', async ({ page }) => {
        const posts = await capturePosts(page);
        await openBookmarks(page);
        const panel = await openFirstEditor(page);
        await panel.locator('[data-bm-field="note"]').fill('a note from the test');
        await page.keyboard.press('Tab');
        await expect.poll(() => posts.some((list) => list.some((b) => b.note === 'a note from the test'))).toBe(true);
    });

    test('ticking two rows turns the panel into the bulk form', async ({ page }) => {
        await openBookmarks(page);
        await page.locator('[data-bm-tick]').first().check();
        await page.locator('[data-bm-tick]').nth(1).check();
        const panel = page.locator('#config-bm-panel');
        await expect(panel).toHaveAttribute('data-bm-panel-mode', 'bulk');
        for (const a of ['apply', 'export', 'favicons', 'delete', 'clear']) {
            await expect(panel.locator(`[data-bm-bulk-action="${a}"]`)).toBeVisible();
        }
    });

    test('bulk tags posts the tag onto every ticked bookmark', async ({ page }) => {
        const posts = await capturePosts(page);
        await openBookmarks(page);
        await page.locator('[data-bm-tick]').first().check();
        await page.locator('[data-bm-tick]').nth(1).check();
        await page.fill('#config-bm-panel [data-bm-bulk-field="tags"]', 'bulktag');
        await page.click('#config-bm-panel [data-bm-bulk-action="apply"]');
        await expect.poll(() => posts.some((list) =>
            list.some((b) => (b.tags || []).includes('bulktag')))).toBe(true);
    });

    test('the toolbar sorts', async ({ page }) => {
        await openBookmarks(page);
        await expect(page.locator('#config-bm-sort')).toBeVisible();
        await page.selectOption('#config-bm-sort', 'name');
        const names = await page.locator('.config-bm-title').allTextContents();
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
        const posts = await capturePosts(page);
        await openBookmarks(page);
        const panel = await openFirstEditor(page);
        await panel.locator('[data-bm-field="url"]').fill('example.com/path');
        await page.keyboard.press('Tab');
        await expect.poll(() => posts.some((list) => list.some((b) => b.url === 'https://example.com/path'))).toBe(true);
    });

    test('a name the user already typed is never overwritten', async ({ page }) => {
        await mockMeta(page, { title: 'Should Not Win' });
        await openBookmarks(page);
        await page.locator('#config-bm-add').click();
        await expect(page.locator('#bookmark-form-modal')).toHaveClass(/show/);
        const form = bookmarkModalForm(page);
        await form.locator('.bookmark-inline-input').first().fill('My own name');
        const url = form.locator('input[type="url"]');
        await url.fill('https://example.com/other');
        await url.blur();
        await page.waitForTimeout(600);
        await expect(form.locator('.bookmark-inline-input').first()).toHaveValue('My own name');
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

        const rail = await page.locator('#config-bm-rail [data-bm-rail="category"] .config-bm-rail-label').allTextContents();
        expect(new Set(rail).size).toBe(rail.length);
        // No id/name pair such as "development" alongside "Development".
        const lowered = rail.map((t) => t.toLowerCase());
        expect(new Set(lowered).size).toBe(lowered.length);

        const panel = await openFirstEditor(page);
        const opts = await panel.locator('[data-bm-field="category"] option').allTextContents();
        const cats = opts.slice(1);
        expect(new Set(cats).size).toBe(cats.length);
    });

    test('the panel selects the bookmark\'s own category', async ({ page }) => {
        await openBookmarks(page);
        const composite = await page.evaluate(() => {
            const b = window.dashboardInstance.allBookmarks.find((bm) => bm.category);
            return b ? `${b.pageId}::${b.category}` : '';
        });
        test.skip(!composite, 'needs a categorised bookmark');
        await page.locator(`#config-bm-rail [data-bm-rail="category"][data-value="${composite}"]`).click();
        const panel = await openFirstEditor(page);
        await expect(panel.locator('[data-bm-field="category"]')).toHaveValue(composite.split('::')[1]);
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
        await page.locator(`#config-bm-rail [data-bm-rail="category"][data-value="${composite}"]`).click();
        const expected = await page.evaluate(({ pageId, category }) =>
            window.dashboardInstance.allBookmarks.filter((b) =>
                String(b.pageId) === pageId && String(b.category || '') === category).length,
        meta);
        await expect(page.locator('.config-bm-row')).toHaveCount(expected);
    });

    test('the rail lists only categories from the selected page', async ({ page }) => {
        await openBookmarks(page);
        const pages = await page.evaluate(() => window.dashboardInstance.pages.map((p) => String(p.id)));
        test.skip(pages.length < 2, 'needs at least two pages');

        const targetPage = pages[1];
        await page.locator(`#config-bm-rail [data-bm-rail="page"][data-value="${targetPage}"]`).click();
        await expect.poll(async () => {
            const values = await page.locator('#config-bm-rail [data-bm-rail="category"]')
                .evaluateAll((els) => els.map((el) => el.getAttribute('data-value')));
            return values.every((v) => v.startsWith(`${targetPage}::`));
        }).toBe(true);
    });

    test('with all pages, category labels include the page name', async ({ page }) => {
        await openBookmarks(page);
        const labels = await page.locator('#config-bm-rail [data-bm-rail="category"] .config-bm-rail-label').allTextContents();
        test.skip(!labels.length, 'needs a categorised bookmark');
        expect(labels.every((l) => l.includes('›'))).toBe(true);
    });

    test('in a flat sort, a row without a category still names its page', async ({ page }) => {
        await openBookmarks(page);
        await sortFlat(page);
        const key = await page.evaluate(() => {
            const cfg = window.dashboardInstance.config;
            const bm = cfg.visibleBookmarks()[0];
            bm.category = '';
            cfg.repaintBookmarksList();
            return cfg.bookmarkKey(bm);
        });
        const row = page.locator(`.config-bm-row[data-bm-key="${key}"]`);
        const pageName = await page.evaluate((k) => {
            const cfg = window.dashboardInstance.config;
            return cfg.pageLabel(cfg.findBookmarkByKey(k).pageId);
        }, key);
        await expect(row.locator('.config-bm-crumb')).toHaveText(pageName);
    });

    test('in a flat sort, a categorised row reads page then category', async ({ page }) => {
        await openBookmarks(page);
        await sortFlat(page);
        const expected = await page.evaluate(() => {
            const cfg = window.dashboardInstance.config;
            const bm = cfg.visibleBookmarks().find((b) => b.category);
            if (!bm) return null;
            return { key: cfg.bookmarkKey(bm), label: `${cfg.pageLabel(bm.pageId)} › ${cfg.railCategoryLabel(bm.pageId, bm.category)}` };
        });
        test.skip(!expected, 'needs a categorised bookmark');
        const row = page.locator(`.config-bm-row[data-bm-key="${expected.key}"]`);
        await expect(row.locator('.config-bm-crumb')).toHaveText(expected.label);
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
        await page.locator(`#config-bm-rail [data-bm-rail="page"][data-value="${target}"]`).click();
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
        // Two ticked rows, the categorised one among them: the bulk form only
        // appears for a selection of more than one.
        await page.evaluate((cat) => {
            const cfg = window.dashboardInstance.config;
            const all = window.dashboardInstance.allBookmarks;
            const bm = all.find((b) => b.category === cat);
            const other = all.find((b) => b !== bm && String(b.pageId) === String(bm.pageId) && b.category === cat)
                || all.find((b) => b !== bm);
            cfg.bmSelected.add(cfg.bookmarkKey(bm));
            cfg.bmSelected.add(cfg.bookmarkKey(other));
            cfg.afterSelectionChange();
        }, source);

        const panel = page.locator('#config-bm-panel');
        await expect(panel).toHaveAttribute('data-bm-panel-mode', 'bulk');
        // Category first: the target page has never used it, so its own list
        // does not offer it until it is the chosen one.
        await panel.locator('[data-bm-bulk-field="category"]').selectOption(source);
        await panel.locator('[data-bm-bulk-field="page"]').selectOption(target);
        await panel.locator('[data-bm-bulk-action="apply"]').click();

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

    test('a never-opened bookmark says so instead of showing a blank', async ({ page }) => {
        await openBookmarks(page);
        await expect.poll(async () => {
            await seedStats(page, { openCount: 0, lastOpened: 0, createdAt: 0 });
            return page.locator('.config-bm-row').first().locator('.config-bm-last').innerText();
        }).toMatch(/never/i);
    });

    test('the row carries the open count', async ({ page }) => {
        await openBookmarks(page);
        await expect.poll(async () => {
            await seedStats(page, { openCount: 12, lastOpened: Date.now() - 5 * 60 * 1000 });
            return page.locator('.config-bm-row').first().locator('.config-bm-opens').innerText();
        }).toBe('12');
    });

    test('saving an edit does not clear the statistics', async ({ page }) => {
        await openBookmarks(page);

        // Seed the count on the *server*, the way an open does. Seeding it into
        // the browser's copy proves nothing: the dashboard does not send
        // openCount when it saves a page, so the value never reaches the
        // server, and carryServerOwnedBookmarkFields then puts the stored one
        // back — which is exactly the protection this test is here to check.
        const target = await page.evaluate(() => {
            const cfg = window.dashboardInstance.config;
            const key = document.querySelector('#config-bm-list .config-bm-row[data-bm-key]')
                ?.getAttribute('data-bm-key');
            const parsed = key ? cfg.parseBookmarkKey(key) : null;
            const bm = parsed
                ? window.dashboardInstance.allBookmarks.find(
                    (b) => String(b.pageId) === String(parsed.pageId) && b.url === parsed.url)
                : cfg.visibleBookmarks()[0];
            const onPage = window.dashboardInstance.allBookmarks
                .filter((b) => String(b.pageId) === String(bm.pageId));
            return { pageId: bm.pageId, url: bm.url, index: onPage.findIndex((b) => b.url === bm.url) };
        });
        expect(target.index).toBeGreaterThanOrEqual(0);

        const OPENS = 3;
        for (let i = 0; i < OPENS; i += 1) {
            const response = await page.request.post('/api/track-open', {
                headers: { 'X-NextDash-Token': WRITE_TOKEN },
                data: { pageId: target.pageId, index: target.index },
            });
            expect(response.ok()).toBe(true);
        }

        const readStoredCount = async () => {
            const response = await page.request.get(`/api/bookmarks?page=${target.pageId}`);
            const list = await response.json();
            return (list.find((b) => b.url === target.url) || {}).openCount;
        };
        expect(await readStoredCount()).toBe(OPENS);

        const panel = await openFirstEditor(page);
        await panel.locator('[data-bm-field="note"]').fill('stats must survive');
        await page.keyboard.press('Tab');

        // The note landed, so the save really happened...
        await expect.poll(async () => {
            const response = await page.request.get(`/api/bookmarks?page=${target.pageId}`);
            const list = await response.json();
            return (list.find((b) => b.url === target.url) || {}).note;
        }).toBe('stats must survive');
        // ...and it did not take the count with it.
        expect(await readStoredCount()).toBe(OPENS);
    });
});

test.describe('the list keyboard', () => {
    /*
     * The list has to answer "down" with nothing focused.
     *
     * A page opens with focus on <body>, and the gate asked for focus inside
     * the list before it would hand the keys over -- so the first press fell
     * through to the config section shortcut and moved to Appearance. The
     * reader had to click a row before the keyboard reached the list, which is
     * the thing a keyboard user is avoiding.
     */
    test('the arrows and j/k walk the rows with nothing focused', async ({ page }) => {
        await openBookmarks(page);
        await expect(page.locator('.config-bm-row').first()).toBeVisible({ timeout: 15_000 });
        await page.evaluate(() => {
            const cfg = window.dashboardInstance.config?.instance || window.dashboardInstance.config;
            cfg._bmKeyboardKey = null;
            cfg.applyBookmarkKeyboardSelection(cfg.getBookmarkKeyboardRows());
            document.activeElement?.blur?.();
        });

        const cursor = () => page.evaluate(() => {
            const cfg = window.dashboardInstance.config?.instance || window.dashboardInstance.config;
            return { key: cfg._bmKeyboardKey, section: cfg.section };
        });

        await page.keyboard.press('ArrowDown');
        const first = await cursor();
        expect(first.key).toBeTruthy();
        // And it stayed here: the same press used to move to the next section.
        expect(first.section).toBe('bookmarks');

        await page.keyboard.press('ArrowDown');
        const second = await cursor();
        expect(second.key).not.toBe(first.key);

        await page.keyboard.press('ArrowUp');
        expect((await cursor()).key).toBe(first.key);

        // j and k are the same movement under another name.
        await page.keyboard.press('j');
        expect((await cursor()).key).toBe(second.key);
        await page.keyboard.press('k');
        expect((await cursor()).key).toBe(first.key);

        await expect(page.locator('.config-bm-row.keyboard-selected')).toHaveCount(1);
    });

    test('the arrows still belong to the search box', async ({ page }) => {
        await openBookmarks(page);
        await expect(page.locator('.config-bm-row').first()).toBeVisible({ timeout: 15_000 });
        await page.evaluate(() => {
            const cfg = window.dashboardInstance.config?.instance || window.dashboardInstance.config;
            cfg._bmKeyboardKey = null;
        });
        await page.locator('#config-bm-search').fill('ab');
        await page.locator('#config-bm-search').press('ArrowUp');
        // Caret movement, not row movement: a text field owes the reader its
        // own arrows.
        expect(await page.evaluate(() => {
            const cfg = window.dashboardInstance.config?.instance || window.dashboardInstance.config;
            return cfg._bmKeyboardKey;
        })).toBeFalsy();
        await expect(page.locator('#config-bm-search')).toBeFocused();
    });

    /*
     * A search box that refuses letters is not a search box.
     *
     * j, k, g, G, Enter and space used to be handed to the list from inside the
     * field: typing one left the box and moved the row cursor, so github, json
     * and jira could not be searched for, and a space opened whatever the
     * cursor happened to be on.
     */
    test('the search box keeps its letters', async ({ page }) => {
        await openBookmarks(page);
        const search = page.locator('#config-bm-search');
        await search.click();
        await search.fill('');
        await page.keyboard.type('github');

        await expect(search).toHaveValue('github');
        await expect(search).toBeFocused();
        expect(await page.evaluate(() => {
            const cfg = window.dashboardInstance.config?.instance || window.dashboardInstance.config;
            return cfg._bmKeyboardKey;
        })).toBeFalsy();
        await search.fill('');
    });

});
