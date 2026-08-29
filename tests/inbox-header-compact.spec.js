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

test('the summary reads as one line, like health', async ({ page }) => {
    await openInbox(page);

    const tiles = page.locator('.inbox-tiles');
    await expect(tiles).toBeVisible();
    const height = await tiles.evaluate((el) => Math.round(el.getBoundingClientRect().height));
    expect(height, `inbox tile strip is ${height}px tall`).toBeLessThan(48);

    // Three of the four still filter; "This week" is a readout with no filter.
    expect(await page.locator('[data-inbox-tile]').count()).toBe(3);
});

test('every filter pill is on screen without scrolling sideways', async ({ page }) => {
    await openInbox(page);

    const overflow = await page.evaluate(() => {
        const strip = document.querySelector('.inbox-filter-group');
        if (!strip) return { error: 'no pill strip' };
        const box = strip.getBoundingClientRect();
        return {
            cut: [...strip.querySelectorAll('[data-inbox-filter]')]
                .filter((pill) => pill.getBoundingClientRect().right > box.right + 1)
                .map((pill) => pill.textContent.trim()),
        };
    });
    expect(overflow.error).toBeUndefined();
    expect(overflow.cut, JSON.stringify(overflow)).toEqual([]);
});

test('the rare actions are one click away, not seven buttons wide', async ({ page }) => {
    await openInbox(page);

    // Triage is why anyone opens the inbox, so it keeps its place — the way
    // Work through does in health. Help explains the view rather than acting on
    // it, and stays too.
    await expect(page.locator('.inbox-triage-btn')).toBeVisible();
    await expect(page.locator('.inbox-help-btn')).toBeVisible();

    const more = page.locator('[data-inbox-toolbar-more]');
    await expect(more).toBeVisible();
    await expect(page.locator('[data-inbox-export="csv"]')).toBeHidden();

    await more.click();
    for (const sel of ['[data-inbox-export="csv"]', '[data-inbox-export="json"]',
        '[data-inbox-import]', '[data-inbox-stats]']) {
        await expect(page.locator(sel), `${sel} missing from the menu`).toBeVisible();
    }
});

test('the menu opens under the button, not at the edge of the window', async ({ page }) => {
    await openInbox(page);
    await page.locator('[data-inbox-toolbar-more]').click();

    // The same assertion the health view carries: a menu positioned against the
    // toolbar rather than its button lands at the far side of the view.
    const gap = await page.evaluate(() => {
        const button = document.querySelector('[data-inbox-toolbar-more]').getBoundingClientRect();
        const menu = document.querySelector('[data-inbox-menu]').getBoundingClientRect();
        return { dx: Math.abs(menu.left - button.left), dy: menu.top - button.bottom };
    });
    expect(gap.dx, `menu sits ${Math.round(gap.dx)}px sideways from its button`).toBeLessThan(40);
    expect(gap.dy, `menu sits ${Math.round(gap.dy)}px below its button`).toBeLessThan(24);
});

test('the count sits on the subtitle line, level with the health view', async ({ page }) => {
    await openInbox(page);

    // Beside the heading the count rode a line higher than the health view's
    // score badge, and switching between the two views is exactly where that
    // shows. Both headers now put their meta on the second row.
    const rows = await page.evaluate(() => {
        const mid = (sel) => {
            const el = document.querySelector(sel);
            const box = el.getBoundingClientRect();
            return box.top + box.height / 2;
        };
        return {
            meta: mid('.inbox-header-meta'),
            subtitle: mid('.inbox-subtitle'),
            title: mid('.inbox-title'),
        };
    });
    const offSubtitle = Math.abs(rows.meta - rows.subtitle);
    expect(offSubtitle, `count sits ${Math.round(offSubtitle)}px off the subtitle line`).toBeLessThan(4);
    expect(rows.meta, 'count is back up on the heading line').toBeGreaterThan(rows.title + 4);
});

test('Triage and the menu share a row, with the help button at the far end', async ({ page }) => {
    await openInbox(page);

    // The health view's shape: the action row is its own full-width line under
    // the filters, so Triage and the ⋯ land where their health counterparts do
    // instead of trailing the search box. The ℹ is pushed to the right end,
    // where it cannot be hit while reaching for an action.
    const row = await page.evaluate(() => {
        const box = (sel) => {
            const el = document.querySelector(sel);
            const r = el.getBoundingClientRect();
            return { left: r.left, right: r.right, mid: r.top + r.height / 2 };
        };
        return {
            actions: box('.inbox-toolbar-actions'),
            triage: box('.inbox-triage-btn--primary'),
            more: box('[data-inbox-toolbar-more]'),
            help: box('.inbox-help-btn'),
            filters: box('.inbox-filter-group'),
        };
    });

    // One row, below the filters.
    expect(row.triage.mid, 'Triage is not on the action row').toBeCloseTo(row.more.mid, 0);
    expect(row.help.mid, 'the help button dropped off the action row').toBeCloseTo(row.more.mid, 0);
    expect(row.actions.mid, 'the action row is not below the filters').toBeGreaterThan(row.filters.mid + 4);

    // Triage leads it; the ℹ closes it.
    expect(row.triage.left).toBeLessThan(row.more.left);
    const fromEnd = row.actions.right - row.help.right;
    expect(fromEnd, `help button sits ${Math.round(fromEnd)}px short of the right edge`).toBeLessThan(8);
});
