// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * Kept bookmarks are the inbox's second tab, not a fourth destination.
 *
 * They had an icon of their own in the header, beside Dashboard, Inbox and
 * Health. Those three are ways of looking at the whole collection; keeping a
 * link is a step in the inbox's own flow, so it lives there -- one view, one
 * route, and one icon fewer for someone who never keeps anything.
 */

const KEPT = [
    { name: 'Alpha Guide', url: 'https://alpha.example/guide', createdAt: 5000 },
    { name: 'Alpha Reference', url: 'https://alpha.example/ref', createdAt: 4000 },
    { name: 'Zebra Docs', url: 'https://zebra.example/docs', createdAt: 3000 },
];

async function bootstrap(page, { kept = KEPT, settings = {} } = {}) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });

    await page.evaluate(async ({ rows, patch }) => {
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        // The kept page is emptied first: these specs share one server, so a
        // previous test's rows would be counted by this one.
        const current = await (await fetch('/api/unsorted', { cache: 'no-store' })).json();
        for (const bookmark of current.bookmarks || []) {
            await api('/api/bookmarks', {
                method: 'DELETE', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ page: 999999, bookmark }),
            });
        }
        for (const bookmark of rows) {
            await api('/api/bookmarks/add', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ page: 999999, bookmark: { ...bookmark, category: '' } }),
            });
        }
        // How the list is read is a setting, so each test says what it expects
        // rather than inheriting the last one's choice.
        await api('/api/settings', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                inboxEnabled: true, unsortedEnabled: true,
                unsortedSort: 'added-desc', unsortedGroup: 'none', ...patch,
            }),
        });
        Object.assign(window.dashboardInstance.settings, {
            inboxEnabled: true, unsortedEnabled: true,
            unsortedSort: 'added-desc', unsortedGroup: 'none', ...patch,
        });
        await window.dashboardInstance.loadAllBookmarks?.();
    }, { rows: kept, patch: settings });
}

async function openKept(page) {
    await page.keyboard.down('Shift');
    await page.keyboard.press('KeyU');
    await page.keyboard.up('Shift');
    await expect(page.locator('.inbox-body-kept.unsorted-view')).toBeVisible();
    await expect(page.locator('.bookmark-link[data-unsorted-key]').first()).toBeVisible();
}

const rowNames = (page) => page.locator('.unsorted-view .bookmarks-list .bookmark-text').allInnerTexts();

test('Shift+U opens the inbox on its Kept tab, and the header has no icon of its own', async ({ page }) => {
    await bootstrap(page);
    await openKept(page);

    expect(await page.evaluate(() => window.dashboardInstance.activeView)).toBe('inbox');
    expect(await page.evaluate(() => window.dashboardInstance.inbox.tab)).toBe('kept');
    expect(new URL(page.url()).hash).toBe('#unsorted');
    // The fourth destination is gone.
    await expect(page.locator('.unsorted-link, .unsorted-link-anchor')).toHaveCount(0);
});

test('the strip switches the two lists, and the address says which is up', async ({ page }) => {
    await bootstrap(page);
    await openKept(page);
    await expect(page.locator('[data-inbox-tab="kept"]')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('[data-inbox-tab="kept"] .inbox-tab-count')).toHaveText('3');

    await page.locator('[data-inbox-tab="triage"]').click();
    await expect(page.locator('.inbox-body-own .inbox-item, .inbox-body-own .inbox-empty, .inbox-body-own')).toBeVisible();
    await expect(page.locator('.inbox-body-kept')).toBeHidden();
    await expect.poll(() => new URL(page.url()).hash).toBe('#inbox');
    // The rail belongs to the queue: it is back with it.
    await expect(page.locator('.lvs-rail')).toBeVisible();

    await page.locator('[data-inbox-tab="kept"]').click();
    await expect(page.locator('.inbox-body-kept.unsorted-view')).toBeVisible();
    await expect(page.locator('.lvs-rail')).toBeHidden();
    await expect.poll(() => new URL(page.url()).hash).toBe('#unsorted');
});

test('#unsorted still opens what it names, straight from a reload', async ({ page }) => {
    await bootstrap(page);
    await page.goto('/#unsorted');
    await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });

    await expect(page.locator('.inbox-body-kept.unsorted-view')).toBeVisible();
    await expect.poll(() => page.evaluate(() => window.dashboardInstance.inbox?.tab)).toBe('kept');
});

