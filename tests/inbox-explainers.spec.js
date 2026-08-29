// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissBlockingOverlays, dismissOnboardingIfPresent,
    openInboxToolbarMenu } = require('./e2e-helpers');

/**
 * In-view explanation for the inbox, matching the health view: a sentence about
 * the active filter under the toolbar, and the ℹ that opens the longer "how this
 * works".
 *
 * Also covers the parity work that came with it — counts on every filter pill,
 * and empty states worded for the filter that came up empty rather than the one
 * generic "no matching links" that read like a failed search even when the user
 * had just finished the job.
 */

async function openInbox(page) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => window.dashboardInstance?.inbox != null, null, { timeout: 15_000 });
    await page.evaluate(() => { window.dashboardInstance.settings.inboxEnabled = true; });

    // Exact counts and empty states both depend on knowing what is in the list.
    await page.evaluate(async () => {
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        const res = await api('/api/inbox');
        const body = await res.json().catch(() => null);
        const items = Array.isArray(body) ? body : (body?.items || []);
        await Promise.all(items.map((item) =>
            api(`/api/inbox?id=${encodeURIComponent(item.id)}`, { method: 'DELETE' })
        ));
    });

    await page.locator('#page-nav-inbox-btn').click();
    await expect(page.locator('.inbox-layout')).toBeVisible();
}

/**
 * Seed `n` links and re-fetch.
 *
 * `expected` is how many rows should end up on screen, which is not `n` once the
 * seed count passes the 50-row page size — the rest arrive as the list is
 * scrolled.
 */
async function seed(page, n, expected = n) {
    const stamp = Date.now();
    await page.evaluate(async ({ stamp, n }) => {
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        for (let i = 0; i < n; i += 1) {
            await api('/api/inbox', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    url: `https://explain-seed-${stamp}-${i}.example.com`,
                    title: `Explainer seed ${i + 1}`,
                }),
            });
        }
    }, { stamp, n });
    await page.evaluate(() => window.dashboardInstance.inbox.loadAndRender?.({ refresh: true }));
    await expect(page.locator('.inbox-item')).toHaveCount(expected);
}

