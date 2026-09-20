// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * Select mode and the bulk actions in the Unsorted view.
 *
 * The rows live on the hidden unsorted page, so a delete here goes through the
 * bulk endpoint by index with a URL check rather than through the grid's own
 * path — which is why the assertions read the store back afterwards rather
 * than trusting the screen.
 */

const KEPT = [
    { name: 'Bulk One', url: 'https://bulk-one-uvb.example/a', createdAt: 5000 },
    { name: 'Bulk Two', url: 'https://bulk-two-uvb.example/b', createdAt: 4000 },
    { name: 'Keeper', url: 'https://keeper-uvb.example/c', createdAt: 3000 },
];

async function openUnsorted(page) {
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

    await page.evaluate(async (kept) => {
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        for (const bookmark of kept) {
            await api('/api/bookmarks/add', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ page: 999999, bookmark: { ...bookmark, category: '' } }),
            });
        }
    }, KEPT);

    await page.keyboard.down('Shift');
    await page.keyboard.press('KeyU');
    await page.keyboard.up('Shift');
    await expect(page.locator('.unsorted-view')).toBeVisible();
    await expect(page.locator('.unsorted-view-search-input')).toBeVisible();
}

/** The names still on the unsorted page, straight from the store. */
async function storedNames(page) {
    return page.evaluate(async () => {
        const res = await fetch('/api/unsorted');
        const data = await res.json();
        return (data.bookmarks || []).map((b) => b.name);
    });
}

/**
 * Tick a row the way the inbox and health are ticked: the box on the row. There
 * is no mode to switch on first -- the box is always there, quiet until the row
 * is hovered or ticked.
 */
async function tickRow(page, nth = 0) {
    await page.locator('.unsorted-row-check-input').nth(nth).check();
}

test('ticking a row opens the bulk bar, unticking closes it', async ({ page }) => {
    await openUnsorted(page);
    await page.locator('.unsorted-view-search-input').fill('-uvb.example');
    await expect(page.locator('.unsorted-select-toolbar')).toHaveCount(0);

    await tickRow(page);

    await expect(page.locator('.bookmark-link.is-multi-selected')).toHaveCount(1);
    await expect(page.locator('.unsorted-select-toolbar .multi-select-count')).toHaveText('1 selected');

    // Unticking takes the bar with the last tick.
    await page.locator('.unsorted-row-check-input').first().uncheck();
    await expect(page.locator('.bookmark-link.is-multi-selected')).toHaveCount(0);
    await expect(page.locator('.unsorted-select-toolbar')).toHaveCount(0);
});

test('ticking a row does not open the bookmark', async ({ page }) => {
    await openUnsorted(page);
    await page.locator('.unsorted-view-search-input').fill('-uvb.example');

    // Opening a bookmark is a new tab, not a navigation of this one, so the
    // thing to watch for is a second page in the context: the box sits inside
    // the row, and the row is what opens the link.
    const opened = [];
    page.context().on('page', (p) => opened.push(p));
    const before = page.url();

    await tickRow(page);
    await page.waitForTimeout(500);

    expect(opened).toHaveLength(0);
    expect(page.url()).toBe(before);
    await expect(page.locator('.bookmark-link.is-multi-selected')).toHaveCount(1);
});

test('Select all ticks every row the search leaves on screen', async ({ page }) => {
    await openUnsorted(page);
    await page.locator('.unsorted-view-search-input').fill('bulk-');
    await tickRow(page);

    await page.locator('.unsorted-select-toolbar .multi-select-btn', { hasText: 'Select all' }).click();
    await expect(page.locator('.unsorted-select-toolbar .multi-select-count')).toHaveText('2 selected');

    // Only what the query showed: the third fixture is not part of it.
    const names = await page.locator('.bookmark-link.is-multi-selected .bookmark-text').allInnerTexts();
    expect(names.sort()).toEqual(['Bulk One', 'Bulk Two']);
});

test('bulk delete removes the ticked rows and leaves the rest', async ({ page }) => {
    await openUnsorted(page);
    expect(await storedNames(page)).toEqual(expect.arrayContaining(['Bulk One', 'Bulk Two', 'Keeper']));

    await page.locator('.unsorted-view-search-input').fill('bulk-');
    await tickRow(page);
    await page.locator('.unsorted-select-toolbar .multi-select-btn', { hasText: 'Select all' }).click();
    await expect(page.locator('.unsorted-select-toolbar .multi-select-count')).toHaveText('2 selected');

    await page.locator('.unsorted-select-toolbar .multi-select-btn.danger').click();
    await page.locator('.modal-button.danger').click();

    await expect(page.locator('.unsorted-select-toolbar')).toHaveCount(0);
    await expect.poll(async () => (await storedNames(page)).filter((n) => n.startsWith('Bulk')))
        .toEqual([]);
    expect(await storedNames(page)).toContain('Keeper');
});

