const { test, expect } = require('@playwright/test');
const { markWhatsNewSeen, dismissBlockingOverlays, dismissOnboardingIfPresent } = require('./e2e-helpers');

/**
 * U2–U4 from the inbox audit: lifetime stats in the view, bulk promote, and a
 * reachable share link. All three build on things that already existed —
 * /api/inbox-stats, the promote flow, buildItemShareUrl — and were simply not
 * offered anywhere the user could find them.
 */

async function openInbox(page) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => window.dashboardInstance?.inbox != null, null, { timeout: 15_000 });
    await page.evaluate(() => { window.dashboardInstance.settings.inboxEnabled = true; });
    await page.locator('#page-nav-inbox-btn').click();
    await expect(page.locator('.inbox-layout')).toBeVisible();
}

async function seed(page, titles) {
    const stamp = Date.now();
    await page.evaluate(async ({ titles, stamp }) => {
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        for (let i = 0; i < titles.length; i += 1) {
            await api('/api/inbox', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url: `https://ext${i}-${stamp}.example/x`, title: titles[i] }),
            });
        }
    }, { titles, stamp });
    await page.evaluate(() => window.dashboardInstance.inbox.loadAndRender({ refresh: true }));
}

test.describe('inbox extensions', () => {
    // U2 — the endpoint was built and routed but only ever read by config.
    test('the Stats panel answers the inbox\'s own question', async ({ page }) => {
        await openInbox(page);

        await page.route('**/api/inbox-stats', (route) => route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                version: 1,
                totalAdded: 40, totalPromoted: 12, totalDeleted: 28, totalKept: 3,
                retentionCount: 40, sumRetentionMs: 40 * 3 * 86400000,
                firstEventAt: Date.UTC(2026, 0, 15),
            }),
        }));

        await expect(page.locator('#inbox-stats-panel')).toHaveCount(0);
        await page.locator('[data-inbox-stats]').click();
        await expect(page.locator('#inbox-stats-panel')).toBeVisible();

        const panel = page.locator('#inbox-stats-panel');
        await expect(panel).toContainText('40');
        await expect(panel).toContainText('12');
        // 12 promoted of 40 triaged (12 + 28) is 30% — measured against what was
        // decided, not what was added, so links still waiting do not drag it down.
        await expect(panel).toContainText('30%');
        // 3 days average stay, formatted the way config formats it.
        await expect(panel).toContainText('3d');

        await page.locator('[data-inbox-stats]').click();
        await expect(page.locator('#inbox-stats-panel')).toHaveCount(0);
    });

    test('a stats failure says so rather than showing zeros', async ({ page }) => {
        await openInbox(page);
        await page.route('**/api/inbox-stats', (route) => route.fulfill({ status: 500, body: 'nope' }));

        await page.locator('[data-inbox-stats]').click();
        await expect(page.locator('#inbox-stats-panel')).toContainText(/could not load/i);
        // Zeros would read as real figures, which is the failure mode worth avoiding.
        await expect(page.locator('.inbox-stat-value')).toHaveCount(0);
    });

    // U3 — promoting is the view's stated conversion and was single-row only.
    test('bulk promote files every ticked link on one chosen page', async ({ page }) => {
        await openInbox(page);
        await seed(page, ['EXT promote a', 'EXT promote b']);

        const posted = [];
        await page.route('**/api/bookmarks/add', async (route) => {
            posted.push(route.request().postDataJSON());
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ status: 'success' }),
            });
        });

        const picked = await page.evaluate(() => {
            const inbox = window.dashboardInstance.inbox;
            const items = inbox.getFilteredItems().slice(0, 2);
            items.forEach((i) => inbox.setChecked(i.id, true));
            return items.map((i) => i.url);
        });
        expect(picked.length).toBe(2);

        await page.locator('[data-inbox-selection="promote"]').click();
        await expect(page.locator('.inbox-promote-menu')).toBeVisible();
        await page.locator('.inbox-promote-menu [data-promote-page]').first().click();

        await expect.poll(() => posted.length, { timeout: 10_000 }).toBe(2);
        expect(posted.map((p) => p.bookmark.url).sort()).toEqual(picked.sort());
        // One destination for the whole batch, which is the point.
        expect(new Set(posted.map((p) => p.page)).size).toBe(1);
    });

    // U4 — buildItemShareUrl existed with no entry point in the inbox at all.
    test('a row offers a copyable link that preserves the view', async ({ page }) => {
        await openInbox(page);
        await seed(page, ['EXT share row']);

        await page.evaluate(() => {
            window.__copied = null;
            Object.defineProperty(navigator, 'clipboard', {
                configurable: true,
                value: { writeText: (t) => { window.__copied = t; return Promise.resolve(); } },
            });
        });

        await page.locator('.inbox-item').first().click({ button: 'right' });
        await page.waitForSelector('#bookmark-context-menu', { timeout: 10_000 });
        await page.locator('#bookmark-context-menu [data-action="inbox-copy-link"]').click();

        const copied = await page.evaluate(() => window.__copied);
        expect(copied).toContain('ib_id=');
        expect(copied).toContain('#inbox');
    });
});

