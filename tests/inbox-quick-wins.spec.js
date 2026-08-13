const { test, expect } = require('@playwright/test');
const { markWhatsNewSeen, dismissBlockingOverlays, dismissOnboardingIfPresent } = require('./e2e-helpers');

/**
 * The five quick wins from the inbox audit.
 *
 * Q1 a failed load looked identical to an empty inbox; Q2 the cursor was
 * dropped after a delete; Q3 Escape and the view keys died on an empty list;
 * Q4 loadAndRender's refresh parameter was never passed by anyone; Q5 there
 * was no select-all chord and x did not advance.
 */

async function openInbox(page) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => window.dashboardInstance?.inbox != null, null, { timeout: 15_000 });
    await page.evaluate(() => { window.dashboardInstance.settings.inboxEnabled = true; });
}

async function seed(page, titles) {
    const stamp = Date.now();
    await page.evaluate(async ({ titles, stamp }) => {
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        for (let i = 0; i < titles.length; i += 1) {
            await api('/api/inbox', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url: `https://qw${i}-${stamp}.example/x`, title: titles[i] }),
            });
        }
    }, { titles, stamp });
    await page.locator('#page-nav-inbox-btn').click();
    await expect(page.locator('.inbox-layout')).toBeVisible();
}

test.describe('inbox quick wins', () => {
    // Q1 — the highest-value one: an unreachable server used to say "No links
    // yet" and invite the user to add more.
    test('a failed load says so and offers a retry, not an empty inbox', async ({ page }) => {
        await openInbox(page);
        await page.route('**/api/inbox', (route) => {
            if (route.request().method() === 'GET') return route.fulfill({ status: 500, body: 'nope' });
            return route.fallback();
        });

        await page.evaluate(async () => {
            const inbox = window.dashboardInstance.inbox;
            inbox.items = [];
            inbox._itemsLoaded = false;
            await inbox.loadAndRender();
        });

        await expect(page.locator('.inbox-empty-title')).toContainText(/unable to load/i);
        await expect(page.locator('.inbox-retry-btn')).toBeVisible();
        // The distinguishing part: it must NOT be the "nothing here yet" copy.
        await expect(page.locator('.inbox-empty-title')).not.toContainText(/no links yet/i);

        // And the retry actually re-fetches once the server is back.
        await page.unroute('**/api/inbox');
        await page.locator('.inbox-retry-btn').click();
        await expect.poll(() => page.evaluate(() => window.dashboardInstance.inbox._loadFailed)).toBe(false);
    });

    test('an empty inbox still reads as empty, not as a failure', async ({ page }) => {
        // The control for the test above: without it, a check that always showed
        // the failure panel would pass just as well.
        await openInbox(page);
        await page.evaluate(async () => {
            const inbox = window.dashboardInstance.inbox;
            inbox._loadFailed = false;
            inbox.items = [];
            inbox.render();
        });
        await expect(page.locator('.inbox-empty-title')).toContainText(/no links yet/i);
        await expect(page.locator('.inbox-retry-btn')).toHaveCount(0);
    });

    // Q2
    test('deleting a row moves the cursor to its neighbour', async ({ page }) => {
        await openInbox(page);
        await seed(page, ['QW one', 'QW two', 'QW three']);

        const ids = await page.evaluate(() => {
            const visible = window.dashboardInstance.inbox.getFilteredItems();
            return visible.slice(0, 2).map((i) => i.id);
        });
        expect(ids.length).toBe(2);

        await page.evaluate(async (id) => {
            const inbox = window.dashboardInstance.inbox;
            inbox.selectedItemId = id;
            await inbox.deleteItemWithUndo(id, { silent: true });
        }, ids[0]);

        // Not null, and not the row that just went.
        const after = await page.evaluate(() => window.dashboardInstance.inbox.selectedItemId);
        expect(after).not.toBeNull();
        expect(after).not.toBe(ids[0]);
    });

    // Q3 — the ticks survive a filter that hides them, so Escape has to keep
    // working when the list is empty; it was unreachable exactly then.
    test('Escape clears ticks even when the filter leaves nothing on screen', async ({ page }) => {
        await openInbox(page);
        await seed(page, ['QW alpha', 'QW beta']);

        await page.evaluate(() => {
            const inbox = window.dashboardInstance.inbox;
            const first = inbox.getFilteredItems()[0];
            inbox.setChecked(first.id, true);
            inbox.searchQuery = 'zzz-nothing-matches-zzz';
            inbox.render();
        });
        expect(await page.evaluate(() => window.dashboardInstance.inbox.checkedIds.size)).toBe(1);
        await expect(page.locator('.inbox-item')).toHaveCount(0);

        await page.keyboard.press('Escape');
        expect(await page.evaluate(() => window.dashboardInstance.inbox.checkedIds.size)).toBe(0);
    });

    // Q4 — asserted on the refresh call itself rather than on a GET count: the
    // preview poll and the badge refresh both fetch /api/inbox in the
    // background, so counting requests passes with or without the binding.
    test('R re-fetches the feed', async ({ page }) => {
        await openInbox(page);
        await seed(page, ['QW refresh']);

        await page.evaluate(() => {
            const inbox = window.dashboardInstance.inbox;
            window.__refreshCalls = [];
            const original = inbox.loadAndRender.bind(inbox);
            inbox.loadAndRender = (opts = {}) => {
                window.__refreshCalls.push(Boolean(opts.refresh));
                return original(opts);
            };
        });

        await page.keyboard.press('R');
        await expect
            .poll(() => page.evaluate(() => (window.__refreshCalls || []).some(Boolean)), { timeout: 5000 })
            .toBe(true);
    });

    // Q5
    test('Ctrl+A ticks every visible row, and again clears them', async ({ page }) => {
        await openInbox(page);
        await seed(page, ['QW sel one', 'QW sel two']);

        const visible = await page.evaluate(() => window.dashboardInstance.inbox.getFilteredItems().length);
        expect(visible).toBeGreaterThan(1);

        await page.keyboard.press('Control+a');
        expect(await page.evaluate(() => window.dashboardInstance.inbox.checkedIds.size)).toBe(visible);

        await page.keyboard.press('Control+a');
        expect(await page.evaluate(() => window.dashboardInstance.inbox.checkedIds.size)).toBe(0);
    });

    test('x ticks the row and moves on', async ({ page }) => {
        await openInbox(page);
        await seed(page, ['QW adv one', 'QW adv two']);

        const first = await page.evaluate(() => {
            const inbox = window.dashboardInstance.inbox;
            const item = inbox.getFilteredItems()[0];
            inbox.selectedItemId = item.id;
            inbox.applyKeyboardSelection();
            return item.id;
        });

        await page.keyboard.press('x');

        expect(await page.evaluate((id) => window.dashboardInstance.inbox.checkedIds.has(id), first)).toBe(true);
        expect(await page.evaluate(() => window.dashboardInstance.inbox.selectedItemId)).not.toBe(first);
    });
});