test('fetch previews walks the selection, not the whole list', async ({ page }) => {
    /** @type {string[]} */
    const asked = [];
    await page.route('**/api/bookmark-preview**', async (route) => {
        asked.push(new URL(route.request().url()).searchParams.get('url') || '');
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ title: 'stub' }),
        });
    });

    await openUnsorted(page);
    await page.locator('.unsorted-view-search-input').fill('-uvb.example');
    await tickRow(page);

    await page.locator('.unsorted-select-toolbar .multi-select-btn', { hasText: 'Fetch previews' }).click();

    await expect.poll(() => asked.length).toBe(1);
    expect(asked[0]).toBe('https://bulk-one-uvb.example/a');
});

test('a rate-limited sweep waits and asks again instead of failing', async ({ page }) => {
    /** @type {string[]} */
    const asked = [];
    await page.route('**/api/bookmark-preview**', async (route) => {
        const url = new URL(route.request().url()).searchParams.get('url') || '';
        asked.push(url);
        // The first ask is refused the way the server refuses one over its
        // sixty-a-minute budget; the wait is a second here rather than a minute.
        if (asked.filter((entry) => entry === url).length === 1) {
            await route.fulfill({
                status: 429,
                headers: { 'Retry-After': '1' },
                contentType: 'application/json',
                body: JSON.stringify({ error: 'rate limited' }),
            });
            return;
        }
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ title: 'Second time', description: 'After the wait' }),
        });
    });

    await openUnsorted(page);
    await page.locator('.unsorted-view-search-input').fill('bulk-one');
    await tickRow(page);
    await page.locator('.unsorted-select-toolbar .multi-select-btn', { hasText: 'Fetch previews' }).click();

    await expect.poll(() => asked.length, { timeout: 15_000 }).toBe(2);
    await expect.poll(async () => page.evaluate(async () => {
        const res = await fetch('/api/unsorted', { cache: 'no-store' });
        const data = await res.json();
        return (data.bookmarks || []).find((b) => b.name === 'Bulk One')?.previewTitle || '';
    }), { timeout: 15_000 }).toBe('Second time');
});

test('a sweep skips rows that already have a preview', async ({ page }) => {
    /** @type {string[]} */
    const asked = [];
    await page.route('**/api/bookmark-preview**', async (route) => {
        asked.push(new URL(route.request().url()).searchParams.get('url') || '');
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ title: 'Swept', description: 'From the sweep' }),
        });
    });

    await openUnsorted(page);
    await page.evaluate(async () => {
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        await api('/api/bookmarks/add', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                page: 999999,
                bookmark: {
                    name: 'Bulk Ready', url: 'https://bulk-ready-uvb.example/d',
                    category: '', previewTitle: 'Already here', createdAt: 2000,
                },
            }),
        });
        await window.dashboardInstance.unsorted.loadAndRender();
    });

    await page.locator('.unsorted-view-search-input').fill('-uvb.example');

    // Derived rather than hardcoded: earlier tests in this file leave previews
    // on rows of their own, so the only stable claim is that the count is the
    // visible rows minus the ones already carrying one.
    const counts = await page.evaluate(() => {
        const u = window.dashboardInstance.unsorted;
        const visible = u._visibleBookmarks();
        return {
            visible: visible.length,
            ready: visible.filter((b) => u._hasPreview(b)).length,
        };
    });
    expect(counts.ready).toBeGreaterThan(0);
    await expect(page.locator('.unsorted-view-previews-btn'))
        .toHaveText(`Fetch previews (${counts.visible - counts.ready})`);

    await expect.poll(() => asked.filter((u) => u.includes('bulk-ready')).length).toBe(0);
});

