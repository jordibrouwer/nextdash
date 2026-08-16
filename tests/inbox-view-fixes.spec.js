// @ts-check
const { test, expect } = require('@playwright/test');
const { markWhatsNewSeen, dismissBlockingOverlays, dismissOnboardingIfPresent } = require('./e2e-helpers');

/**
 * The inbox view, on the promises its own controls make.
 *
 * Every failure pinned here was the same shape: a number, a label or a list that
 * answered to a different set of rows than the feed under it. The site picker
 * read the raw item list, so it offered a host whose only link was asleep and
 * then said "no matching links". The pills counted past an active search. "Mark
 * all read" said all and meant the filtered handful. And a sleeping link was in
 * no count, no filter and no export, with nothing on screen admitting it exists.
 */

async function openInbox(page) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => window.dashboardInstance?.inbox != null, null, { timeout: 15_000 });
    await page.evaluate(() => { window.dashboardInstance.settings.inboxEnabled = true; });
    await page.evaluate(async () => {
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        const res = await api('/api/inbox');
        const body = await res.json().catch(() => null);
        const items = Array.isArray(body) ? body : (body?.items || []);
        await Promise.all(items.map((item) =>
            api(`/api/inbox?id=${encodeURIComponent(item.id)}`, { method: 'DELETE' })));
    });
}

/** Seed one item per host and open the view on them. */
async function seed(page, hosts) {
    await page.evaluate(async (list) => {
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        for (const [host, title] of list) {
            await api('/api/inbox', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url: `https://${host}/one`, title }),
            });
        }
    }, hosts);
    await page.locator('#page-nav-inbox-btn').click();
    await expect(page.locator('.inbox-layout')).toBeVisible();
    await page.evaluate(() => window.dashboardInstance.inbox.loadAndRender?.({ refresh: true }));
    await expect(page.locator('.inbox-item')).toHaveCount(hosts.length);
}

/** Snooze the first row through its own button, as a reader would. */
async function snoozeFirstRow(page) {
    const before = await page.locator('.inbox-item').count();
    const card = page.locator('.inbox-item').first();
    await card.hover();
    await card.locator('[data-inbox-action="snooze"]').click();
    await expect(page.locator('.inbox-snooze-menu')).toBeVisible();
    await page.locator('.inbox-snooze-option').first().click();
    await expect(page.locator('.inbox-item')).toHaveCount(before - 1);
}

test.describe('the site picker offers what it can deliver', () => {
    test('a site whose only link is asleep is not on offer', async ({ page }) => {
        await openInbox(page);
        // Newest first, so the last one seeded is the row Snooze reaches.
        await seed(page, [['awake-host.example.com', 'Awake'], ['sleepy-host.example.com', 'Sleeper']]);

        await expect(page.locator('.inbox-domain-select option')).toHaveCount(3);
        await snoozeFirstRow(page);

        // It used to stay listed, and picking it answered with "no matching
        // links" — the row exists, it is simply asleep.
        const values = await page.locator('.inbox-domain-select option')
            .evaluateAll((els) => els.map((e) => e.value));
        expect(values).not.toContain('sleepy-host.example.com');
        expect(values).toContain('awake-host.example.com');
    });

    test('each option says how many rows it leaves', async ({ page }) => {
        await openInbox(page);
        await seed(page, [['counted-host.example.com', 'One'], ['other-host.example.com', 'Two']]);
        // The count is the point: the choice is made before the click rather
        // than found out after it.
        const label = await page.locator('.inbox-domain-select option[value="counted-host.example.com"]').textContent();
        expect(label?.trim()).toBe('counted-host.example.com (1)');
    });
});