/**
 * U1 — InboxLink.Tags was a real field all along: normalised on add and
 * restore, and the extension can send them. Nothing rendered them, nothing
 * edited them, the search ignored them and the exports left the column out, so
 * a link could be filed with tags its owner never saw.
 */
test.describe('inbox tags', () => {
    async function seedTagged(page) {
        const stamp = Date.now();
        await page.evaluate(async (stamp) => {
            const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
            await api('/api/inbox', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    url: `https://tagged-${stamp}.example/x`,
                    title: `TAG tagged ${stamp}`,
                    tags: ['reading', 'work'],
                }),
            });
            await api('/api/inbox', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url: `https://plain-${stamp}.example/x`, title: `TAG plain ${stamp}` }),
            });
        }, stamp);
        await page.evaluate(() => window.dashboardInstance.inbox.loadAndRender({ refresh: true }));
        return stamp;
    }

    test('tags are shown on the row', async ({ page }) => {
        await openInbox(page);
        await seedTagged(page);

        const row = page.locator('.inbox-item', { hasText: 'TAG tagged' }).first();
        await expect(row.locator('[data-inbox-tag="reading"]')).toBeVisible();
        await expect(row.locator('[data-inbox-tag="work"]')).toBeVisible();
        // A row without tags gets no empty chip strip.
        const plain = page.locator('.inbox-item', { hasText: 'TAG plain' }).first();
        await expect(plain.locator('.inbox-item-tags')).toHaveCount(0);
    });

    test('clicking a tag filters to it, and clicking again clears it', async ({ page }) => {
        await openInbox(page);
        const stamp = await seedTagged(page);

        await page.locator('[data-inbox-tag="reading"]').first().click();
        expect(await page.evaluate(() => window.dashboardInstance.inbox.tagFilter)).toBe('reading');

        // Asserted on the filtered set rather than a row count: the inbox is
        // shared across the run, so earlier tests leave their own tagged rows
        // behind. What matters is that every surviving row carries the tag and
        // this run's untagged row is gone.
        const state = await page.evaluate((stamp) => {
            const items = window.dashboardInstance.inbox.getFilteredItems();
            return {
                allTagged: items.every((i) => (i.tags || []).includes('reading')),
                plainGone: !items.some((i) => (i.title || '').includes(`TAG plain ${stamp}`)),
                taggedShown: items.some((i) => (i.title || '').includes(`TAG tagged ${stamp}`)),
            };
        }, stamp);
        expect(state.allTagged).toBe(true);
        expect(state.plainGone).toBe(true);
        expect(state.taggedShown).toBe(true);

        await page.locator('[data-inbox-tag="reading"]').first().click();
        expect(await page.evaluate(() => window.dashboardInstance.inbox.tagFilter)).toBe('');
    });

    test('search matches a tag, not just the title', async ({ page }) => {
        await openInbox(page);
        await seedTagged(page);

        const matched = await page.evaluate(() => {
            const inbox = window.dashboardInstance.inbox;
            inbox.searchQuery = 'reading';
            const hits = inbox.getFilteredItems();
            inbox.searchQuery = '';
            return hits.map((i) => i.title);
        });
        expect(matched.some((t) => t.includes('TAG tagged'))).toBe(true);
        expect(matched.some((t) => t.includes('TAG plain'))).toBe(false);
    });

    test('the exports carry the tags', async ({ page }) => {
        await openInbox(page);
        await seedTagged(page);

        const captured = await page.evaluate(() => {
            const inbox = window.dashboardInstance.inbox;
            const seen = {};
            const original = inbox.downloadExportFile.bind(inbox);
            inbox.downloadExportFile = (name, content) => { seen[name.endsWith('.csv') ? 'csv' : 'json'] = content; };
            inbox.exportFilteredCsv();
            inbox.exportFilteredJson();
            inbox.downloadExportFile = original;
            return seen;
        });

        expect(captured.csv).toContain('reading');
        expect(JSON.parse(captured.json).some((r) => (r.tags || []).includes('reading'))).toBe(true);
    });

    test('the row menu can edit tags', async ({ page }) => {
        await openInbox(page);
        await seedTagged(page);

        await page.locator('.inbox-item', { hasText: 'TAG plain' }).first().click({ button: 'right' });
        await page.waitForSelector('#bookmark-context-menu', { timeout: 10_000 });
        await expect(page.locator('#bookmark-context-menu [data-action="inbox-tags"]')).toBeVisible();
    });
});