test('the header fetch button counts what it would act on', async ({ page }) => {
    await openUnsorted(page);
    await page.locator('.unsorted-view-search-input').fill('-uvb.example');

    // Nothing ticked: every visible row that still needs a preview. Derived,
    // because earlier tests in this file leave previews behind on rows of
    // their own.
    const needing = await page.evaluate(() => {
        const u = window.dashboardInstance.unsorted;
        return u._visibleBookmarks().filter((b) => !u._hasPreview(b)).length;
    });
    await expect(page.locator('.unsorted-view-previews-btn'))
        .toHaveText(`Fetch previews (${needing})`);

    // Ticked: that row alone, as long as it is one of the rows that needs one.
    await page.evaluate(() => {
        const u = window.dashboardInstance.unsorted;
        const target = u._visibleBookmarks().find((b) => !u._hasPreview(b));
        const key = u.select.keyFor(target);
        // Matched by reading the attribute rather than selecting on it: the key
        // joins url and name with a NUL, which no attribute selector will take.
        const row = [...document.querySelectorAll('.bookmark-link[data-unsorted-key]')]
            .find((node) => node.dataset.unsortedKey === key);
        const box = row.querySelector('.unsorted-row-check-input');
        box.checked = true;
        box.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await expect(page.locator('.unsorted-view-previews-btn')).toHaveText('Fetch previews (1)');
});

test('Escape drops the ticks', async ({ page }) => {
    await openUnsorted(page);
    await page.locator('.unsorted-view-search-input').fill('-uvb.example');
    await tickRow(page);
    await expect(page.locator('.unsorted-select-toolbar .multi-select-count')).toHaveText('1 selected');

    // Focus off the search box: a key pressed in an input belongs to the input.
    await page.locator('#dashboard-layout').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('Escape');

    // The same thing Escape does over the grid's own selection.
    await expect(page.locator('.unsorted-select-toolbar')).toHaveCount(0);
    await expect(page.locator('.bookmark-link.is-multi-selected')).toHaveCount(0);
});

test('leaving the view drops the ticks', async ({ page }) => {
    await openUnsorted(page);
    await tickRow(page);
    await expect(page.locator('.unsorted-select-toolbar')).toHaveCount(1);

    await page.locator('.dashboard-link a, .page-tab').first().click();
    await expect(page.locator('.inbox-body-kept.unsorted-view')).toHaveCount(0);

    await page.keyboard.down('Shift');
    await page.keyboard.press('KeyU');
    await page.keyboard.up('Shift');
    await expect(page.locator('.unsorted-view-search-input')).toBeVisible();
    await expect(page.locator('.unsorted-select-toolbar')).toHaveCount(0);
});

test('hovering a row fetches its preview once, and skips rows that have one', async ({ page }) => {
    /** @type {string[]} */
    const asked = [];
    await page.route('**/api/bookmark-preview**', async (route) => {
        asked.push(new URL(route.request().url()).searchParams.get('url') || '');
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ title: 'Hovered', description: 'From the hover' }),
        });
    });

    await openUnsorted(page);
    // A row of this test's own: the sweep tests above leave previews on the
    // shared fixtures, and a row that already has one is precisely what this
    // hover is not supposed to ask about.
    await page.evaluate(async () => {
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        await api('/api/bookmarks/add', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                page: 999999,
                bookmark: { name: 'Bulk Hover', url: 'https://bulk-hover-uvb.example/h', category: '' },
            }),
        });
        await window.dashboardInstance.unsorted.loadAndRender();
    });
    await page.locator('.unsorted-view-search-input').fill('bulk-hover');

    const row = page.locator('.bookmark-link[data-unsorted-key]').first();
    await row.hover();
    await expect.poll(() => asked.filter((u) => u.includes('bulk-hover')).length).toBe(1);

    // It reaches the store, so tomorrow's visit starts with it.
    await expect.poll(async () => page.evaluate(async () => {
        const res = await fetch('/api/unsorted', { cache: 'no-store' });
        const data = await res.json();
        return (data.bookmarks || []).find((b) => b.name === 'Bulk Hover')?.previewTitle || '';
    }), { timeout: 15_000 }).toBe('Hovered');

    // And the answer is kept, so coming back to the same row asks nothing.
    await page.locator('.unsorted-view-search-input').fill('bulk-');
    await page.locator('.bookmark-link[data-unsorted-key]').last().hover();
    await page.locator('.bookmark-link[data-unsorted-key]').first().hover();
    await page.waitForTimeout(900);
    expect(asked.filter((u) => u.includes('bulk-hover'))).toHaveLength(1);
});

test('the view survives a reload', async ({ page }) => {
    await openUnsorted(page);
    expect(new URL(page.url()).hash).toBe('#unsorted');

    await page.reload();
    await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });

    await expect(page.locator('.inbox-body-kept.unsorted-view')).toBeVisible();
    await expect(page.locator('.title')).toHaveText('unsorted');
});

/**
 * A preview sweep is paced against the rate limit, so a handful of rows is
 * already seconds of waiting and a few hundred is minutes. The icon sweep puts
 * the blocking progress overlay up for exactly that reason; the preview sweep
 * used to report itself in toasts every twentieth row, which on a short sweep
 * is one toast at the start and nothing until it ends.
 */
test('a preview sweep shows the progress overlay, counting and stoppable', async ({ page }) => {
    await page.route('**/api/bookmark-preview**', async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ title: 'Swept', description: 'From the sweep' }),
        });
    });

    await openUnsorted(page);
    await page.locator('.unsorted-view-search-input').fill('-uvb.example');
    await page.locator('.unsorted-view-previews-btn').click();

    const overlay = page.locator('#nextdash-progress-overlay');
    await expect(overlay).toBeVisible();
    await expect(overlay.locator('[data-progress-title]')).toContainText('preview');
    // Counting, not indeterminate: the number of rows is known before the
    // first request goes out.
    await expect(overlay.locator('[role="progressbar"]')).toHaveAttribute('aria-valuenow', /\d+/);
    await expect(overlay.locator('[data-progress-status]')).toContainText(' of ');

    // A sweep this long needs a way out that is not a reload.
    const stop = overlay.locator('[data-progress-cancel]');
    await expect(stop).toBeVisible();
    await stop.click();
    await expect(overlay).toBeHidden({ timeout: 15_000 });
});
