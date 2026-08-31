const { test, expect } = require('./fixtures');
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
    // loadAndRender only fetches when asked to or when it has never loaded, so
    // a view left loaded by an earlier test in this file never sees what was
    // just seeded — it POSTs to the server and then waits on a list the view
    // has no reason to re-read. refresh:true is the parameter for exactly this.
    await page.evaluate(() => window.dashboardInstance.inbox.loadAndRender({ refresh: true }));
    // The POSTs are accepted before the view has loaded them, so reading
    // inbox.items straight after seeding could find it empty, or half-filled —
    // which is worse, because a partial list reads as a real result.
    await expect.poll(async () => page.evaluate((wanted) => {
        const ib = window.dashboardInstance.inbox;
        return wanted.every((t) => (ib.items || []).some((i) => (i.title || '') === t));
    }, titles), { timeout: 10_000 }).toBe(true);
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

test.describe('inbox announcements', () => {
    async function open(page) {
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

    // V9 — the list changes under the user constantly and none of it was
    // announced, so filtering gave a screen-reader user no idea what happened.
    test('a polite live region reports how many rows the filter leaves', async ({ page }) => {
        await open(page);

        const live = page.locator('.inbox-live-region');
        await expect(live).toHaveAttribute('aria-live', 'polite');

        const shown = await page.evaluate(() => {
            const inbox = window.dashboardInstance.inbox;
            inbox.searchQuery = '';
            inbox.render();
            return inbox.getFilteredItems().length;
        });
        await expect(live).toContainText(String(shown));

        // And it follows a filter that matches nothing.
        await page.evaluate(() => {
            const inbox = window.dashboardInstance.inbox;
            inbox.searchQuery = 'zzz-no-match-zzz';
            inbox.render();
        });
        await expect(live).toContainText('0');
    });

    // V5 — adding at the cap pushed the oldest links out in silence.
    test('an add that evicts says so', async ({ page }) => {
        await open(page);

        await page.route('**/api/inbox', async (route) => {
            if (route.request().method() !== 'POST') return route.fallback();
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ status: 'success', item: { id: 'x', url: 'https://e.example' }, evicted: 2 }),
            });
        });

        await page.evaluate(() => window.dashboardInstance.inbox.addFromUrl('https://e.example'));
        await expect(page.locator('.app-notification', { hasText: /full/i })).toBeVisible({ timeout: 10_000 });
    });

    test('an add with room says nothing about eviction', async ({ page }) => {
        // The control: the notice must not appear on every add.
        await open(page);

        await page.route('**/api/inbox', async (route) => {
            if (route.request().method() !== 'POST') return route.fallback();
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ status: 'success', item: { id: 'y', url: 'https://f.example' }, evicted: 0 }),
            });
        });

        await page.evaluate(() => window.dashboardInstance.inbox.addFromUrl('https://f.example'));
        await page.waitForTimeout(500);
        await expect(page.locator('.app-notification', { hasText: /full/i })).toHaveCount(0);
    });
});
