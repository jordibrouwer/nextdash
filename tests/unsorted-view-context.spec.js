// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * What the Unsorted view does with a row, as opposed to what the dashboard does
 * with one: a shorter context menu, tags that do not publish the bookmark, and
 * a category that files it.
 */

/**
 * Every test seeds rows of its own.
 *
 * The store is reset once per file, not per test, and two of these tests take
 * a row out of the unsorted page for good — one promotes it, another tags it.
 * Sharing one fixture set made each test depend on which ones ran before it,
 * which is how it first failed: the bulk test found one row where it wanted
 * two, because the promote test had already filed the other.
 */
function keptPair(slug) {
    return [
        { name: `Ctx ${slug} One`, url: `https://ctx-${slug}-one.example/a`, createdAt: 5000 },
        { name: `Ctx ${slug} Two`, url: `https://ctx-${slug}-two.example/b`, createdAt: 4000 },
    ];
}

async function bootstrap(page, kept = []) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });
    // How the kept list is read is a setting now, so it outlives a test and
    // the next one would inherit a grouping it never chose.
    await page.evaluate(async () => {
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        await api('/api/settings', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ unsortedSort: 'added-desc', unsortedGroup: 'none' }),
        });
        const s = window.dashboardInstance?.settings;
        if (s) { s.unsortedSort = 'added-desc'; s.unsortedGroup = 'none'; }
        const u = window.dashboardInstance?.unsorted;
        if (u) { u.sort = 'added-desc'; u.groupBy = 'none'; u.searchQuery = ''; u.brokenOnly = false; }
    });
    await seedKept(page, kept);
}

async function seedKept(page, kept) {
    if (!kept.length) return;
    await page.evaluate(async (items) => {
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        for (const bookmark of items) {
            await api('/api/bookmarks/add', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ page: 999999, bookmark: { category: '', ...bookmark } }),
            });
        }
    }, kept);
}

/** A tag only exists once something carries it, so the popover has a row to offer. */
async function seedPageTag(page, tag) {
    await page.evaluate(async ({ tagName }) => {
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        await api('/api/bookmarks/add', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                page: 1,
                bookmark: {
                    name: `Seed ${tagName}`, url: `https://seed-${tagName}.example/`,
                    category: '', tags: [tagName],
                },
            }),
        });
    }, { tagName: tag });
    await page.reload();
    await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });
}

async function openUnsorted(page) {
    await page.keyboard.down('Shift');
    await page.keyboard.press('KeyU');
    await page.keyboard.up('Shift');
    await expect(page.locator('.unsorted-view')).toBeVisible();
    await expect(page.locator('.unsorted-view-search-input')).toBeVisible();
    // And the rows themselves: the list loads with the inbox, so the toolbar
    // is on screen a moment before what it describes.
    await expect(page.locator('.bookmark-link[data-unsorted-key]').first()).toBeVisible();
}

/**
 * Right-click a row once it can answer.
 *
 * The menu is bound per row as the grid renders (data-context-menu-bound), and
 * every keystroke in the search box rebuilds the grid — a right-click landing
 * in the gap between the row appearing and its binding does nothing at all,
 * which is how this first failed.
 */
async function openRowMenu(page, row) {
    await expect(row).toHaveAttribute('data-context-menu-bound', '1');
    // Dispatched rather than clicked with the mouse: a real right-click leaves
    // the pointer resting on the row, and the hover preview card that opens a
    // moment later covers the very row the next step wants to act on. The
    // handler under test is the row's own contextmenu listener either way.
    await row.evaluate((node) => {
        const rect = node.getBoundingClientRect();
        node.dispatchEvent(new MouseEvent('contextmenu', {
            bubbles: true,
            cancelable: true,
            clientX: Math.round(rect.left + 20),
            clientY: Math.round(rect.top + 5),
        }));
    });
    await expect(page.locator('#bookmark-context-menu')).toBeVisible();
}

/** The action ids the row menu is offering right now. */
function menuActions(page) {
    return page.locator('#bookmark-context-menu [data-action]').evaluateAll(
        (nodes) => nodes.map((node) => node.getAttribute('data-action')));
}