test.describe('the numbers answer to the rows on screen', () => {
    test('a search narrows the pills and the tiles with it', async ({ page }) => {
        await openInbox(page);
        await seed(page, [['a-host.example.com', 'Findable one'], ['b-host.example.com', 'Other thing']]);

        const allPill = page.locator('[data-inbox-filter="all"] .inbox-filter-count');
        await expect(allPill).toHaveText('2');

        await page.locator('[data-inbox-search]').fill('Findable');
        await expect(page.locator('.inbox-item')).toHaveCount(1);
        // "All 2" over one row is the pill counting a set the view is not showing.
        await expect(allPill).toHaveText('1');
        await expect(page.locator('[data-inbox-tile="all"] .inbox-tile-value')).toHaveText('1');
        await expect(page.locator('.inbox-count-badge')).toHaveText('1');
    });

    test('Mark all read stops saying all once a search narrows it', async ({ page }) => {
        await openInbox(page);
        await seed(page, [['c-host.example.com', 'Narrow me'], ['d-host.example.com', 'Leave me']]);

        const button = page.locator('[data-inbox-bulk="read"]');
        await expect(button).toHaveText(/all/i);

        await page.locator('[data-inbox-search]').fill('Narrow');
        await expect(page.locator('.inbox-item')).toHaveCount(1);
        await expect(button).not.toHaveText(/all/i);
        await expect(button).toHaveAttribute('title', /view/i);

        // And it acts on the row it names, leaving the one out of view unread.
        await button.click();
        await expect.poll(() => page.evaluate(() =>
            window.dashboardInstance.inbox.items.filter((i) => i.readAt).length),
        { timeout: 10_000 }).toBe(1);
    });
});

test.describe('a sleeping link is admitted to exist', () => {
    test('a line under the list counts them and leads to them', async ({ page }) => {
        await openInbox(page);
        await seed(page, [['e-host.example.com', 'Sleeper'], ['f-host.example.com', 'Awake']]);
        await expect(page.locator('.inbox-snoozed-note')).toHaveCount(0);

        await snoozeFirstRow(page);
        const note = page.locator('.inbox-snoozed-note');
        await expect(note).toBeVisible();
        await expect(note).toContainText('1');

        await note.locator('[data-inbox-snoozed-note]').click();
        await expect.poll(() => page.evaluate(() => window.dashboardInstance.inbox.filter),
            { timeout: 10_000 }).toBe('snoozed');
        await expect(page.locator('.inbox-item')).toHaveCount(1);
    });
});

test.describe('the list is a feed, and only the list', () => {
    test('the role sits on the rows, which carry their place in the set', async ({ page }) => {
        await openInbox(page);
        await seed(page, [['g-host.example.com', 'First'], ['h-host.example.com', 'Second']]);

        // The layout holds a heading, tiles, a toolbar and a legend; as a feed it
        // announced all of them as feed content.
        await expect(page.locator('.inbox-layout')).not.toHaveAttribute('role', 'feed');
        await expect(page.locator('.inbox-feed')).toHaveAttribute('role', 'feed');

        const rows = await page.locator('.inbox-item').evaluateAll((els) => els.map((el) => ({
            pos: el.getAttribute('aria-posinset'),
            size: el.getAttribute('aria-setsize'),
            named: !!el.getAttribute('aria-labelledby')
                && !!document.getElementById(el.getAttribute('aria-labelledby')),
            // aria-selected is not a state an <article> has; it was set and never
            // read out.
            selected: el.hasAttribute('aria-selected'),
        })));
        expect(rows.map((r) => r.pos)).toEqual(['1', '2']);
        expect(rows.every((r) => r.size === '2')).toBe(true);
        expect(rows.every((r) => r.named)).toBe(true);
        expect(rows.some((r) => r.selected)).toBe(false);
    });

    test('the row under the cursor is marked as current', async ({ page }) => {
        await openInbox(page);
        await seed(page, [['i-host.example.com', 'Cursor here']]);
        await page.locator('.inbox-item').first().click();
        await expect(page.locator('.inbox-item[aria-current="true"]')).toHaveCount(1);
    });
});

