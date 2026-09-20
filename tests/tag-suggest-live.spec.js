// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * Suggested tags where a link is triaged.
 *
 * The engine behind Config → Bookmarks → Suggestions answers for any row, and
 * the two places where an untagged link actually sits -- the inbox queue and
 * the kept list -- had no way to ask it without leaving for config, which is
 * the opposite of what triage is. Same engine, same refusals, offered per row.
 */

const RULES = [{ pattern: 'ruled.example', tag: 'reading' }];

const KEPT = [
    { name: 'Ruled One', url: 'https://ruled.example/one', createdAt: 5000 },
    { name: 'Plain One', url: 'https://plain.example/one', createdAt: 4000 },
];

async function bootstrap(page, { kept = KEPT, rules = RULES, dismissed = [] } = {}) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });

    await page.evaluate(async ({ rows, tagRules, refused }) => {
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
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
        await api('/api/settings', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                inboxEnabled: true, unsortedEnabled: true,
                unsortedSort: 'added-desc', unsortedGroup: 'none',
                tagRules, dismissedTagSuggestions: refused,
            }),
        });
        Object.assign(window.dashboardInstance.settings, {
            inboxEnabled: true, unsortedEnabled: true,
            unsortedSort: 'added-desc', unsortedGroup: 'none',
            tagRules, dismissedTagSuggestions: refused,
        });
        await window.dashboardInstance.loadAllBookmarks?.();
    }, { rows: kept, tagRules: rules, refused: dismissed });
}

async function openKept(page) {
    await page.evaluate(() => window.dashboardInstance.inbox.openInboxView({ tab: 'kept' }));
    await expect(page.locator('.inbox-body-kept.unsorted-view')).toBeVisible();
    await expect(page.locator('.bookmark-link[data-unsorted-key]').first()).toBeVisible();
}

/**
 * The chips a row is offered.
 *
 * They are drawn as the row's next sibling rather than inside it: a bookmark
 * row is a subgrid whose columns are spoken for, and a child of it lands in
 * the next cell, over the name.
 */
const chipsFor = (page, name) =>
    page.locator(`.unsorted-view .bookmark-link:has-text("${name}") + .tag-suggest-chips`);

test('a kept row offers the tag its rule proposes, and takes it on a click', async ({ page }) => {
    await bootstrap(page);
    await openKept(page);

    const chip = chipsFor(page, 'Ruled One').locator('.tag-suggest-chip-add');
    await expect(chip).toHaveText('#reading', { timeout: 10_000 });
    // Nothing is proposed for a site no rule, no neighbour and no catalogue
    // entry says anything about.
    await expect(chipsFor(page, 'Plain One').locator('.tag-suggest-chip-add')).toHaveCount(0);

    await chip.click();

    await expect.poll(async () => page.evaluate(async () => {
        const data = await (await fetch('/api/unsorted', { cache: 'no-store' })).json();
        return (data.bookmarks || []).find((b) => b.name === 'Ruled One')?.tags || [];
    }), { timeout: 15_000 }).toEqual(['reading']);
    // Taken means gone: the row carries the tag now, so there is nothing left
    // to propose.
    await expect(chipsFor(page, 'Ruled One').locator('.tag-suggest-chip-add')).toHaveCount(0);
});

test('turning a suggestion down keeps it down, here and in config', async ({ page }) => {
    await bootstrap(page);
    await openKept(page);

    await chipsFor(page, 'Ruled One').locator('.tag-suggest-chip-dismiss').click();
    await expect(chipsFor(page, 'Ruled One').locator('.tag-suggest-chip-add')).toHaveCount(0);

    // Written where config writes it, in the shape config reads.
    await expect.poll(async () => page.evaluate(async () =>
        (await (await fetch('/api/settings', { cache: 'no-store' })).json()).dismissedTagSuggestions || []),
        { timeout: 15_000 }).toContain('ruled.example|reading');

    await page.reload();
    await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });
    await openKept(page);
    await expect(chipsFor(page, 'Ruled One').locator('.tag-suggest-chip-add')).toHaveCount(0);
});

test('grouping by suggested tag reads the same engine the chips do', async ({ page }) => {
    await bootstrap(page);
    await openKept(page);
    await page.locator('.unsorted-view-group-select').selectOption('suggested');

    const titles = page.locator('.unsorted-view .unsorted-group-title .category-title-name');
    await expect.poll(() => titles.allInnerTexts(), { timeout: 10_000 })
        .toEqual(expect.arrayContaining(['reading', 'no suggestion']));
});