test('the unsorted row menu drops what does not apply there', async ({ page }) => {
    await bootstrap(page, keptPair('menu'));
    await openUnsorted(page);
    await page.locator('.unsorted-view-search-input').fill('ctx-menu-');

    await openRowMenu(page, page.locator('.bookmark-link[data-unsorted-key]').first());

    const actions = await menuActions(page);
    expect(actions).toEqual(expect.arrayContaining(['edit', 'tags', 'delete', 'copy-url']));
    // Pin orders within a category and both health entries speak for the filed
    // library — none of the three mean anything on a bookmark that has not been
    // filed yet.
    expect(actions).not.toContain('pin');
    expect(actions).not.toContain('check-mode');
    expect(actions).not.toContain('health');
    // Filing is what this list is for, so the two ways out are here: onto a
    // page, or back into the queue it came from.
    expect(actions).toContain('move');
    expect(actions).toContain('unsorted-to-inbox');
});

test('Shift+M does not open the move popover from Unsorted either', async ({ page }) => {
    await bootstrap(page, keptPair('kbd'));
    await openUnsorted(page);
    await page.locator('.unsorted-view-search-input').fill('ctx-kbd-');

    await page.evaluate(() => {
        const row = document.querySelector('.bookmark-link[data-unsorted-key]');
        const bookmark = window.dashboardInstance.unsorted._bookmarks[0];
        // The same call Shift+M makes, with the guard being the thing under test.
        void window.dashboardInstance.showMovePopover(row, bookmark, -1);
    });

    await expect(page.locator('#move-popover')).toHaveCount(0);
});

test('the dashboard row menu is untouched', async ({ page }) => {
    await bootstrap(page, keptPair('dash'));

    await page.locator('#dashboard-layout .bookmark-link').first().click({ button: 'right' });
    await expect(page.locator('#bookmark-context-menu')).toBeVisible();

    const actions = await menuActions(page);
    expect(actions).toEqual(expect.arrayContaining(
        ['edit', 'tags', 'delete', 'pin', 'move', 'check-mode', 'health']));
});

test('tagging from Unsorted stays in Unsorted and reaches the grid', async ({ page }) => {
    await bootstrap(page, keptPair('tag'));
    // The popover offers the tags the library already knows, so one has to
    // exist before a row can be given it.
    await seedPageTag(page, 'uvctag');
    await openUnsorted(page);
    await page.locator('.unsorted-view-search-input').fill('ctx-tag-one');

    await openRowMenu(page, page.locator('.bookmark-link[data-unsorted-key]').first());
    await page.locator('#bookmark-context-menu [data-action="tags"]').click();
    await expect(page.locator('#tag-popover')).toBeVisible();

    await page.locator('#tag-popover [data-tag="uvctag"]').click();

    // The view is the thing that must not move.
    await expect(page.locator('.inbox-body-kept.unsorted-view')).toBeVisible();
    expect(new URL(page.url()).hash).toBe('#unsorted');

    await page.keyboard.press('Escape');
    await expect(page.locator('#tag-popover')).toHaveCount(0);

    await expect.poll(async () => page.evaluate(async () => {
        const res = await fetch('/api/unsorted', { cache: 'no-store' });
        const data = await res.json();
        return (data.bookmarks || []).find((b) => b.name === 'Ctx tag One')?.tags || [];
    })).toContain('uvctag');

    // And the grid that stayed on screen knows about it: group by tag finds it.
    await page.locator('.unsorted-view-group-select').selectOption('tag');
    await expect(page.locator('.unsorted-group-title .category-title-name'))
        .toHaveText(['uvctag']);
});

test('a tagged unsorted bookmark stays out of the dashboard pools', async ({ page }) => {
    await bootstrap(page, keptPair('pool'));
    // Opening the view is what pulls the unsorted page into d.allBookmarks;
    // without it the pool has nothing to leak and the check proves nothing.
    await openUnsorted(page);

    const leaked = await page.evaluate(() => {
        const d = window.dashboardInstance;
        const unsortedIn = (list) => (list || []).filter((b) => Number(b.pageId) === 999999).length;
        return {
            all: unsortedIn(d.allBookmarks),
            kept: (d.unsortedBookmarks || []).length,
            smart: unsortedIn(d.smartCollections?.getSmartCollectionSourceBookmarks?.()),
            cloud: unsortedIn(window.DashboardTagCloud?.getBookmarkPool?.()),
        };
    });

    // The kept rows are held in their own array, and none of the dashboard's
    // pools -- allBookmarks included -- carries them.
    expect(leaked.kept).toBeGreaterThan(0);
    expect(leaked.all).toBe(0);
    expect(leaked.smart).toBe(0);
    expect(leaked.cloud).toBe(0);
});

