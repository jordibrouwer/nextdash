// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * Telling the health report to stop reporting one condition.
 *
 * Some rows are only ever going to read badly and the reader knows why: an
 * archive page allowed to sit unopened, a link behind a bot wall. Until now the
 * only ways out were deleting the bookmark or switching off its checking — one
 * throws away the link, the other throws away the checking.
 *
 * Per condition, not per bookmark: ignoring "unused" must not silence the year
 * the domain lapses.
 */

async function healthWithAnUnusedBookmark(page) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.evaluate(async () => {
        const f = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        const h = {
            'Content-Type': 'application/json',
            ...(typeof nextDashWriteHeaders === 'function' ? nextDashWriteHeaders() : {}),
        };
        await f('/api/bookmarks/add', { method: 'POST', headers: h, body: JSON.stringify({ page: 1, bookmark: {
            // No category: an id that matches nothing on the page would make
            // the row orphaned as well, and this test is about one condition.
            name: 'Archive of things', url: 'https://archive-ignore.example/' } }) });
    });
    await page.evaluate(async () => {
        const health = window.dashboardInstance.health;
        await health.openHealthView();
        await health.loadAndRender({ refresh: true });
        health.filter = 'unused';
        health.render();
    });
    await expect(page.locator('.health-view-item').first()).toBeVisible({ timeout: 15_000 });
}

/** The row for our bookmark, wherever it sits in the list. */
const ourRow = (page) => page.locator('.health-view-item', { hasText: 'Archive of things' });

const countFor = (page, filter) => page.evaluate(
    ([f]) => window.dashboardInstance.health.filterCount(f), [filter]);

test.describe('ignoring a condition', () => {
    test('n takes the row out of the list it is filtered on, and back', async ({ page }) => {
        await healthWithAnUnusedBookmark(page);
        const before = await countFor(page, 'unused');
        expect(before).toBeGreaterThan(0);

        await page.evaluate(() => {
            const health = window.dashboardInstance.health;
            health.selectRowByKey(health.issueKey(
                health.getFilteredIssues().find((i) => i.name === 'Archive of things')));
        });
        await page.keyboard.press('n');

        await expect.poll(() => countFor(page, 'unused'), { timeout: 15_000 }).toBe(before - 1);
        await expect.poll(() => countFor(page, 'ignored'), { timeout: 10_000 }).toBeGreaterThan(0);

        // The same key gives it back — that is what makes one letter enough.
        await page.evaluate(() => {
            const health = window.dashboardInstance.health;
            health.filter = 'ignored';
            health.render();
            health.selectRowByKey(health.issueKey(
                health.getFilteredIssues().find((i) => i.name === 'Archive of things')));
        });
        await page.keyboard.press('n');
        await expect.poll(() => countFor(page, 'unused'), { timeout: 15_000 }).toBe(before);
    });

    test('the row says what it is not reporting', async ({ page }) => {
        await healthWithAnUnusedBookmark(page);
        await page.evaluate(async () => {
            const health = window.dashboardInstance.health;
            const issue = health.getFilteredIssues().find((i) => i.name === 'Archive of things');
            await health.writeIgnores(issue, { add: ['unused'] });
            health.filter = 'ignored';
            health.render();
        });

        await expect(ourRow(page).locator('.health-view-ignored-badge')).toBeVisible({ timeout: 15_000 });
        await expect(ourRow(page).locator('.health-view-ignored-badge')).toContainText('ignored');
    });

    test('ignoring one condition leaves the others reporting', async ({ page }) => {
        await healthWithAnUnusedBookmark(page);

        // A bookmark that is both never opened and failing. Ignoring the first
        // must not touch the second — that is the whole reason ignores are per
        // condition rather than per bookmark.
        await page.evaluate(async () => {
            const f = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
            const h = {
                'Content-Type': 'application/json',
                ...(typeof nextDashWriteHeaders === 'function' ? nextDashWriteHeaders() : {}),
            };
            await f('/api/bookmarks/add', { method: 'POST', headers: h, body: JSON.stringify({ page: 1, bookmark: {
                name: 'Walled off', url: 'https://walled-ignore.example/',
                checkStatus: true, lastChecked: Date.now(), lastError: 'HTTP 403' } }) });
            const health = window.dashboardInstance.health;
            await health.loadAndRender({ refresh: true });
            const issue = health.report.issues.find((i) => i.name === 'Walled off');
            await health.writeIgnores(issue, { add: ['unused'] });
        });

        const ours = () => page.evaluate(() => {
            const issue = window.dashboardInstance.health.report.issues
                .find((i) => i.name === 'Walled off');
            return {
                flags: issue?.flags || [],
                ignored: (issue?.ignoredFlags || []).map((e) => e.flag),
            };
        });
        await expect.poll(async () => (await ours()).ignored, { timeout: 15_000 }).toEqual(['unused']);
        const after = await ours();
        expect(after.flags).not.toContain('unused');
        expect(after.flags).toContain('broken');
    });

    test('the filter pill only appears once something is ignored', async ({ page }) => {
        await healthWithAnUnusedBookmark(page);
        await page.evaluate(async () => {
            const health = window.dashboardInstance.health;
            const issues = health.report.issues.filter((i) => (i.ignoredFlags || []).length);
            for (const issue of issues) await health.writeIgnores(issue, { clear: true });
            health.render();
        });
        await expect(page.locator('[data-health-filter="ignored"]')).toHaveCount(0, { timeout: 10_000 });

        await page.evaluate(async () => {
            const health = window.dashboardInstance.health;
            const issue = health.report.issues.find((i) => i.name === 'Archive of things');
            await health.writeIgnores(issue, { add: ['unused'] });
        });
        await expect(page.locator('[data-health-filter="ignored"]')).toBeVisible({ timeout: 10_000 });
    });
});
