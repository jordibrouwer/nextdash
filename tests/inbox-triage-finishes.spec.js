const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissBlockingOverlays, dismissOnboardingIfPresent,
    prepareDashboardInteraction } = require('./e2e-helpers');

/*
 * Triage has to end, and it has to be about what is left to do.
 *
 * Three faults wearing one coat. The queue was everything the filter showed,
 * read items included, while the manual promised unread ones — so a mostly-read
 * inbox handed back links already dealt with. On the last card the index wrapped
 * to zero with no signal, so the run never finished; it started over. And
 * promote, the action triage exists to produce, tore the overlay down: a flag
 * called _pendingInboxTriageAdvance was set for the resume and read nowhere, so
 * clearing forty links meant pressing t again forty times.
 *
 * Together they take the one moment triage is for — the click of a finished
 * job — and replace it with a loop that cannot be completed.
 */

/** Seed the inbox, open it, and hand back the ids in the order they went in. */
async function seedInbox(page, titles) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => window.dashboardInstance?.inbox != null, null, { timeout: 15_000 });
    // The quick-start card sits over the bookmark form's Save button on a fresh
    // store, so a click lands on the card instead.
    await prepareDashboardInteraction(page);
    await page.evaluate(() => { window.dashboardInstance.settings.inboxEnabled = true; });

    await page.evaluate(async (list) => {
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        for (const title of list) {
            await api('/api/inbox', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    url: `https://fin-${title.replace(/\W/g, '')}-${Date.now()}.example/x`,
                    title,
                }),
            });
        }
    }, titles);

    await page.locator('#page-nav-inbox-btn').click();
    await expect(page.locator('.inbox-layout')).toBeVisible();
    await page.evaluate(() => window.dashboardInstance.inbox.loadAndRender({ refresh: true }));
    await expect.poll(() => page.evaluate(
        () => (window.dashboardInstance.inbox.items || []).length
    ), { timeout: 10_000 }).toBeGreaterThanOrEqual(titles.length);
}

const queueTitles = (page) => page.evaluate(
    () => (window.dashboardInstance.inbox.triage?.queue || []).map((i) => i.title)
);

test.describe('triage can be finished', () => {
    test('the queue holds what is left to read, not what has been dealt with', async ({ page }) => {
        await seedInbox(page, ['Fin unread A', 'Fin unread B', 'Fin already read']);

        // One of them is done with. Marking it read is the ordinary way that
        // happens — the queue should not offer it back.
        await page.evaluate(async () => {
            const inbox = window.dashboardInstance.inbox;
            const done = (inbox.items || []).find((i) => i.title === 'Fin already read');
            await inbox.markRead(done.id);
            await inbox.loadAndRender({ refresh: true });
        });

        await page.keyboard.press('t');
        await expect.poll(() => page.evaluate(
            () => !!window.dashboardInstance.inbox.triage?.isOpen?.()
        ), { timeout: 10_000 }).toBe(true);

        const titles = await queueTitles(page);
        expect(titles, JSON.stringify(titles)).not.toContain('Fin already read');
        expect(titles.length).toBeGreaterThan(0);
    });

    test('the last card says the run is over instead of starting again', async ({ page }) => {
        await seedInbox(page, ['Fin last A', 'Fin last B']);
        await page.keyboard.press('t');
        await expect.poll(() => page.evaluate(
            () => !!window.dashboardInstance.inbox.triage?.isOpen?.()
        ), { timeout: 10_000 }).toBe(true);

        const total = await page.evaluate(
            () => window.dashboardInstance.inbox.triage.queue.length
        );
        expect(total).toBeGreaterThan(1);

        // Keep every one of them. Keeping does not shorten the queue, which is
        // exactly the path that used to wrap round to the first card.
        for (let i = 0; i < total; i += 1) {
            await page.keyboard.press('r');
            await page.waitForTimeout(250);
        }

        await expect(page.locator('.inbox-triage-done')).toBeVisible({ timeout: 10_000 });
        // And it did not quietly go back to the top.
        expect(await page.evaluate(
            () => window.dashboardInstance.inbox.triage.index
        )).not.toBe(0);
    });

    test('promoting a link puts you back in the run', async ({ page }) => {
        await seedInbox(page, ['Fin promote A', 'Fin promote B', 'Fin promote C']);
        await page.keyboard.press('t');
        await expect.poll(() => page.evaluate(
            () => !!window.dashboardInstance.inbox.triage?.isOpen?.()
        ), { timeout: 10_000 }).toBe(true);

        // Promote hands the screen to the bookmark form, which is why it is the
        // one action that closes the overlay.
        await page.keyboard.press('p');
        const save = page.locator('#bookmark-form-modal .bookmark-inline-actions > .bookmark-inline-save');
        await expect(save).toBeVisible({ timeout: 10_000 });

        // The flag that carries the run across the form.
        expect(await page.evaluate(() => window.dashboardInstance._pendingInboxTriageAdvance))
            .toBe(true);

        await save.click();

        // Back where it left off, without a second press of t.
        await expect.poll(() => page.evaluate(
            () => !!window.dashboardInstance.inbox.triage?.isOpen?.()
        ), { timeout: 15_000 }).toBe(true);
    });
});