test('with keeping switched off there is no tab and Keep does nothing', async ({ page }) => {
    await bootstrap(page, { settings: { unsortedEnabled: false } });

    await page.evaluate(() => window.dashboardInstance.inbox.openInboxView());
    await expect(page.locator('.inbox-layout')).toBeVisible();
    await expect(page.locator('[data-inbox-tab="kept"]')).toBeHidden();

    const kept = await page.evaluate(async () => {
        const inbox = window.dashboardInstance.inbox;
        return inbox.keepItem({ id: 'nope', url: 'https://off.example/x', title: 'Off' });
    });
    expect(kept).toBe(false);
});

test('sorting by last checked leads with what is broken, then what was never checked', async ({ page }) => {
    await bootstrap(page, {
        kept: [
            { name: 'Checked Today', url: 'https://checked.example/a', createdAt: 5000, lastChecked: 9000 },
            { name: 'Never Checked', url: 'https://never.example/b', createdAt: 4000 },
            { name: 'Broken One', url: 'https://broken.example/c', createdAt: 3000, lastChecked: 8000, lastError: 'dial tcp: timeout' },
        ],
    });
    await openKept(page);
    await page.locator('.unsorted-view-sort-select').selectOption('checked');

    await expect.poll(() => rowNames(page)).toEqual(['Broken One', 'Never Checked', 'Checked Today']);
});

test('the broken line counts the kept links that stopped answering, and filters to them', async ({ page }) => {
    await bootstrap(page, {
        kept: [
            { name: 'Fine One', url: 'https://fine.example/a', createdAt: 5000 },
            { name: 'Broken One', url: 'https://broken.example/b', createdAt: 4000, lastChecked: 8000, lastError: 'dial tcp: timeout' },
        ],
    });
    await openKept(page);

    const note = page.locator('.unsorted-broken-note');
    await expect(note).toBeVisible();
    await expect(note).toContainText('1');

    await page.locator('.unsorted-broken-btn').click();
    await expect.poll(() => rowNames(page)).toEqual(['Broken One']);

    await page.locator('.unsorted-broken-btn').click();
    await expect.poll(async () => (await rowNames(page)).length).toBe(2);
});

test('grouping by suggested tag reads the tag rules, and says when none matches', async ({ page }) => {
    await bootstrap(page, { settings: { tagRules: [{ pattern: 'alpha.example', tag: 'reading' }] } });
    await openKept(page);
    await page.locator('.unsorted-view-group-select').selectOption('suggested');

    const titles = page.locator('.unsorted-view .unsorted-group-title .category-title-name');
    await expect.poll(() => titles.allInnerTexts()).toEqual(
        expect.arrayContaining(['reading', 'no suggestion']));
});

test('the sort and the grouping are remembered across a reload', async ({ page }) => {
    await bootstrap(page);
    await openKept(page);

    await page.locator('.unsorted-view-sort-select').selectOption('name');
    await page.locator('.unsorted-view-group-select').selectOption('site');
    await expect.poll(() => page.evaluate(async () =>
        (await (await fetch('/api/settings')).json()).unsortedGroup), { timeout: 10_000 }).toBe('site');

    await page.goto('/#unsorted');
    await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });
    await expect(page.locator('.unsorted-view-sort-select')).toHaveValue('name');
    await expect(page.locator('.unsorted-view-group-select')).toHaveValue('site');
});

test('Move to… files the whole selection in one go', async ({ page }) => {
    await bootstrap(page);
    await openKept(page);

    await page.locator('.unsorted-row-check-input').nth(0).check();
    await page.locator('.unsorted-row-check-input').nth(1).check();
    await page.locator('.unsorted-select-toolbar .multi-select-btn', { hasText: 'Move to' }).click();

    const popover = page.locator('#unsorted-move-popover');
    await expect(popover).toBeVisible();
    await popover.locator('.unsorted-move-item').first().click();
    // Page first, then that page's categories -- or none, which is what a
    // dashboard with no categories yet offers.
    await popover.locator('.unsorted-move-item').last().click();

    await expect.poll(async () => page.evaluate(async () => {
        const data = await (await fetch('/api/unsorted', { cache: 'no-store' })).json();
        return (data.bookmarks || []).length;
    }), { timeout: 20_000 }).toBe(1);
});