test.describe('inbox view explanations', () => {
    test('the note under the toolbar describes the active filter', async ({ page }) => {
        await openInbox(page);
        await seed(page, 2);

        const note = page.locator('.inbox-filter-note');
        await expect(note).toBeVisible();
        // The "All" note's job is to say where the snoozed links went.
        await expect(note).toContainText(/snoozed/i);
    });

    test('the note changes with the filter', async ({ page }) => {
        await openInbox(page);
        await seed(page, 2);

        const note = page.locator('.inbox-filter-note');
        const all = await note.textContent();

        await page.locator('[data-inbox-filter="unread"]').click();
        await expect(page.locator('[data-inbox-filter="unread"]')).toHaveClass(/is-active/);
        const unread = await note.textContent();

        expect(unread).not.toBe(all);
        expect(unread).toMatch(/opened|kept/i);
    });

    test('the note renders on a filter that matched nothing', async ({ page }) => {
        await openInbox(page);
        await seed(page, 1);

        // Nothing is snoozed, so this filter is empty — the note is the only thing
        // left saying what was being looked for.
        await page.evaluate(() => {
            window.dashboardInstance.inbox.filter = 'snoozed';
            window.dashboardInstance.inbox.render();
        });

        await expect(page.locator('.inbox-empty-state')).toBeVisible();
        await expect(page.locator('.inbox-filter-note')).toBeVisible();
        await expect(page.locator('.inbox-filter-note')).toContainText(/set aside|wake/i);
    });

    test('the ℹ opens the explainer and it closes again', async ({ page }) => {
        await openInbox(page);
        await seed(page, 1);

        await page.locator('[data-inbox-help]').click();

        const modal = page.locator('#app-modal .modal.inbox-explain-modal');
        await expect(modal).toBeVisible();
        await expect(modal).toContainText(/how the inbox works/i);
        // The sections that carry the reasoning, not just the title.
        await expect(modal.locator('.view-explain-row')).toHaveCount(5);
        await expect(modal).toContainText(/snoozing/i);
        await expect(modal).toContainText(/promote/i);

        // Informational only: the single action is the dismiss, with no Cancel
        // beside it suggesting the explanation could be declined.
        const buttons = page.locator('#app-modal .modal-button');
        await expect(buttons).toHaveCount(1);
        await expect(buttons).toContainText(/got it/i);

        await buttons.click();
        await expect(modal).toBeHidden();
    });

    test('the explainer body scrolls instead of the panel outgrowing the window', async ({ page }) => {
        await page.setViewportSize({ width: 900, height: 700 });
        await openInbox(page);
        await seed(page, 1);

        await page.locator('[data-inbox-help]').click();
        const modal = page.locator('#app-modal .modal.inbox-explain-modal');
        await expect(modal).toBeVisible();

        // The panel has to stay inside the viewport with a margin, which is what
        // the shared cap in view-explainers.css exists for.
        const box = await modal.boundingBox();
        expect(box).not.toBeNull();
        expect(box.height).toBeLessThan(700);
        expect(box.y).toBeGreaterThan(0);
    });

    test('every filter pill carries its own count', async ({ page }) => {
        await openInbox(page);
        await seed(page, 3);

        // All and Unread used to render without one, so the row only said how much
        // work was under a filter for the two pills that happened to have counts.
        await expect(page.locator('[data-inbox-filter="all"] .inbox-filter-count')).toHaveText('3');
        await expect(page.locator('[data-inbox-filter="unread"] .inbox-filter-count')).toHaveText('3');
    });

    test('an empty Unread reads as caught up, not as a failed search', async ({ page }) => {
        await openInbox(page);
        await seed(page, 1);

        // Mark the only link read through the toolbar, the way a user clears it:
        // the bulk actions live behind the ⋯ menu now.
        await openInboxToolbarMenu(page);
        await page.locator('[data-inbox-bulk="read"]').click();
        await page.locator('[data-inbox-filter="unread"]').click();
        await expect(page.locator('[data-inbox-filter="unread"]')).toHaveClass(/is-active/);

        const empty = page.locator('.inbox-empty-state');
        await expect(empty).toBeVisible();
        await expect(empty).toContainText(/no unread links/i);
        await expect(empty).toContainText(/caught up/i);
        await expect(empty).not.toContainText(/no matching links/i);
    });

    test('scrolling loads the next page of rows without a button', async ({ page }) => {
        test.slow();
        await openInbox(page);
        // One over the 50-row page size, so exactly one more page has to load.
        // Only the first 50 render, behind a sentinel rather than the "Show N
        // more" button the view used to need.
        await seed(page, 51, 50);

        await expect(page.locator('.inbox-load-sentinel')).toHaveCount(1);
        await expect(page.locator('.inbox-load-more-btn')).toHaveCount(0);

        // Scroll the window rather than the sentinel itself: the render that
        // follows replaces the element, so a locator action on it can resolve
        // against a node that is already detached.
        await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
        await expect(page.locator('.inbox-item')).toHaveCount(51);
        // Everything is shown, so the sentinel has done its job and goes.
        await expect(page.locator('.inbox-load-sentinel')).toHaveCount(0);
    });

    test('a search that matches nothing still reads as a failed search', async ({ page }) => {
        await openInbox(page);
        await seed(page, 2);

        // The one case where the generic wording is right: the list is empty
        // because of the query, not because the inbox is clear.
        await page.locator('.inbox-search-input').fill('zzz-nothing-matches-this');

        const empty = page.locator('.inbox-empty-state');
        await expect(empty).toBeVisible();
        await expect(empty).toContainText(/no matching links/i);
    });
});
