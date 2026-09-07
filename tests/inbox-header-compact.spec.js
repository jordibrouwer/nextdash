// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays,
    prepareDashboardInteraction } = require('./e2e-helpers');

/**
 * The inbox header, matched to the health view's.
 *
 * The two views are siblings by design — the same pills, the same j/k, the same
 * shape of list — so a change to how one gets you to its rows has to reach the
 * other, or they stop reading as one app. Health lost about 160px between its
 * heading and its first row: tiles to a line, filters that no longer scroll out
 * of sight, and seven of nine buttons behind a ⋯.
 *
 * Task 6/7 moved the inbox into the shared list-view shell: the tile strip
 * became the rail's filter list plus a summary readout, and the action row
 * collapsed into the shell header. The tests below describe that shape.
 */
async function openInbox(page, titles = ['Header A', 'Header B']) {
    await markWhatsNewSeen(page);
    await page.setViewportSize({ width: 1280, height: 800 });
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
                body: JSON.stringify({
                    url: `https://hdr-${title.replace(/\W/g, '')}-${Date.now()}.example/x`,
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
    ), { timeout: 10_000 }).toBeGreaterThan(0);
}

test('the summary is a rail block, not a row above the list', async ({ page }) => {
    await openInbox(page);
    await expect(page.locator('.inbox-tiles')).toHaveCount(0);
    const summary = page.locator('.lvs-rail .lvs-summary');
    await expect(summary).toBeVisible();
    // It sits left of the list, not above it.
    const sides = await page.evaluate(() => ({
        summary: document.querySelector('.lvs-summary').getBoundingClientRect().right,
        feed: document.querySelector('.inbox-feed').getBoundingClientRect().left,
    }));
    expect(sides.summary).toBeLessThanOrEqual(sides.feed);
});

test('every filter is visible without scrolling sideways', async ({ page }) => {
    await openInbox(page);
    const cut = await page.evaluate(() => {
        const rail = document.querySelector('.lvs-group--filters');
        const box = rail.getBoundingClientRect();
        return [...rail.querySelectorAll('[data-inbox-filter]')]
            .filter((el) => el.getBoundingClientRect().right > box.right + 1)
            .map((el) => el.textContent.trim());
    });
    expect(cut).toEqual([]);
});

test('the rare actions stay one click away behind the ⋯', async ({ page }) => {
    await openInbox(page);
    await expect(page.locator('.inbox-triage-btn')).toBeVisible();
    await expect(page.locator('.inbox-help-btn')).toBeVisible();
    await expect(page.locator('[data-inbox-export="csv"]')).toBeHidden();

    await page.locator('[data-inbox-toolbar-more]').click();
    for (const sel of ['[data-inbox-export="csv"]', '[data-inbox-export="json"]',
        '[data-inbox-import]', '[data-inbox-stats]']) {
        await expect(page.locator(sel), `${sel} missing from the menu`).toBeVisible();
    }
});

test('the menu opens under its button, not at the edge of the window', async ({ page }) => {
    await openInbox(page);
    await page.locator('[data-inbox-toolbar-more]').click();
    // The menu is wider than the ⋯ button, and dashboard-inbox.css anchors it
    // to the button's *right* edge on purpose (see buildHeaderActions's doc
    // comment) so a 13rem menu off a button near the header's right edge opens
    // leftwards instead of hanging off the window. Left edges therefore differ
    // by design; what has to hold is the right edge and the vertical gap.
    const gap = await page.evaluate(() => {
        const button = document.querySelector('[data-inbox-toolbar-more]').getBoundingClientRect();
        const menu = document.querySelector('[data-inbox-menu]').getBoundingClientRect();
        return { dx: Math.abs(menu.right - button.right), dy: menu.top - button.bottom };
    });
    expect(gap.dx).toBeLessThan(4);
    expect(gap.dy).toBeLessThan(24);
});