test('a kept bookmark is still found and opened from the search panel', async ({ page }) => {
    await bootstrap(page);
    await page.evaluate(() => {
        const d = window.dashboardInstance;
        d.settings.searchUnsorted = true;
        // The panel holds its own copy of the pool; the rows this test just
        // added are not in it until it is handed a new one.
        d.setup?.updateSearchComponent?.();
    });

    await page.keyboard.press('>');
    await expect(page.locator('#shortcut-search.show')).toBeVisible({ timeout: 5_000 });
    await page.keyboard.type('Zebra', { delay: 10 });
    // Letters look for a shortcut first; / is what the panel itself offers to
    // search the names, which is how a kept bookmark is reached by name.
    await page.keyboard.press('/');

    const match = page.locator('.search-match').filter({ hasText: 'Zebra Docs' }).first();
    await expect(match).toBeVisible({ timeout: 10_000 });
    // Marked as kept, so the row says where it came from, and it opens like
    // any other result.
    await expect(match.locator('.search-match-unsorted-badge')).toBeVisible();
});

/**
 * Keep is a one-key action with a consequence: the link leaves the queue for
 * the Kept tab. The triage card used to say "R keep" and nothing else, so the
 * link appeared to vanish. The card now names the destination, and so does
 * the row menu.
 */
test('triage says that Keep moves a link to the Kept tab', async ({ page }) => {
    await bootstrap(page, { kept: [] });

    const url = `https://says-${Date.now()}.example/x`;
    await page.evaluate(async (u) => {
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        await api('/api/inbox', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: u, title: 'Says where' }),
        });
    }, url);

    await page.evaluate(() => window.dashboardInstance.inbox.openInboxView());
    await expect(page.locator('.inbox-layout')).toBeVisible();
    await page.evaluate(() => window.dashboardInstance.inbox.loadAndRender({ refresh: true }));
    await expect.poll(() => page.evaluate(() =>
        (window.dashboardInstance.inbox.items || []).length), { timeout: 10_000 }).toBeGreaterThan(0);

    // The row menu names the destination, not bare "Keep".
    await page.locator('.inbox-item').first().click({ button: 'right' });
    await expect(page.locator('#bookmark-context-menu [data-action="inbox-keep"]')).toContainText('Kept tab');
    await page.keyboard.press('Escape');

    await page.keyboard.press('t');
    await expect.poll(() => page.evaluate(() =>
        !!window.dashboardInstance.inbox.triage?.isOpen?.()), { timeout: 10_000 }).toBe(true);

    await expect(page.locator('.inbox-triage-keep-hint')).toContainText('Kept');
    await expect(page.locator('.inbox-triage-hint').first()).toContainText('to Kept');
});

/**
 * The count beside Kept is the one number saying where a kept link went. It
 * read from the array the dashboard keeps of the kept page, which Keep itself
 * never reloaded -- so the tab said nothing had been kept until the reader
 * switched tabs or reloaded, which is the moment the count exists for.
 */
test('keeping a link moves the count beside the Kept tab', async ({ page }) => {
    await bootstrap(page, { kept: [] });

    await page.evaluate(async () => {
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        await api('/api/inbox', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: `https://counts-${Date.now()}.example/x`, title: 'Counts' }),
        });
    });
    await page.evaluate(() => window.dashboardInstance.inbox.openInboxView());
    await page.evaluate(() => window.dashboardInstance.inbox.loadAndRender({ refresh: true }));
    await expect.poll(() => page.evaluate(() =>
        (window.dashboardInstance.inbox.items || []).length), { timeout: 10_000 }).toBeGreaterThan(0);
    await expect(page.locator('[data-inbox-tab="kept"] .inbox-tab-count')).toHaveText('');

    await page.keyboard.press('t');
    await expect.poll(() => page.evaluate(() =>
        !!window.dashboardInstance.inbox.triage?.isOpen?.()), { timeout: 10_000 }).toBe(true);
    await page.keyboard.press('r');

    // No reload, no tab switch: the strip is repainted by the keep itself.
    await expect(page.locator('[data-inbox-tab="kept"] .inbox-tab-count')).toHaveText('1', { timeout: 10_000 });
});

