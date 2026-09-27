// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * Keep: a link leaves the queue and waits in Bookmarks → Unsorted.
 *
 * The inbox had a second tab, Kept, for what was kept. It was Bookmarks →
 * Unsorted a second time, with fewer ways to file a link; unsorted bookmarks
 * are promoted from the Bookmarks view now, and the inbox is one list.
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

test('the inbox is one list: no tab strip, and #unsorted opens Bookmarks on Unsorted', async ({ page }) => {
    await bootstrap(page);
    await page.evaluate(() => window.dashboardInstance.inbox.openInboxView());
    await expect(page.locator('.inbox-layout')).toBeVisible();
    await expect(page.locator('.inbox-tabs, [data-inbox-tab]')).toHaveCount(0);

    await page.goto('/#unsorted');
    await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });
    await expect.poll(() => page.evaluate(() => window.dashboardInstance.activeView)).toBe('library');
    await expect(page).toHaveURL(/#bookmarks\?filter=unsorted$/);
    await expect(page.locator('#config-bm-list .config-bm-title', { hasText: 'Zebra Docs' })).toBeVisible();
});

test('with keeping switched off Keep does nothing', async ({ page }) => {
    await bootstrap(page, { settings: { unsortedEnabled: false } });

    await page.evaluate(() => window.dashboardInstance.inbox.openInboxView());
    await expect(page.locator('.inbox-layout')).toBeVisible();

    const kept = await page.evaluate(async () => {
        const inbox = window.dashboardInstance.inbox;
        return inbox.keepItem({ id: 'nope', url: 'https://off.example/x', title: 'Off' });
    });
    expect(kept).toBe(false);
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

test('triage says that Keep moves a link to Unsorted', async ({ page }) => {
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
    await expect(page.locator('#bookmark-context-menu [data-action="inbox-keep"]')).toContainText('Unsorted');
    await page.keyboard.press('Escape');

    await page.keyboard.press('t');
    await expect.poll(() => page.evaluate(() =>
        !!window.dashboardInstance.inbox.triage?.isOpen?.()), { timeout: 10_000 }).toBe(true);

    await expect(page.locator('.inbox-triage-keep-hint')).toContainText('Bookmarks → Unsorted');
    await expect(page.locator('.inbox-triage-hint').first()).toContainText('to Unsorted');
});

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

    await row.locator('.inbox-item-title').click();

    await page.locator('[data-lvs-drawer="inbox"] [data-slp-action="keep"]').click();

    await expect.poll(async () => page.evaluate(async (u) => {
        const data = await (await fetch('/api/unsorted', { cache: 'no-store' })).json();
        return (data.bookmarks || []).some((b) => b.url === u);
    }, url), { timeout: 15_000 }).toBe(true);
});

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

test('Promote opens the form with the item tags filled in', async ({ page }) => {
    await bootstrap(page, { kept: [] });
    await page.evaluate(async () => {
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        await api('/api/inbox', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: `https://promote-tags-${Date.now()}.example/`, title: 'Tagged promote', tags: ['reading', 'later'] }),
        });
    });
    await page.evaluate(() => window.dashboardInstance.inbox.openInboxView());
    await page.evaluate(() => window.dashboardInstance.inbox.loadAndRender({ refresh: true }));
    const row = page.locator('.inbox-item', { hasText: 'Tagged promote' });
    await expect(row).toBeVisible({ timeout: 10_000 });

    await row.locator('.inbox-item-title').click();

    await page.locator('[data-lvs-drawer="inbox"] [data-slp-action="promote"]').click();

    const modal = page.locator('#bookmark-form-modal.show');
    await expect(modal).toBeVisible({ timeout: 10_000 });
    const tagsField = modal.locator('input.bookmark-inline-input').filter({ hasNot: page.locator('xpath=self::*[@type="url"]') });
    await expect.poll(async () => modal.evaluate((el) =>
        [...el.querySelectorAll('input')].map((input) => input.value).join('|')), { timeout: 5_000 })
        .toContain('reading, later');
});

test('Escape from the queue returns to the dashboard page last on screen', async ({ page }) => {
    await bootstrap(page);
    const target = await page.evaluate(async () => {
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        const pages = await (await fetch('/api/pages')).json();
        let second = pages.find((p) => !p.hidden && Number(p.id) !== 1);
        if (!second) {
            const id = Math.max(1, ...pages.filter((p) => p.id < 999999).map((p) => Number(p.id))) + 1;
            await api('/api/pages', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify([...pages.filter((p) => !p.hidden), { id, name: 'Second' }]),
            });
            second = { id };
        }
        return Number(second.id);
    });
    await page.reload();
    await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });
    await page.evaluate((id) => window.dashboardInstance.requestPageNavigation?.(id)
        ?? window.dashboardInstance.switchToPage?.(id), target);
    await expect.poll(() => page.evaluate(() => Number(window.dashboardInstance.currentPageId))).toBe(target);

    await page.evaluate(() => window.dashboardInstance.inbox.openInboxView());
    await expect(page.locator('.inbox-layout')).toBeVisible();
    await page.locator('.inbox-layout .lvs-title').click();
    await page.keyboard.press('Escape');

    await expect.poll(() => page.evaluate(() => window.dashboardInstance.activeView)).toBe('bookmarks');
    expect(await page.evaluate(() => Number(window.dashboardInstance.currentPageId))).toBe(target);
});

test('Escape on the queue clears its ticks before it leaves', async ({ page }) => {
    await bootstrap(page, { kept: [] });
    await page.evaluate(async () => {
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        await api('/api/inbox', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: `https://esc-queue-${Date.now()}.example/`, title: 'Esc queue' }),
        });
        await window.dashboardInstance.inbox.openInboxView();
        await window.dashboardInstance.inbox.loadAndRender({ refresh: true });
    });
    // The box shows on hover (one-line rows keep it out of sight at rest).
    await page.locator('.inbox-item').first().hover();
    await page.locator('.inbox-item-check-input').first().check();
    await expect(page.locator('.inbox-selection-bar')).toBeVisible();

    await page.locator('.inbox-layout .lvs-title').click();
    await page.keyboard.press('Escape');
    await expect(page.locator('.inbox-selection-bar')).toHaveCount(0);
    expect(await page.evaluate(() => window.dashboardInstance.activeView)).toBe('inbox');

    await page.keyboard.press('Escape');
    await expect.poll(() => page.evaluate(() => window.dashboardInstance.activeView)).toBe('bookmarks');
});
