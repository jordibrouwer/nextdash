const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissBlockingOverlays, dismissOnboardingIfPresent,
    prepareDashboardInteraction } = require('./e2e-helpers');

/**
 * Select all from the ⋯ menu.
 *
 * Ctrl/Cmd+A already ticked the filtered list, which left the whole of the bulk
 * bar behind a chord nobody finds without the cheat sheet. Driven through the
 * menu button rather than checkAllVisible(), so the test fails if the entry
 * stops being rendered or stops being wired.
 */

async function openInbox(page) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => window.dashboardInstance?.inbox != null, null, { timeout: 15_000 });
    // A previous test can leave the dashboard on another view, and the guided
    // flow lock can leave the header inert — both make the inbox button present
    // but unclickable.
    await prepareDashboardInteraction(page);
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
                body: JSON.stringify({ url: `https://sa${i}-${stamp}.example/x`, title: titles[i] }),
            });
        }
    }, { titles, stamp });
    // Shift+I rather than the tab button: the header folds page tabs past its
    // cap into "+N", and the inbox tab is one of the ones that folds — the
    // button is in the DOM but not clickable. The chord is a real entry point
    // and is not subject to the fold.
    await page.keyboard.press('Shift+I');
    await expect(page.locator('.inbox-layout')).toBeVisible();
    await expect.poll(async () => page.evaluate(async (wanted) => {
        const ib = window.dashboardInstance.inbox;
        await ib.loadItems?.();
        ib.render();
        return wanted.every((t) => (ib.items || []).some((i) => (i.title || '') === t));
    }, titles), { timeout: 15_000 }).toBe(true);
}

/** The ⋯ menu closes on every click inside it, so each use reopens it. */
async function openMenu(page) {
    await page.locator('[data-inbox-toolbar-more]').click();
    await expect(page.locator('[data-inbox-menu]')).toBeVisible();
}

test.describe('inbox select all button', () => {
    test('the menu button ticks the filtered list, and unticks it again', async ({ page }) => {
        await openInbox(page);
        await seed(page, ['SA one', 'SA two', 'SA three']);

        const visible = await page.evaluate(
            () => window.dashboardInstance.inbox.getFilteredItems().length
        );
        expect(visible).toBeGreaterThan(0);

        await openMenu(page);
        const button = page.locator('[data-inbox-select-all]');
        await expect(button).toBeVisible();
        await expect(button).toContainText(String(visible));
        await button.click();

        await expect.poll(async () => page.evaluate(
            () => window.dashboardInstance.inbox.checkedIds.size
        )).toBe(visible);
        await expect(page.locator('.inbox-selection-count')).toBeVisible();

        // Same entry, reading the other way now that everything is ticked.
        await openMenu(page);
        await expect(button).toContainText(/deselect/i);
        await button.click();
        await expect.poll(async () => page.evaluate(
            () => window.dashboardInstance.inbox.checkedIds.size
        )).toBe(0);
    });

    test('it is left out when the filters leave nothing to select', async ({ page }) => {
        await openInbox(page);
        await seed(page, ['SA empty case']);

        await page.evaluate(() => {
            const ib = window.dashboardInstance.inbox;
            ib.searchQuery = 'zzz-nothing-matches-this-zzz';
            ib.render();
        });
        await openMenu(page);
        await expect(page.locator('[data-inbox-select-all]')).toHaveCount(0);
    });
});
