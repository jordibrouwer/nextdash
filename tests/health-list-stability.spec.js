// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissBlockingOverlays, dismissOnboardingIfPresent } = require('./e2e-helpers');

/**
 * The health list must not move under the hands of the person working through it.
 *
 * Opening a bookmark is the action this view asks for — "open it to see for
 * yourself" is in the Broken filter's own note — and it used to be punished.
 * "Never opened" and "not opened in 30 days" each cost 10 points, so the first
 * open lifted the row's score by 10; under the default worst-first sort that
 * dropped it hundreds of rows down, out of sight and out of the place the reader
 * had been holding. Measured on a 200-bookmark install: position 10 of 200
 * became position 188.
 *
 * Two halves fix it, and both are pinned here. Usage no longer costs score, and
 * the score sort's tiebreak folds the two usage statuses into healthy, so
 * nothing in the sort key changes when a row is acted on. And where a filter
 * does legitimately stop selecting the row — Unused, after you opened it — the
 * row stays at its position marked handled, until the list is asked a different
 * question.
 */

async function openHealth(page, filter) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 20_000 });
    // The health module is loaded on demand, so the view has to be opened before
    // anything can be asked of it.
    await page.evaluate(() => window.dashboardInstance.health.openHealthView());
    await page.waitForTimeout(1200);
    return page.evaluate((f) => {
        const h = window.dashboardInstance.health._module || window.dashboardInstance.health;
        h.filter = f;
        h._resetFeedPaging();
        h.render();
        return h.getFilteredIssues().length;
    }, filter);
}

/** Open the row at `position` the way the row's own Open button does. */
async function openRowAt(page, position) {
    const target = await page.evaluate((pos) => {
        const h = window.dashboardInstance.health._module || window.dashboardInstance.health;
        const issue = h.getFilteredIssues()[pos];
        if (!issue) return null;
        // The real handler calls window.open; a popup would take the test with it.
        window.open = () => null;
        h.openIssue(issue);
        return { key: h.issueKey(issue), score: issue.score, status: issue.status };
    }, position);
    await page.waitForTimeout(900);
    return target;
}

async function refreshReport(page) {
    await page.evaluate(() => {
        const h = window.dashboardInstance.health._module || window.dashboardInstance.health;
        return h.loadAndRender({ refresh: true });
    });
    await page.waitForTimeout(900);
}

async function rowState(page, key) {
    return page.evaluate((k) => {
        const h = window.dashboardInstance.health._module || window.dashboardInstance.health;
        const rows = h.getFilteredIssues();
        const index = rows.findIndex((i) => h.issueKey(i) === k);
        return { index, score: rows[index]?.score ?? null, status: rows[index]?.status ?? null };
    }, key);
}

async function orderSnapshot(page) {
    return page.evaluate(() => {
        const h = window.dashboardInstance.health._module || window.dashboardInstance.health;
        return h.getFilteredIssues().map((issue) => ({ key: h.issueKey(issue), score: issue.score }));
    });
}

test.describe('opening a bookmark does not re-rank the list', () => {
    test('the row keeps its score and its position after a fresh report', async ({ page }) => {
        const total = await openHealth(page, 'all');
        test.skip(total < 3, 'needs a few rows to have somewhere to fall to');

        const before = await orderSnapshot(page);
        const position = 1;
        const target = await openRowAt(page, position);
        expect(target).not.toBeNull();
        // The premise: a row that was never opened is exactly the one whose score
        // used to change on the first open.
        test.skip(target.status !== 'unused' && target.status !== 'stale',
            'needs a row whose usage state the open actually changes');

        await refreshReport(page);
        const after = await orderSnapshot(page);
        const now = await rowState(page, target.key);
        // Usage costs no points, so the number in the badge is the same one.
        expect(now.score).toBe(target.score);

        // Compared against the rows whose own sort key did not move: a startup
        // check landing mid-test turns another row from "never checked" into a
        // higher score, which shifts absolute positions for reasons that have
        // nothing to do with the open being tested here.
        const scoreBefore = new Map(before.map((row) => [row.key, row.score]));
        const moved = new Set(after
            .filter((row) => scoreBefore.get(row.key) !== row.score)
            .map((row) => row.key));
        const steady = (list) => list
            .filter((row) => !moved.has(row.key))
            .map((row) => row.key);
        const steadyBefore = steady(before);
        const steadyAfter = steady(after);
        expect(steadyBefore).toContain(target.key);
        expect(steadyAfter.indexOf(target.key)).toBe(steadyBefore.indexOf(target.key));
    });
});

test.describe('a row you acted on stays where it was', () => {
    test('under Unused it is kept in place and marked handled', async ({ page }) => {
        const total = await openHealth(page, 'unused');
        test.skip(total < 2, 'needs at least two never-opened bookmarks');

        const position = 1;
        const target = await openRowAt(page, position);
        expect(target).not.toBeNull();

        await refreshReport(page);
        // It no longer belongs in Unused — that is the point of having opened it
        // — and closing the gap is what used to make the list unreadable.
        expect((await rowState(page, target.key)).index).toBe(position);

        const row = page.locator(`.health-view-item[data-health-key="${target.key}"]`);
        await expect(row).toHaveClass(/health-view-item--handled/);
        await expect(row.locator('.health-view-item-handled')).toBeVisible();

        // Asking the list a different question drops the anchor: the row is gone
        // the next time you come to this filter, rather than lingering forever.
        await page.evaluate(() => {
            const h = window.dashboardInstance.health._module || window.dashboardInstance.health;
            h._resetFeedPaging();
            h.render();
        });
        await page.waitForTimeout(400);
        expect((await rowState(page, target.key)).index).toBe(-1);
    });
});