test('grouping by tag gives the untagged rows a block of their own, last', async ({ page }) => {
    await bootstrap(page, [
        ...keptPair('group'),
        {
            name: 'Ctx group Tagged', url: 'https://ctx-group-tagged.example/c',
            tags: ['alpha', 'beta'], createdAt: 3000,
        },
    ]);

    await openUnsorted(page);
    await page.locator('.unsorted-view-search-input').fill('ctx-group-');
    await page.locator('.unsorted-view-group-select').selectOption('tag');

    // Both of the tagged row's tags get a block, and the two untagged
    // fixtures share one after them: the pile a tagging pass starts from.
    const titles = await page.locator('.unsorted-group-title .category-title-name').allInnerTexts();
    expect(titles.slice(0, 2).sort()).toEqual(['alpha', 'beta']);
    expect(titles[2]).toBe('no tag');
    const untagged = page.locator('.unsorted-view .unsorted-group', { has: page.locator('.category-title-name', { hasText: 'no tag' }) });
    await expect(untagged.locator('.bookmark-text')).toHaveCount(2);
});

test('Edit offers Unsorted as the page, and picking another one files the bookmark', async ({ page }) => {
    await bootstrap(page, keptPair('edit'));
    await openUnsorted(page);
    await page.locator('.unsorted-view-search-input').fill('ctx-edit-two');

    await openRowMenu(page, page.locator('.bookmark-link[data-unsorted-key]').first());
    await page.locator('#bookmark-context-menu [data-action="edit"]').click();
    await expect(page.locator('.bookmark-inline-form')).toBeVisible();

    const pageSelect = page.locator('.bookmark-inline-form select.bookmark-inline-select').first();
    // Staying put is the default: the bookmark's own page is an option rather
    // than a gap that falls through to the first real page.
    await expect(pageSelect).toHaveValue('999999');

    await pageSelect.selectOption('1');
    await page.locator('.bookmark-inline-save', { hasText: 'Save' }).click();

    // Gone from Unsorted, on the page, and the reader never left the view.
    await expect.poll(async () => page.evaluate(async () => {
        const res = await fetch('/api/unsorted', { cache: 'no-store' });
        const data = await res.json();
        return (data.bookmarks || []).filter((b) => b.name === 'Ctx edit Two').length;
    })).toBe(0);
    await expect(page.locator('.inbox-body-kept.unsorted-view')).toBeVisible();
    expect(new URL(page.url()).hash).toBe('#unsorted');
});

test('Tags from the row menu covers the whole selection', async ({ page }) => {
    await bootstrap(page, keptPair('bulk'));
    await seedPageTag(page, 'bulktag');
    await openUnsorted(page);
    await page.locator('.unsorted-view-search-input').fill('ctx-bulk-');

    const rows = page.locator('.bookmark-link[data-unsorted-key]');
    await page.locator('.unsorted-row-check-input').nth(0).check();
    await page.locator('.unsorted-row-check-input').nth(1).check();
    await expect(page.locator('.unsorted-select-toolbar .multi-select-count')).toHaveText('2 selected');

    await openRowMenu(page, rows.nth(0));
    // The entry says the count, so it cannot be mistaken for the single-row one.
    await expect(page.locator('#bookmark-context-menu [data-action="tags"]'))
        .toContainText('2 selected');
    await page.locator('#bookmark-context-menu [data-action="tags"]').click();

    const popover = page.locator('#unsorted-tags-popover');
    await expect(popover).toBeVisible();
    await expect(popover.locator('[data-tag="bulktag"]')).toContainText('0/2');
    await popover.locator('[data-tag="bulktag"]').click();
    await expect(popover.locator('[data-tag="bulktag"]')).toContainText('2/2');

    // Both rows carry it in the store, written in one pass over the page.
    await expect.poll(async () => page.evaluate(async () => {
        const res = await fetch('/api/unsorted', { cache: 'no-store' });
        const data = await res.json();
        return (data.bookmarks || [])
            .filter((b) => (b.tags || []).includes('bulktag'))
            .map((b) => b.name)
            .sort();
    })).toEqual(['Ctx bulk One', 'Ctx bulk Two']);
});