test.describe('what leaves and comes back', () => {
    test('the download is named after the search that shaped it', async ({ page }) => {
        await openInbox(page);
        await seed(page, [['j-host.example.com', 'Named export']]);

        const names = await page.evaluate(() => {
            const inbox = window.dashboardInstance.inbox;
            const plain = inbox.exportFileName('json');
            inbox.searchQuery = 'weekly reading';
            const searched = inbox.exportFileName('json');
            inbox.searchQuery = '';
            return { plain, searched };
        });
        // Two different lists used to land in the downloads folder under one name.
        expect(names.plain).not.toBe(names.searched);
        expect(names.searched).toContain('q-weekly-reading');
    });

    test('an exported list can be read back in', async ({ page }) => {
        await openInbox(page);
        await seed(page, [['k-host.example.com', 'Round trip']]);

        const parsed = await page.evaluate(() => {
            const inbox = window.dashboardInstance.inbox;
            const payload = JSON.stringify([
                { url: 'https://imported-one.example.com/a', title: 'Imported one', tags: ['x'] },
                { url: 'https://imported-two.example.com/b', title: 'Imported two' },
            ]);
            return {
                rows: inbox.parseImportPayload(payload)?.length,
                junk: inbox.parseImportPayload('not json at all'),
                wrapped: inbox.parseImportPayload('{"items":[{"url":"https://x.example.com"}]}')?.length,
                // A row without a URL is not a link.
                empty: inbox.parseImportPayload('[{"title":"no url"}]')?.length,
            };
        });
        expect(parsed.rows).toBe(2);
        expect(parsed.junk).toBeNull();
        expect(parsed.wrapped).toBe(1);
        expect(parsed.empty).toBe(0);

        // The whole way through: a file picked, posted, and the feed reloaded.
        await page.evaluate(() => {
            const inbox = window.dashboardInstance.inbox;
            inbox.confirm = async () => true;
            const file = new File([JSON.stringify([
                { url: 'https://imported-three.example.com/c', title: 'Imported three' },
            ])], 'inbox.json', { type: 'application/json' });
            return inbox.importFromFile(file);
        });
        await expect(page.locator('.inbox-item')).toHaveCount(2);
        await expect(page.locator('.inbox-item')).toContainText(['Imported three', 'Round trip']);
    });

    test('the Import button is in the toolbar, beside the exports', async ({ page }) => {
        await openInbox(page);
        await seed(page, [['l-host.example.com', 'Toolbar']]);
        await expect(page.locator('[data-inbox-import]')).toBeVisible();
    });
});

test.describe('what the view says in words', () => {
    test('the promote rate explains itself without a hover', async ({ page }) => {
        await openInbox(page);
        await seed(page, [['m-host.example.com', 'Stats']]);
        await page.locator('[data-inbox-stats]').click();
        const panel = page.locator('#inbox-stats-panel');
        await expect(panel).toBeVisible();
        const hints = panel.locator('.inbox-stat-hint');
        // It was a title attribute: unreachable from the keyboard and on touch,
        // on the one figure that reads as 6-of-19 when it is 6-of-11.
        await expect(hints.first()).toBeVisible();
        await expect(panel).toContainText(/decided on|sits here/i);
    });

    test('dates follow the app language, not the browser', async ({ page }) => {
        await openInbox(page);
        await seed(page, [['n-host.example.com', 'Language']]);
        const said = await page.evaluate(() => {
            const d = window.dashboardInstance;
            const march = new Date(2026, 2, 3).getTime();
            const before = d.settings.language;
            d.settings.language = 'en';
            const en = d.inbox.formatAddedDate(march);
            d.settings.language = 'nl';
            const nl = d.inbox.formatAddedDate(march);
            d.settings.language = before;
            return { en, nl };
        });
        expect(said.en).toMatch(/Mar/);
        expect(said.nl).toMatch(/mrt/);
    });

    test('a phrase from the fetched summary is searchable', async ({ page }) => {
        await openInbox(page);
        await seed(page, [['o-host.example.com', 'Plain title']]);
        const hits = await page.evaluate(() => {
            const inbox = window.dashboardInstance.inbox;
            // The name the API sends. This test set previewDescription, which
            // matched the equally wrong name the haystack read at the time; both
            // are now previewDesc.
            inbox.items[0].previewDesc = 'a distinctive summary sentence';
            inbox.searchQuery = 'distinctive summary';
            const found = inbox.getFilteredItems().length;
            inbox.searchQuery = '';
            return found;
        });
        // The summary is on the row, so a phrase read there has to be findable.
        expect(hits).toBe(1);
    });
});
