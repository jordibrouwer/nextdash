const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissBlockingOverlays, dismissOnboardingIfPresent,
    prepareDashboardInteraction } = require('./e2e-helpers');

/*
 * Five small things the inbox knew and did not say.
 *
 * Each is minor on its own; together they are the difference between a view
 * that answers questions and one that holds the answers and waits to be asked
 * somewhere else.
 */

async function openInbox(page, items) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => window.dashboardInstance?.inbox != null, null, { timeout: 15_000 });
    await prepareDashboardInteraction(page);
    await page.evaluate(() => { window.dashboardInstance.settings.inboxEnabled = true; });

    await page.evaluate(async (list) => {
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        for (const entry of list) {
            await api('/api/inbox', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    url: `https://gap-${entry.title.replace(/\W/g, '')}-${Date.now()}.example/x`,
                    title: entry.title,
                    source: entry.source,
                }),
            });
        }
    }, items);

    await page.locator('#page-nav-inbox-btn').click();
    await expect(page.locator('.inbox-layout')).toBeVisible();
    await page.evaluate(() => window.dashboardInstance.inbox.loadAndRender({ refresh: true }));
    await expect.poll(() => page.evaluate(
        () => (window.dashboardInstance.inbox.items || []).length
    ), { timeout: 10_000 }).toBeGreaterThanOrEqual(items.length);
}

test.describe('the inbox says what it knows', () => {
    test('a row shows where the link came from, unless it was pasted', async ({ page }) => {
        await openInbox(page, [
            { title: 'Gap from extension', source: 'extension' },
            { title: 'Gap from paste', source: 'paste' },
        ]);

        const rows = page.locator('.inbox-item');
        await expect(rows.first()).toBeVisible({ timeout: 10_000 });

        const shown = await page.evaluate(() => [...document.querySelectorAll('.inbox-item')]
            .map((row) => ({
                title: row.querySelector('.inbox-item-title')?.textContent?.trim() || '',
                source: row.querySelector('[data-inbox-source]')?.textContent?.trim() || null,
            })));

        const fromExtension = shown.find((r) => r.title.includes('extension'));
        const fromPaste = shown.find((r) => r.title.includes('paste'));
        expect(fromExtension?.source, JSON.stringify(shown)).toBe('extension');
        // Paste is how most links arrive, so saying it on every row is noise.
        expect(fromPaste?.source).toBeNull();
    });

    test('the promote rate matches the one Config reports', async ({ page }) => {
        await openInbox(page, [{ title: 'Gap rate', source: 'paste' }]);

        /*
         * Against a figure where the difference shows.
         *
         * On a fresh store kept is zero, so leaving it out of the sum gives the
         * same answer and the test proves nothing. kept is recorded on every
         * mark-read, which makes it the largest of the three on a real install
         * -- so the numbers are supplied rather than waited for.
         */
        const sample = { totalPromoted: 10, totalDeleted: 5, totalKept: 35 };
        const both = await page.evaluate((agg) => {
            const triaged = agg.totalPromoted + agg.totalDeleted + agg.totalKept;
            return {
                config: Math.round((agg.totalPromoted / triaged) * 100),
                inbox: window.dashboardInstance.inbox.promoteRateFromStats(agg),
            };
        }, sample);

        // 10 of 50 is 20%. Dropping kept would make it 10 of 15 — 67%, the same
        // install reporting two different rates under one name.
        expect(both.config).toBe(20);
        expect(both.inbox).toBe(both.config);
    });

    test('mark unread and tags are reachable without a right-click', async ({ page }) => {
        await openInbox(page, [{ title: 'Gap keys', source: 'paste' }]);

        // Both actions existed only in the context menu, which a phone has not
        // got — so each needs a key, and each needs a place in the row's own
        // More menu.
        const wired = await page.evaluate(() => {
            const inbox = window.dashboardInstance.inbox;
            return {
                unread: typeof inbox.markUnreadFromRow === 'function',
                tags: typeof inbox.editTags === 'function',
                keys: (window.KeyboardViewLegends?.INBOX_VIEW || []).map((e) => e.keys || ''),
            };
        });
        expect(wired.unread).toBe(true);
        expect(wired.tags).toBe(true);
        expect(wired.keys.join(' '), JSON.stringify(wired.keys)).toContain('u');
        expect(wired.keys.join(' ')).toContain('l');
    });

    test('the stats panel says which way the backlog is going', async ({ page }) => {
        await openInbox(page, [{ title: 'Gap trend', source: 'paste' }]);
        await page.evaluate(() => window.dashboardInstance.inbox.toggleStats());
        await expect(page.locator('[data-inbox-trend]')).toBeVisible({ timeout: 10_000 });
    });

    test('a tag filter that matches nothing says so', async ({ page }) => {
        await openInbox(page, [{ title: 'Gap tagless', source: 'paste' }]);

        await page.evaluate(() => {
            const inbox = window.dashboardInstance.inbox;
            inbox.tagFilter = 'a-tag-nothing-carries';
            inbox.render();
        });

        const empty = page.locator('.inbox-empty-state');
        await expect(empty).toBeVisible({ timeout: 10_000 });
        // "Inbox zero" is wrong here: links are waiting, the filter hides them.
        await expect(empty).not.toContainText(/inbox zero/i);
        await expect(page.locator('[data-inbox-clear-filters]')).toBeVisible();
    });
});