test('the selection bar files a whole selection by what is suggested for it', async ({ page }) => {
    await bootstrap(page, {
        kept: [
            { name: 'Ruled One', url: 'https://ruled.example/one', createdAt: 5000 },
            { name: 'Ruled Two', url: 'https://ruled.example/two', createdAt: 4000 },
        ],
    });
    await openKept(page);

    await page.locator('.unsorted-row-check-input').nth(0).check();
    await page.locator('.unsorted-row-check-input').nth(1).check();
    await page.locator('.unsorted-select-toolbar .multi-select-btn', { hasText: 'Suggest tags' }).click();

    const popover = page.locator('#unsorted-suggest-popover');
    await expect(popover).toBeVisible();
    // What it would write, before it writes it: the tag and how many rows.
    await expect(popover.locator('.unsorted-suggest-item').first()).toContainText('reading');
    await expect(popover.locator('.unsorted-suggest-item').first()).toContainText('2');

    await popover.locator('.unsorted-suggest-apply').click();

    await expect.poll(async () => page.evaluate(async () => {
        const data = await (await fetch('/api/unsorted', { cache: 'no-store' })).json();
        return (data.bookmarks || []).filter((b) => (b.tags || []).includes('reading')).length;
    }), { timeout: 20_000 }).toBe(2);
});

test('an inbox row offers the same tag, and keeps it on the way to Kept', async ({ page }) => {
    await bootstrap(page, { kept: [] });
    const url = `https://ruled.example/inbox-${Date.now()}`;
    await page.evaluate(async (u) => {
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        await api('/api/inbox', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: u, title: 'Ruled inbox link' }),
        });
    }, url);
    await page.evaluate(() => window.dashboardInstance.inbox.openInboxView());
    await page.evaluate(() => window.dashboardInstance.inbox.loadAndRender({ refresh: true }));
    await expect.poll(() => page.evaluate(() =>
        (window.dashboardInstance.inbox.items || []).length), { timeout: 10_000 }).toBeGreaterThan(0);

    const chip = page.locator('.inbox-item', { hasText: 'Ruled inbox link' })
        .locator('.tag-suggest-chip-add');
    await expect(chip).toHaveText('#reading', { timeout: 10_000 });
    await chip.click();

    await expect.poll(async () => page.evaluate(async (u) => {
        const body = await (await fetch('/api/inbox', { cache: 'no-store' })).json();
        return ((body.items || body || []).find((item) => item.url === u)?.tags) || [];
    }, url), { timeout: 15_000 }).toEqual(['reading']);
});

/**
 * The same offer over a whole queue.
 *
 * Accepting a tag one chip at a time is right for a row being read; a morning's
 * intake of twenty links from the same site is the case the kept list answers
 * with its own Suggest tags, and the queue is where those links arrive first.
 */
test('the inbox selection bar tags a whole queue by what is suggested for it', async ({ page }) => {
    await bootstrap(page, { kept: [] });
    const stamp = Date.now();
    await page.evaluate(async (n) => {
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        for (const suffix of ['one', 'two']) {
            await api('/api/inbox', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url: `https://ruled.example/${n}-${suffix}`, title: `Queued ${suffix}` }),
            });
        }
    }, stamp);
    await page.evaluate(() => window.dashboardInstance.inbox.openInboxView());
    await page.evaluate(() => window.dashboardInstance.inbox.loadAndRender({ refresh: true }));
    await expect.poll(() => page.evaluate(() =>
        (window.dashboardInstance.inbox.items || []).length), { timeout: 10_000 }).toBeGreaterThan(1);

    await page.locator('.inbox-item-check-input').nth(0).check();
    await page.locator('.inbox-item-check-input').nth(1).check();
    await page.locator('.inbox-selection-bar [data-inbox-selection="suggest"]').click();

    const popover = page.locator('#inbox-suggest-popover');
    await expect(popover).toBeVisible();
    await expect(popover.locator('.unsorted-suggest-item').first()).toContainText('reading');
    await expect(popover.locator('.unsorted-suggest-item').first()).toContainText('2');
    await popover.locator('.unsorted-suggest-apply').click();

    await expect.poll(async () => page.evaluate(async (n) => {
        const body = await (await fetch('/api/inbox', { cache: 'no-store' })).json();
        return (body.items || body || [])
            .filter((item) => String(item.url).includes(`/${n}-`) && (item.tags || []).includes('reading')).length;
    }, stamp), { timeout: 20_000 }).toBe(2);
});