/**
 * The strip calls itself a tablist, which is a promise about the keyboard: the
 * arrows move between tabs, one stop holds the focus, and each tab says which
 * panel it controls. It had the roles and none of the behaviour.
 */
test('the tab strip answers to the arrow keys', async ({ page }) => {
    await bootstrap(page);
    await openKept(page);

    const triage = page.locator('[data-inbox-tab="triage"]');
    const kept = page.locator('[data-inbox-tab="kept"]');
    // One stop in the tab order: the active tab, as a tablist has.
    await expect(kept).toHaveAttribute('tabindex', '0');
    await expect(triage).toHaveAttribute('tabindex', '-1');
    await expect(kept).toHaveAttribute('aria-controls', /.+/);
    await expect(page.locator(`#${await kept.getAttribute('aria-controls')}`))
        .toHaveAttribute('role', 'tabpanel');

    await kept.focus();
    await page.keyboard.press('ArrowLeft');
    await expect(triage).toHaveAttribute('aria-selected', 'true');
    await expect(triage).toBeFocused();
    await expect.poll(() => new URL(page.url()).hash).toBe('#inbox');

    await page.keyboard.press('ArrowRight');
    await expect(kept).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('.inbox-body-kept.unsorted-view')).toBeVisible();

    // Home and End are the ends of the strip, as they are in every tablist.
    await page.keyboard.press('Home');
    await expect(triage).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('End');
    await expect(kept).toHaveAttribute('aria-selected', 'true');
});

/**
 * The kept list's selection bar belongs to the kept list. It is drawn into the
 * layout rather than into the tab, so ticks left behind on a switch stood over
 * the queue offering Delete and Move to… for rows that were no longer there.
 */
test('switching to the queue drops the kept selection with its bar', async ({ page }) => {
    await bootstrap(page);
    await openKept(page);

    await page.locator('.unsorted-row-check-input').first().check();
    await expect(page.locator('.unsorted-select-toolbar')).toBeVisible();

    await page.locator('[data-inbox-tab="triage"]').click();
    await expect(page.locator('.unsorted-select-toolbar')).toHaveCount(0);
});

/**
 * Keep on the row itself.
 *
 * The row's own buttons offered Open, Promote, Mark read, Snooze, Note and
 * Delete -- every exit from the queue but the one that has a tab of its own.
 * Keep was reachable only from triage or the right-click menu.
 */
test('the inbox row keeps a link with its own button', async ({ page }) => {
    await bootstrap(page, { kept: [] });
    const url = `https://row-keep-${Date.now()}.example/x`;
    await page.evaluate(async (u) => {
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        await api('/api/inbox', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: u, title: 'Row keep' }),
        });
    }, url);
    await page.evaluate(() => window.dashboardInstance.inbox.openInboxView());
    await page.evaluate(() => window.dashboardInstance.inbox.loadAndRender({ refresh: true }));
    const row = page.locator('.inbox-item', { hasText: 'Row keep' });
    await expect(row).toBeVisible({ timeout: 10_000 });

    await row.hover();
    await row.locator('[data-inbox-action="keep"]').click();

    await expect.poll(async () => page.evaluate(async (u) => {
        const data = await (await fetch('/api/unsorted', { cache: 'no-store' })).json();
        return (data.bookmarks || []).some((b) => b.url === u);
    }, url), { timeout: 15_000 }).toBe(true);
    await expect(page.locator('[data-inbox-tab="kept"] .inbox-tab-count')).toHaveText('1', { timeout: 10_000 });
});

/**
 * r in the list marks a row read; r in the triage card keeps it. The legend
 * under the list said "keep · to Kept" for both, which is the one key in the
 * list that does something else.
 */
test('the list legend says what r does in the list', async ({ page }) => {
    await bootstrap(page, { kept: [] });
    await page.evaluate(async () => {
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        await api('/api/inbox', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: `https://legend-${Date.now()}.example/x`, title: 'Legend row' }),
        });
    });
    await page.evaluate(() => window.dashboardInstance.inbox.openInboxView());
    await page.evaluate(() => window.dashboardInstance.inbox.loadAndRender({ refresh: true }));
    const legend = page.locator('.inbox-body-own .inbox-legend');
    await expect(legend).toBeVisible({ timeout: 10_000 });
    const rLine = legend.locator('span', { has: page.locator('kbd', { hasText: /^r$/ }) });
    await expect(rLine).toContainText('mark read');
});

