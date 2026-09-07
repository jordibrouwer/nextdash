// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays,
    prepareDashboardInteraction, markHealthTutorialSeen } = require('./e2e-helpers');

/**
 * Poll `window.scrollY` until it has stopped changing for several consecutive
 * reads. Copied from list-view-shell-sticky.spec.js rather than sleeping a
 * fixed number of milliseconds: the dashboard restores the reader's remembered
 * scroll offset on a rAF chain after boot, and a timer is only ever a guess
 * about how long that takes.
 */
async function waitForScrollSettled(page) {
    await page.evaluate(() => {
        window.__lvsScrollStable = 0;
        window.__lvsScrollLast = NaN;
    });
    await page.waitForFunction(() => {
        if (window.scrollY === window.__lvsScrollLast) {
            window.__lvsScrollStable += 1;
        } else {
            window.__lvsScrollStable = 0;
            window.__lvsScrollLast = window.scrollY;
        }
        return window.__lvsScrollStable >= 4;
    }, null, { timeout: 5_000, polling: 50 });
}

async function openHealth(page) {
    await markWhatsNewSeen(page);
    await markHealthTutorialSeen(page);
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.goto('/?hv_filter=all#health');
    await page.waitForFunction(() => window.dashboardInstance?.health != null, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await prepareDashboardInteraction(page);
    await page.waitForSelector('#dashboard-layout.health-layout .lvs', { timeout: 15_000 });
    await waitForScrollSettled(page);
}

test('health renders inside the shared shell', async ({ page }) => {
    await openHealth(page);
    await expect(page.locator('#dashboard-layout.health-layout .lvs')).toHaveCount(1);
    await expect(page.locator('.lvs-rail')).toBeVisible();
    await expect(page.locator('.lvs-header .lvs-title')).toHaveText(/health/i);
    await expect(page.locator('.lvs-body .health-view-feed')).toHaveCount(1);
});

test('the tiles are gone as a row and folded into the rail filters', async ({ page }) => {
    await openHealth(page);
    await expect(page.locator('.health-view-tiles')).toHaveCount(0);

    // Every surviving tile hook sits on a rail row that is also a filter.
    const merged = await page.evaluate(() => [...document.querySelectorAll('.lvs-rail [data-health-tile]')]
        .map((el) => [el.getAttribute('data-health-tile'), el.getAttribute('data-health-filter')]));
    expect(merged.length).toBeGreaterThan(0);
    for (const [tile, filter] of merged) {
        expect(filter, `tile "${tile}" is not also a filter`).toBe(tile);
    }
});

test('the old filter and count classes still resolve', async ({ page }) => {
    await openHealth(page);
    await expect(page.locator('.lvs-rail [data-health-filter="all"].health-view-filter-btn')).toHaveCount(1);
    await expect(page.locator('[data-health-filter="all"] .health-view-filter-count')).toHaveCount(1);
});

test('the summary carries the score, not the header', async ({ page }) => {
    await openHealth(page);
    await expect(page.locator('.lvs-rail .lvs-summary')).toBeVisible();
    await expect(page.locator('.health-view-header-meta')).toHaveCount(0);
    const score = await page.locator('.lvs-summary [data-lvs-summary-key="score"] .lvs-summary-value').textContent();
    expect(score).toMatch(/%$/);
});

test('search, sort and the overflow menu keep their hooks', async ({ page }) => {
    await openHealth(page);
    await expect(page.locator('.health-view-search-input')).toBeVisible();
    await expect(page.locator('.health-view-sort-select')).toBeVisible();
    await page.locator('[data-health-toolbar-more]').click();
    await expect(page.locator('.health-view-menu--toolbar')).toBeVisible();
});

test('rows keep their checkbox column under the shared grid', async ({ page }) => {
    await openHealth(page);
    const row = page.locator('.health-view-item').first();
    await expect(row).toHaveClass(/feed-row--with-select/);
    await expect(row).toHaveClass(/feed-row--grid/);
    await expect(row.locator('.health-view-select-box')).toHaveCount(1);
    const tracks = await row.evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length);
    expect(tracks, 'the checkbox column was lost').toBe(3);
});

test('typing in the search box does not move the caret', async ({ page }) => {
    await openHealth(page);
    const search = page.locator('.health-view-search-input');

    // Two probes, so this test fails for the right reason rather than passing
    // on a render that never happened. The feed tag proves the debounced
    // render did run (render() empties the body and builds a new feed); the
    // input tag proves that render did *not* rebuild the search box, which is
    // the whole reason the caret machinery could go.
    await page.evaluate(() => {
        document.querySelector('.health-view-feed')?.setAttribute('data-caret-probe', '1');
        document.querySelector('.health-view-search-input')?.setAttribute('data-caret-probe', '1');
    });

    await search.click();
    await search.type('ama', { delay: 60 });

    await expect.poll(() => page.evaluate(
        () => document.querySelectorAll('.health-view-feed[data-caret-probe]').length),
    { message: 'the search never triggered a re-render' }).toBe(0);

    const caret = await page.evaluate(() => {
        const el = document.querySelector('.health-view-search-input');
        return {
            focused: document.activeElement === el,
            start: el.selectionStart,
            value: el.value,
            sameNode: el.getAttribute('data-caret-probe') === '1',
        };
    });
    expect(caret).toEqual({ focused: true, start: 3, value: 'ama', sameNode: true });
});
