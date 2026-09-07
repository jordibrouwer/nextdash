// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays,
    prepareDashboardInteraction, markInboxTutorialSeen } = require('./e2e-helpers');

/**
 * The inbox on the shared shell. Everything here drives the real view through
 * the controls a person would use, not through render functions.
 */
async function openInbox(page, titles = ['Alpha', 'Beta', 'Gamma']) {
    await markWhatsNewSeen(page);
    await markInboxTutorialSeen(page);
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.inbox != null, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await prepareDashboardInteraction(page);
    await page.evaluate(() => { window.dashboardInstance.settings.inboxEnabled = true; });
    await page.evaluate(async (list) => {
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        for (const title of list) {
            await api('/api/inbox', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url: `https://s-${title}-${Date.now()}.example/x`, title }),
            });
        }
    }, titles);
    await page.locator('#page-nav-inbox-btn').click();
    await expect(page.locator('.inbox-layout')).toBeVisible();
    await page.evaluate(() => window.dashboardInstance.inbox.loadAndRender({ refresh: true }));
    await expect.poll(() => page.evaluate(
        () => (window.dashboardInstance.inbox.items || []).length)).toBeGreaterThan(0);
}

test('the inbox renders inside the shared shell', async ({ page }) => {
    await openInbox(page);
    await expect(page.locator('#dashboard-layout.inbox-layout .lvs')).toHaveCount(1);
    await expect(page.locator('.lvs-rail')).toBeVisible();
    await expect(page.locator('.lvs-header .lvs-title')).toHaveText(/inbox/i);
    // The feed lives in the shell's body, not loose in the container.
    await expect(page.locator('.lvs-body .inbox-feed')).toHaveCount(1);
});

test('the filters live in the rail and still answer to their data attributes', async ({ page }) => {
    await openInbox(page);
    const railFilters = page.locator('.lvs-rail [data-inbox-filter]');
    await expect(railFilters).not.toHaveCount(0);

    // The old selectors still resolve — this is the contract the other specs rely on.
    await page.locator('[data-inbox-filter="unread"]').click();
    await expect(page.locator('.lvs-rail [data-inbox-filter="unread"]')).toHaveClass(/is-active/);
});

test('the tiles are gone as a separate row and folded into the filters', async ({ page }) => {
    await openInbox(page);

    // No second copy of the same control.
    await expect(page.locator('.inbox-tiles')).toHaveCount(0);

    // But the tile hooks still resolve, on the merged rail rows.
    for (const key of ['all', 'unread', 'snoozed']) {
        const merged = page.locator(`.lvs-rail [data-inbox-tile="${key}"]`);
        if (await merged.count() === 0) continue; // snoozed hides at zero, as before
        await expect(merged).toHaveAttribute('data-inbox-filter', key);
    }
});

test('"this week" is a readout in the summary, not a filter', async ({ page }) => {
    await openInbox(page);
    await expect(page.locator('.lvs-summary')).toBeVisible();
    await expect(page.locator('[data-inbox-tile="week"]'),
        '"this week" must not pretend to be a filter').toHaveCount(0);
});

test('search, sort and the overflow menu keep their hooks', async ({ page }) => {
    await openInbox(page);
    await expect(page.locator('[data-inbox-search]')).toBeVisible();
    await expect(page.locator('[data-inbox-sort]')).toBeVisible();

    await page.locator('[data-inbox-toolbar-more]').click();
    await expect(page.locator('[data-inbox-menu]')).toBeVisible();
    for (const sel of ['[data-inbox-export="csv"]', '[data-inbox-export="json"]',
        '[data-inbox-import]', '[data-inbox-stats]']) {
        await expect(page.locator(sel), `${sel} missing from the menu`).toBeVisible();
    }
});

test('Triage sits in the header, reachable while the list is scrolled', async ({ page }) => {
    await openInbox(page, Array.from({ length: 40 }, (_, i) => `Item ${i}`));
    await expect(page.locator('.lvs-header .inbox-triage-btn')).toBeVisible();

    // Polled rather than waited out: a fixed pause is a guess about how long the
    // scroll and the sticky header take to settle, and the thing this test cares
    // about is the settled position, not the delay.
    await page.evaluate(() => window.scrollTo(0, 1500));
    await expect.poll(async () => page.evaluate(() => new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve(Math.round(window.scrollY))));
    }))).toBeGreaterThan(0);

    const inView = await page.evaluate(() => {
        const box = document.querySelector('.inbox-triage-btn').getBoundingClientRect();
        return box.top >= 0 && box.bottom <= window.innerHeight;
    });
    expect(inView, 'Triage scrolled out of reach').toBe(true);
});