/**
 * The density toggle in the toolbar reaches the kept list.
 *
 * The kept grid takes its density as a class when it is drawn, and nothing
 * redrew it when the setting changed: the two buttons saved the setting,
 * stamped the page, and left the list in front of them exactly as it was.
 */
test('the density toggle redraws the kept list', async ({ page }) => {
    await bootstrap(page);
    await openKept(page);

    const grid = page.locator('.unsorted-view .dashboard-grid').first();
    await page.locator('.lvs-density-btn[data-lvs-density="comfortable"]').click();
    await expect(grid).toHaveClass(/density-comfortable/, { timeout: 5_000 });

    await page.locator('.lvs-density-btn[data-lvs-density="compact"]').click();
    await expect(page.locator('.unsorted-view .dashboard-grid').first()).toHaveClass(/density-compact/, { timeout: 5_000 });
});

/**
 * Both tabs carry their count.
 *
 * Kept said how many it held; To triage said nothing, so the strip read as
 * one list with a number and one without, and the queue -- the one that asks
 * for attention -- was the one that did not say how much.
 */
test('the To triage tab counts the queue, and follows it', async ({ page }) => {
    await bootstrap(page, { kept: [] });
    await page.evaluate(async () => {
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        const body = await (await fetch('/api/inbox', { cache: 'no-store' })).json();
        for (const item of (Array.isArray(body) ? body : (Array.isArray(body?.items) ? body.items : []))) {
            await api(`/api/inbox?id=${encodeURIComponent(item.id)}`, { method: 'DELETE' });
        }
        for (const n of [1, 2]) {
            await api('/api/inbox', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url: `https://count-${n}-${Date.now()}.example/`, title: `Count ${n}` }),
            });
        }
    });
    await page.evaluate(() => window.dashboardInstance.inbox.openInboxView());
    await page.evaluate(() => window.dashboardInstance.inbox.loadAndRender({ refresh: true }));

    const count = page.locator('[data-inbox-tab="triage"] .inbox-tab-count');
    await expect(count).toHaveText('2', { timeout: 10_000 });

    // Keep one: the queue shrinks and says so.
    const row = page.locator('.inbox-item', { hasText: 'Count 1' });
    await row.hover();
    await row.locator('[data-inbox-action="keep"]').click();
    await expect(count).toHaveText('1', { timeout: 10_000 });
});

/**
 * One number for the queue, wherever it is shown.
 *
 * The header badge counts what still waits to be read; the tab counted every
 * row, read or not -- 27 in the header over 56 on the tab, for the same list.
 * They read the same count now, so marking a row read moves both.
 */
test('the To triage tab and the header badge show the same number', async ({ page }) => {
    await bootstrap(page, { kept: [] });
    await page.evaluate(async () => {
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        const body = await (await fetch('/api/inbox', { cache: 'no-store' })).json();
        for (const item of (Array.isArray(body) ? body : (Array.isArray(body?.items) ? body.items : []))) {
            await api(`/api/inbox?id=${encodeURIComponent(item.id)}`, { method: 'DELETE' });
        }
        for (const n of [1, 2, 3]) {
            await api('/api/inbox', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url: `https://same-${n}-${Date.now()}.example/`, title: `Same ${n}` }),
            });
        }
        await window.dashboardInstance.inbox.openInboxView();
        await window.dashboardInstance.inbox.loadAndRender({ refresh: true });
    });

    const tab = page.locator('[data-inbox-tab="triage"] .inbox-tab-count');
    const badge = page.locator('#page-inbox-badge');
    await expect(tab).toHaveText('3', { timeout: 10_000 });
    await expect(badge).toHaveText('3');

    // One of the three read, through the row's own button: it stays in the
    // list, and leaves both counts at once.
    const row = page.locator('.inbox-item', { hasText: 'Same 1' });
    await row.hover();
    await row.locator('[data-inbox-action="read"]').click();
    await expect(tab).toHaveText('2', { timeout: 10_000 });
    await expect(badge).toHaveText('2');
});