/**
 * Keeping a link is not a one-way door. A row that turns out to need more
 * thought goes back into the queue it came from, with what was written about
 * it, and leaves the kept list behind.
 */
test('the row menu sends a kept bookmark back to the inbox', async ({ page }) => {
    await bootstrap(page, keptPair('back'));
    await openUnsorted(page);
    await page.locator('.unsorted-view-search-input').fill('ctx-back-one');

    await openRowMenu(page, page.locator('.bookmark-link[data-unsorted-key]').first());
    await page.click('#bookmark-context-menu [data-action="unsorted-to-inbox"]');

    const url = 'https://ctx-back-one.example/a';
    await expect.poll(async () => page.evaluate(async (u) => {
        const items = await (await fetch('/api/inbox', { cache: 'no-store' })).json();
        return (items.items || items || []).some((item) => item.url === u);
    }, url), { timeout: 15_000 }).toBe(true);

    await expect.poll(async () => page.evaluate(async (u) => {
        const data = await (await fetch('/api/unsorted', { cache: 'no-store' })).json();
        return (data.bookmarks || []).some((b) => b.url === u);
    }, url), { timeout: 15_000 }).toBe(false);
});

/**
 * Parking a kept link from the row itself.
 *
 * The selection bar can snooze a whole tick-list, and the run over the list can
 * park the card in front of you -- but the row menu, which is where a single
 * link is dealt with, could only file it, send it back, or delete it. A link
 * worth holding that cannot be placed yet had no answer here.
 */
test('the row menu parks a kept bookmark back into the queue', async ({ page }) => {
    await bootstrap(page, keptPair('snooze'));
    await openUnsorted(page);
    await page.locator('.unsorted-view-search-input').fill('ctx-snooze-one');

    await openRowMenu(page, page.locator('.bookmark-link[data-unsorted-key]').first());
    await page.click('#bookmark-context-menu [data-action="unsorted-snooze"]');

    const menu = page.locator('.inbox-snooze-menu');
    await expect(menu).toBeVisible();
    await menu.locator('[data-snooze-until]').first().click();

    const url = 'https://ctx-snooze-one.example/a';
    await expect.poll(async () => page.evaluate(async (u) => {
        const body = await (await fetch('/api/inbox', { cache: 'no-store' })).json();
        const rows = body.items || body || [];
        return Number(rows.find((item) => item.url === u)?.snoozedUntil || 0);
    }, url), { timeout: 20_000 }).toBeGreaterThan(Date.now());
    await expect.poll(async () => page.evaluate(async (u) => {
        const data = await (await fetch('/api/unsorted', { cache: 'no-store' })).json();
        return (data.bookmarks || []).some((b) => b.url === u);
    }, url), { timeout: 20_000 }).toBe(false);
});

async function inboxRow(page, url) {
    return page.evaluate(async (u) => {
        const body = await (await fetch('/api/inbox', { cache: 'no-store' })).json();
        const rows = Array.isArray(body) ? body : (Array.isArray(body?.items) ? body.items : []);
        return rows.find((item) => item.url === u) || null;
    }, url);
}

async function stillKept(page, url) {
    return page.evaluate(async (u) => {
        const data = await (await fetch('/api/unsorted', { cache: 'no-store' })).json();
        return (data.bookmarks || []).some((b) => b.url === u);
    }, url);
}

/** A full inbox also answers 409; that one must not cost the kept row. */
test('a full inbox leaves the kept row where it was', async ({ page }) => {
    await bootstrap(page, keptPair('full'));
    await page.route('**/api/inbox', async (route) => {
        if (route.request().method() !== 'POST') return route.continue();
        return route.fulfill({
            status: 409, contentType: 'application/json',
            body: JSON.stringify({ error: 'at_capacity', message: 'Inbox is full' }),
        });
    });
    await openUnsorted(page);
    await page.locator('.unsorted-view-search-input').fill('ctx-full-one');
    await openRowMenu(page, page.locator('.bookmark-link[data-unsorted-key]').first());
    await page.click('#bookmark-context-menu [data-action="unsorted-to-inbox"]');

    await expect(page.locator('.app-notification, .notification').filter({ hasText: /failed/i }).first())
        .toBeVisible({ timeout: 15_000 });
    expect(await stillKept(page, 'https://ctx-full-one.example/a')).toBe(true);
});

