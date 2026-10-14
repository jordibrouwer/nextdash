// @ts-check
const { test, expect } = require('./fixtures');
const { resetDashboardData } = require('./e2e-helpers');
const { openBookmarks } = require('./config-bookmarks-helpers');

/**
 * A delete in Work through is counted.
 *
 * Whether the delete happened was read back from the new report by the row's
 * page:index key. A delete numbers the rows after it afresh, so the next row
 * had taken that key, the bookmark read as still listed, and the summary said
 * nothing had been deleted. Only the last row of a page was ever counted.
 *
 * The report is the server's own, not a stub: the renumbering is the point.
 */

test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance != null, null, { timeout: 15_000 });
    await resetDashboardData(page);
});

test('a delete in the walk counts as deleted', async ({ page }) => {
    await openBookmarks(page);
    await page.waitForFunction(() => window.dashboardInstance.config._bmHealthModule?.report, null, { timeout: 15_000 });

    await page.locator('[data-bm-work-through]').click();
    await page.locator('[data-focus-pile="list"]').click();
    const card = page.locator('.health-focus-card');
    await expect(card).toBeVisible();

    const first = await page.evaluate(() => {
        const focus = window.dashboardInstance.config._libFocus;
        const issue = focus.currentIssue();
        const report = window.dashboardInstance.config._bmHealthModule.report.issues;
        return {
            url: issue.url,
            // Not the last row of its page: the case that went uncounted.
            later: report.some((i) => i.pageId === issue.pageId && i.index > issue.index),
        };
    });
    expect(first.later).toBe(true);

    await card.locator('[data-focus="delete"]').click();
    await page.locator('#app-modal.show #modal-actions .modal-button, #config-confirm-modal [data-confirm="ok"]').first().click();

    await expect.poll(async () => page.evaluate(async (url) =>
        (await (await fetch('/api/bookmarks?all=true')).json()).some((b) => b.url === url), first.url), { timeout: 10_000 })
        .toBe(false);
    await expect.poll(() => page.evaluate(() => window.dashboardInstance.config._libFocus.tally.deleted), { timeout: 10_000 })
        .toBe(1);
    // And the card has moved on to another bookmark.
    expect(await page.evaluate(() => window.dashboardInstance.config._libFocus.currentIssue()?.url)).not.toBe(first.url);
});
