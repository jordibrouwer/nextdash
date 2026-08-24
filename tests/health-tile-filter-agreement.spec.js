// @ts-check
const { test, expect } = require('./fixtures');
const { prepareDashboardInteraction } = require('./e2e-helpers');

/**
 * A KPI tile and its filter must describe the same set.
 *
 * A bookmark can be several things at once, but its status carries only the worst
 * one. The tiles are tallied from every condition that holds, so filtering on
 * status made the two disagree: the Unused tile counted a bookmark that was also a
 * duplicate, then listed nothing when you clicked it. Filtering now matches
 * issue.flags, which carries all of them.
 */

/**
 * Two copies of one URL, never opened, no preview — duplicate *and* unused *and*
 * missing-preview at once. This is what the server produces for that input:
 * status holds the winner, flags hold all three.
 */
function overlappingReport() {
    const issue = (index, name) => ({
        pageId: 1,
        index,
        pageName: 'dev',
        name,
        url: 'https://dup.test/x',
        category: 'tools',
        status: 'duplicate',
        flags: ['duplicate', 'unused', 'missing-preview'],
        score: 70,
        duplicateCount: 2,
        openCount: 0,
        lastOpened: 0,
        lastChecked: 1752000000000,
        reasons: ['Duplicate URL in 2 bookmarks', 'Never opened', 'No preview metadata yet'],
        reasonDetails: [
            { code: 'duplicate_url', params: { count: '2' }, penalty: 15 },
            { code: 'never_opened', penalty: 10 },
            { code: 'no_preview', penalty: 5 },
        ],
    });

    return {
        generatedAt: Date.now(),
        summary: {
            totalBookmarks: 2,
            healthyCount: 0,
            brokenCount: 0,
            duplicateCount: 2,
            uncheckedCount: 0,
            staleCount: 0,
            unusedCount: 2,
            missingPreviewCount: 2,
        },
        issues: [issue(0, 'Dup A'), issue(1, 'Dup B')],
        duplicateGroups: [],
    };
}

async function openHealthView(page, body) {
    await page.route('**/api/bookmark-health**', async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(body),
        });
    });
    // The view opens on "broken" by default and this fixture has none, so the
    // deep link picks a filter the fixture actually populates. Everything after
    // this goes through the real tiles and pills.
    await page.goto('/?hv_filter=duplicate#health');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await prepareDashboardInteraction(page);
    await page.waitForSelector('#dashboard-layout.health-layout .health-view-item', { timeout: 15_000 });
}

test.describe('health tiles agree with their filters', () => {
    test('a tile that counts overlapping issues lists them when clicked', async ({ page }) => {
        await openHealthView(page, overlappingReport());

        // The tile claims 2. Before the fix it did too — and then showed nothing.
        const tile = page.locator('[data-health-tile="unused"]');
        await expect(tile.locator('.health-view-tile-value')).toHaveText('2');

        await tile.click();

        await expect(page.locator('.health-view-item')).toHaveCount(2);
        await expect(page.locator('.health-view-empty-state')).toHaveCount(0);
    });

    test('every non-zero tile opens a list of exactly that many rows', async ({ page }) => {
        await openHealthView(page, overlappingReport());

        // Sweeping the tiles catches a regression in any single condition, not just
        // the one that happened to be reported.
        const keys = await page.$$eval('[data-health-tile]', (nodes) =>
            nodes
                .map((n) => ({
                    key: n.getAttribute('data-health-tile'),
                    value: Number(n.querySelector('.health-view-tile-value')?.textContent || 0),
                }))
                // 'all' is the whole report and 'monitored' is not a health
                // condition; both are matched on their own fields.
                .filter((t) => t.value > 0 && t.key !== 'all' && t.key !== 'monitored'));

        expect(keys.length).toBeGreaterThan(0);

        for (const { key, value } of keys) {
            await page.locator(`[data-health-tile="${key}"]`).click();
            await expect(
                page.locator('.health-view-item'),
                `tile "${key}" counts ${value}, so its filter must list ${value}`
            ).toHaveCount(value);
        }
    });

    test('the filter pill count matches the rows it lists', async ({ page }) => {
        await openHealthView(page, overlappingReport());

        // The pills read the same counter the rows are filtered by, so a mismatch
        // here would mean the count and the list drifted apart again.
        await page.locator('[data-health-filter="duplicate"]').click();
        const pill = page.locator('[data-health-filter="duplicate"] .health-view-filter-count');
        const count = Number((await pill.textContent())?.trim() || 0);
        await expect(page.locator('.health-view-item')).toHaveCount(count);
    });
});