/** Kept delete fails after the inbox add: the inbox copy is taken back out. */
test('a failed kept delete takes the new inbox copy back out', async ({ page }) => {
    await bootstrap(page, keptPair('rollback'));
    const url = 'https://ctx-rollback-one.example/a';
    await page.route('**/api/bookmarks', async (route) => {
        if (route.request().method() !== 'DELETE') return route.continue();
        return route.fulfill({ status: 500, body: 'nope' });
    });
    await openUnsorted(page);
    await page.locator('.unsorted-view-search-input').fill('ctx-rollback-one');
    await openRowMenu(page, page.locator('.bookmark-link[data-unsorted-key]').first());
    await page.click('#bookmark-context-menu [data-action="unsorted-to-inbox"]');

    await expect(page.locator('.app-notification, .notification').filter({ hasText: /failed/i }).first())
        .toBeVisible({ timeout: 15_000 });
    await expect.poll(async () => inboxRow(page, url), { timeout: 10_000 }).toBeNull();
    expect(await stillKept(page, url)).toBe(true);
});

/** The search box reads what a row shows: tags, the note and the preview too. */
test('search finds a kept row by tag, note and preview text', async ({ page }) => {
    await bootstrap(page, [
        { name: 'Plain Name', url: 'https://ctx-search-a.example/a', createdAt: 5000,
            tags: ['zebrafish'], note: 'ask about the quokka', previewTitle: 'Narwhal handbook' },
        { name: 'Other Row', url: 'https://ctx-search-b.example/b', createdAt: 4000 },
    ]);
    await openUnsorted(page);
    const rows = page.locator('.bookmark-link[data-unsorted-key]');
    for (const query of ['zebrafish', 'quokka', 'narwhal']) {
        await page.locator('.unsorted-view-search-input').fill(query);
        await expect(rows).toHaveCount(1);
        await expect(rows.first()).toContainText('Plain Name');
    }
});

/** The toast after sending back carries an undo that restores the kept row. */
test('sending back to the inbox can be undone from the toast', async ({ page }) => {
    await bootstrap(page, keptPair('undosend'));
    const url = 'https://ctx-undosend-one.example/a';
    await openUnsorted(page);
    await page.locator('.unsorted-view-search-input').fill('ctx-undosend-one');
    await openRowMenu(page, page.locator('.bookmark-link[data-unsorted-key]').first());
    await page.click('#bookmark-context-menu [data-action="unsorted-to-inbox"]');
    await expect.poll(() => stillKept(page, url), { timeout: 15_000 }).toBe(false);

    await page.locator('.app-notification', { hasText: 'Sent back' })
        .locator('.app-notification-action').click();

    await expect.poll(() => stillKept(page, url), { timeout: 15_000 }).toBe(true);
    await expect.poll(async () => inboxRow(page, url), { timeout: 15_000 }).toBeNull();
});

/** Filing a kept row can be undone: back on the kept page, off the target. */
test('filing a kept row can be undone from the toast', async ({ page }) => {
    await bootstrap(page, keptPair('undofile'));
    const url = 'https://ctx-undofile-one.example/a';
    await openUnsorted(page);
    const moved = await page.evaluate(async (u) => {
        const unsorted = window.dashboardInstance.unsorted;
        const row = unsorted._bookmarks.find((b) => b.url === u);
        await unsorted.select.moveSelectionTo(1, '', [row]);
        const filed = await (await fetch('/api/bookmarks?page=1', { cache: 'no-store' })).json();
        return filed.some((b) => b.url === u);
    }, url);
    expect(moved).toBe(true);
    expect(await stillKept(page, url)).toBe(false);

    await page.locator('.app-notification', { hasText: 'Filed' })
        .locator('.app-notification-action').click();

    await expect.poll(() => stillKept(page, url), { timeout: 15_000 }).toBe(true);
    await expect.poll(async () => page.evaluate(async (u) => {
        const filed = await (await fetch('/api/bookmarks?page=1', { cache: 'no-store' })).json();
        return filed.some((b) => b.url === u);
    }, url), { timeout: 15_000 }).toBe(false);
});
