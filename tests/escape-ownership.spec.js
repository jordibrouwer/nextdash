// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissBlockingOverlays, dismissOnboardingIfPresent } = require('./e2e-helpers');

/**
 * Who owns Escape when something is layered over a view.
 *
 * The rule the rest of the suite already pins for Health and Config: a menu or
 * dialog put on top of a view takes the Escape that closes it, and the view
 * underneath stays where it is. Three places had no test for it, and one of
 * them was a real bug -- the inbox's own document-level Escape handler ran in
 * the capture phase and called stopImmediatePropagation, so a row's context
 * menu never received the key that was meant for it.
 *
 * These are the gaps, not a restatement: dashboard-inbox, health-dashboard-view
 * and config-escape-modal already cover leaving each view, and
 * dashboard-multi-select-escape covers the grid.
 */

async function openDashboard(page) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => window.dashboardInstance?.inbox != null, null, { timeout: 15_000 });
}

async function openInboxWithItems(page, titles) {
    await openDashboard(page);
    await page.evaluate(() => { window.dashboardInstance.settings.inboxEnabled = true; });
    const stamp = Date.now();
    await page.evaluate(async ({ titles, stamp }) => {
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        for (let i = 0; i < titles.length; i += 1) {
            await api('/api/inbox', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url: `https://esc${i}-${stamp}.example/x`, title: titles[i] }),
            });
        }
    }, { titles, stamp });
    await page.locator('#page-nav-inbox-btn').click();
    await expect(page.locator('.inbox-layout')).toBeVisible();
    // Fetched rather than waited for. The POSTs are accepted before the open
    // view knows about them, and waiting for a background refresh to notice is
    // what makes the same pattern in inbox-selection-actions flaky under load.
    // Asking for the list, then drawing it, is the same two steps without the
    // race -- and it is polled because another spec's writes can land in the
    // same shared inbox between the fetch and the read.
    await expect.poll(async () => page.evaluate(async (wanted) => {
        const ib = window.dashboardInstance.inbox;
        await ib.loadItems?.();
        ib.render();
        return wanted.every((t) => (ib.items || []).some((i) => (i.title || '') === t));
    }, titles), { timeout: 15_000 }).toBe(true);
    await expect(page.locator('.inbox-item').first()).toBeVisible({ timeout: 10_000 });
}

const activeView = (page) => page.evaluate(() => window.dashboardInstance.activeView);

test.describe('Escape belongs to whatever is layered on top', () => {
    test('the inbox row menu takes it, and the inbox stays open', async ({ page }) => {
        await openInboxWithItems(page, ['Esc one', 'Esc two']);

        await page.locator('.inbox-item').first().click({ button: 'right' });
        await page.waitForSelector('#bookmark-context-menu', { timeout: 10_000 });

        await page.keyboard.press('Escape');
        // Removed rather than hidden: the menu is built per open. Two specs
        // disagree on this one; the DOM says it goes.
        await expect(page.locator('#bookmark-context-menu')).toHaveCount(0, { timeout: 5000 });
        expect(await activeView(page), 'the inbox should not have closed too').toBe('inbox');
    });

    test('the snooze picker takes it, and the inbox stays open', async ({ page }) => {
        await openInboxWithItems(page, ['Snooze me']);

        await page.evaluate(() => {
            const ib = window.dashboardInstance.inbox;
            ib.openSnoozeMenu(ib.getFilteredItems()[0], document.querySelector('.inbox-item'));
        });
        await expect(page.locator('.inbox-snooze-menu')).toBeVisible();

        await page.keyboard.press('Escape');
        await expect(page.locator('.inbox-snooze-menu')).toHaveCount(0, { timeout: 5000 });
        expect(await activeView(page), 'the inbox should not have closed too').toBe('inbox');
    });

    test('the paste choice takes it, and the grid is left alone', async ({ page }) => {
        await openDashboard(page);

        await page.evaluate(() => window.dashboardInstance.pasteChoice
            .openChoiceModal('https://www.youtube.com/watch?v=8CRqzJyjvIQ'));
        await expect(page.locator('#paste-choice-modal.show')).toBeVisible({ timeout: 5000 });

        await page.keyboard.press('Escape');
        await expect(page.locator('#paste-choice-modal.show')).toHaveCount(0, { timeout: 5000 });
        expect(await activeView(page)).toBe('bookmarks');
    });
});
