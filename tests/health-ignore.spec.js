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
        await window.dashboardInstance.health.loadAndRender({ refresh: true });
    });
}

const countFor = (page, filter) => page.evaluate(
    ([f]) => window.dashboardInstance.health.filterCount(f), [filter]);

/** Health's own write, as the side panel's "Ignore this condition" makes it. */
const ignore = (page, change) => page.evaluate(async (c) => {
    const health = window.dashboardInstance.health;
    const issue = health.report.issues.find((i) => i.name === 'Archive of things');
    await health.writeIgnores(issue, c);
    await health.loadAndRender({ refresh: true });
}, change);

test.describe('ignoring a condition', () => {
    test('an ignored condition leaves its filter, and comes back', async ({ page }) => {
        await healthWithAnUnusedBookmark(page);
        const before = await countFor(page, 'unused');
        expect(before).toBeGreaterThan(0);

        await ignore(page, { add: ['unused'] });
        await expect.poll(() => countFor(page, 'unused'), { timeout: 15_000 }).toBe(before - 1);
        await expect.poll(() => countFor(page, 'ignored'), { timeout: 10_000 }).toBeGreaterThan(0);

        await ignore(page, { remove: ['unused'] });
        await expect.poll(() => countFor(page, 'unused'), { timeout: 15_000 }).toBe(before);
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
});
