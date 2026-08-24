const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissBlockingOverlays, dismissOnboardingIfPresent } = require('./e2e-helpers');

/**
 * V1–V3 from the inbox audit: the bulk bar's reach and missing actions,
 * range selection, and the right-click menu's inbox actions.
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
                body: JSON.stringify({ url: `https://sel${i}-${stamp}.example/x`, title: titles[i] }),
            });
        }
    }, { titles, stamp });
    await page.locator('#page-nav-inbox-btn').click();
    await expect(page.locator('.inbox-layout')).toBeVisible();
    // The POSTs are accepted before the view has loaded them, so reading
    // inbox.items straight after seeding could find it empty, or half-filled —
    // which is worse, because a partial list reads as a real result.
    await expect.poll(async () => page.evaluate((wanted) => {
        const ib = window.dashboardInstance.inbox;
        return wanted.every((t) => (ib.items || []).some((i) => (i.title || '') === t));
    }, titles), { timeout: 10_000 }).toBe(true);
}

test.describe('inbox selection and row actions', () => {
    // V1 — the bulk buttons only ever act on visible rows, so a filter change
    // silently shrank their reach with no explanation.
    test('the bulk bar names ticked rows the filter is hiding', async ({ page }) => {
        await openInbox(page);
        await seed(page, ['SEL keep me', 'SEL hide me']);

        const hiddenTitle = 'SEL hide me';
        await page.evaluate((title) => {
            const inbox = window.dashboardInstance.inbox;
            inbox.getFilteredItems().forEach((item) => inbox.setChecked(item.id, true));
            // Narrow to one row, stranding the rest of the ticks.
            const keep = inbox.items.find((i) => i.title !== title);
            inbox.searchQuery = keep.title;
            inbox.render();
        }, hiddenTitle);

        await expect(page.locator('.inbox-selection-offscreen-text')).toBeVisible();
        await expect(page.locator('.inbox-selection-offscreen-text')).toContainText(/not shown/i);

        // And the escape hatch narrows the selection to what is on screen.
        const before = await page.evaluate(() => window.dashboardInstance.inbox.checkedIds.size);
        expect(before).toBeGreaterThan(1);
        await page.locator('[data-inbox-selection="keep-visible"]').click();
        const after = await page.evaluate(() => window.dashboardInstance.inbox.checkedIds.size);
        expect(after).toBeLessThan(before);
        await expect(page.locator('.inbox-selection-offscreen-text')).toHaveCount(0);
    });

    test('the bulk bar offers Open and Copy links', async ({ page }) => {
        await openInbox(page);
        await seed(page, ['SEL open one', 'SEL open two']);

        await page.evaluate(() => {
            const inbox = window.dashboardInstance.inbox;
            inbox.setChecked(inbox.getFilteredItems()[0].id, true);
        });

        await expect(page.locator('[data-inbox-selection="open"]')).toBeVisible();
        await expect(page.locator('[data-inbox-selection="copy"]')).toBeVisible();
    });

    test('copying the selection puts one URL per line on the clipboard', async ({ page }) => {
        await openInbox(page);
        await seed(page, ['SEL copy one', 'SEL copy two']);

        const urls = await page.evaluate(async () => {
            const inbox = window.dashboardInstance.inbox;
            window.__copied = null;
            // Stubbed rather than driven for real: headless Chromium needs a
            // permission grant the test cannot rely on, and what is under test
            // is the payload, not the API.
            Object.defineProperty(navigator, 'clipboard', {
                configurable: true,
                value: { writeText: (t) => { window.__copied = t; return Promise.resolve(); } },
            });
            const picked = inbox.getFilteredItems().slice(0, 2);
            picked.forEach((item) => inbox.setChecked(item.id, true));
            await inbox.bulkCopyLinks();
            return picked.map((i) => i.url);
        });

        const copied = await page.evaluate(() => window.__copied);
        expect(copied.split('\n').sort()).toEqual(urls.sort());
    });

    // V2
    test('shift-extending ticks the whole range', async ({ page }) => {
        await openInbox(page);
        await seed(page, ['SEL range a', 'SEL range b', 'SEL range c']);

        const count = await page.evaluate(() => {
            const inbox = window.dashboardInstance.inbox;
            const visible = inbox.getFilteredItems();
            inbox.setChecked(visible[0].id, true);
            inbox.checkAnchorId = visible[0].id;
            inbox.extendCheckedTo(visible[2].id, true);
            return inbox.checkedIds.size;
        });
        expect(count).toBe(3);
    });

    test('shift+arrow extends the selection as the cursor moves', async ({ page }) => {
        await openInbox(page);
        await seed(page, ['SEL arrow a', 'SEL arrow b', 'SEL arrow c']);

        const ids = await page.evaluate(() => {
            const inbox = window.dashboardInstance.inbox;
            inbox.clearChecked();
            const visible = inbox.getFilteredItems();
            inbox.selectedItemId = visible[0].id;
            inbox.applyKeyboardSelection();
            return visible.slice(0, 3).map((i) => i.id);
        });

        // Two presses must reach three rows: the anchor plus the two stepped
        // over. Asserting on the exact set, not just "more than one" — anchoring
        // alone would satisfy that without extending anything.
        await page.keyboard.press('Shift+ArrowDown');
        await page.keyboard.press('Shift+ArrowDown');

        const checked = await page.evaluate(() => [...window.dashboardInstance.inbox.checkedIds]);
        expect(checked.sort()).toEqual(ids.sort());
    });

    // V3 — right-click used to reach the bookmark menu, with no inbox action.
    test('right-clicking a row offers the inbox actions', async ({ page }) => {
        await openInbox(page);
        await seed(page, ['SEL menu row']);

        await page.locator('.inbox-item').first().click({ button: 'right' });
        await page.waitForSelector('#bookmark-context-menu', { timeout: 10_000 });

        const menu = page.locator('#bookmark-context-menu');
        await expect(menu.locator('[data-action="inbox-promote"]')).toBeVisible();
        await expect(menu.locator('[data-action="inbox-snooze"]')).toBeVisible();
        await expect(menu.locator('[data-action="inbox-note"]')).toBeVisible();
        await expect(menu.locator('[data-action="inbox-delete"]')).toBeVisible();
    });

    test('the menu drops Mark read once the row is read', async ({ page }) => {
        await openInbox(page);
        await seed(page, ['SEL read row']);

        // Unread: the entry is offered.
        await page.locator('.inbox-item').first().click({ button: 'right' });
        await page.waitForSelector('#bookmark-context-menu', { timeout: 10_000 });
        await expect(page.locator('#bookmark-context-menu [data-action="inbox-read"]')).toBeVisible();
        await page.keyboard.press('Escape');

        // Read: markReadFromKeyboard would be a no-op, so it is left out.
        await page.evaluate(async () => {
            const inbox = window.dashboardInstance.inbox;
            const item = inbox.getFilteredItems()[0];
            await inbox.markRead(item.id);
            item.readAt = Date.now();
            inbox.render();
        });
        await page.locator('.inbox-item').first().click({ button: 'right' });
        await page.waitForSelector('#bookmark-context-menu', { timeout: 10_000 });
        await expect(page.locator('#bookmark-context-menu [data-action="inbox-read"]')).toHaveCount(0);
    });
});
