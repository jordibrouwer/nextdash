const { test, expect } = require('@playwright/test');
const { markWhatsNewSeen, dismissBlockingOverlays, dismissOnboardingIfPresent } = require('./e2e-helpers');

/**
 * The usage data the app collects most carefully — openCount, lastOpened,
 * createdAt, updatedAt, previewDesc, drift — fed the built-in features and
 * reached none of the ones the user drives.
 */
async function load(page) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => !!window.dashboardInstance?.smartCollections, null, { timeout: 15_000 });
}

test.describe('search filters for usage data', () => {
    test('opened: and added: match the windows they name', async ({ page }) => {
        await load(page);
        const r = await page.evaluate(() => {
            const S = window.SearchComponent;
            const twoDaysAgo = Date.now() - 2 * 86400000;
            return {
                neverOnZero: S.matchesAgeFilter(0, 'never'),
                neverOnValue: S.matchesAgeFilter(twoDaysAgo, 'never'),
                withinWeek: S.matchesAgeFilter(twoDaysAgo, 'week'),
                notToday: S.matchesAgeFilter(twoDaysAgo, 'today'),
                // An unknown word must filter nothing rather than everything.
                unknownWord: S.matchesAgeFilter(twoDaysAgo, 'fortnight'),
                zeroIsNotRecent: S.matchesAgeFilter(0, 'week'),
            };
        });
        expect(r).toEqual({
            neverOnZero: true, neverOnValue: false, withinWeek: true,
            notToday: false, unknownWord: true, zeroIsNotRecent: false,
        });
    });

    test('the filters are parsed out of the query, not left in it', async ({ page }) => {
        await load(page);
        const parsed = await page.evaluate(() => {
            return window.dashboardInstance.searchComponent
                .parseSearchFilters('opened:never added:week docs');
        });
        expect(parsed?.filters?.opened).toBe('never');
        expect(parsed?.filters?.added).toBe('week');
        expect(parsed?.query).toBe('docs');
    });
});

test.describe('custom collection rules', () => {
    // The built-in collections score on openCount and lastOpened; the
    // user-defined ones could only ask about tag, category and shortcut.
    test('pinned, untagged, notOpenedDays and changedDays each select', async ({ page }) => {
        await load(page);
        const out = await page.evaluate(() => {
            const sc = window.dashboardInstance.smartCollections;
            const rows = [
                { url: 'stale', tags: [], pinned: true, lastOpened: 0, updatedAt: Date.now() },
                { url: 'fresh', tags: ['x'], pinned: false, lastOpened: Date.now(), updatedAt: 0 },
            ];
            const run = (rule) => sc._evaluateCollection({ logic: 'and', rules: [rule] }, rows).map((b) => b.url);
            return {
                untagged: run({ field: 'untagged', operator: 'includes', value: '' }),
                tagged: run({ field: 'untagged', operator: 'excludes', value: '' }),
                pinned: run({ field: 'pinned', operator: 'includes', value: 'true' }),
                notOpened: run({ field: 'notOpenedDays', operator: 'includes', value: '30' }),
                changed: run({ field: 'changedDays', operator: 'includes', value: '7' }),
                // A rule that needs a number and has none must select nothing,
                // not everything.
                noNumber: run({ field: 'notOpenedDays', operator: 'includes', value: '' }),
            };
        });
        expect(out.untagged).toEqual(['stale']);
        expect(out.tagged).toEqual(['fresh']);
        expect(out.pinned).toEqual(['stale']);
        expect(out.notOpened).toEqual(['stale']);   // never opened counts as neglected
        expect(out.changed).toEqual(['stale']);
        expect(out.noNumber).toEqual([]);
    });

    test('the server keeps a valueless rule instead of dropping the collection', async ({ page }) => {
        await load(page);
        const kept = await page.evaluate(async () => {
            const current = await (await fetch('/api/settings')).json();
            const post = (body) => (typeof nextDashFetch === 'function' ? nextDashFetch : fetch)('/api/settings', {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
            });
            await post({ ...current, collections: [
                { id: 'probe-untagged', name: 'Untagged', logic: 'and',
                  rules: [{ field: 'untagged', operator: 'includes', value: '' }] },
            ] });
            const after = await (await fetch('/api/settings')).json();
            await post(current);
            return (after.collections || []).map((c) => c.id);
        });
        expect(kept).toContain('probe-untagged');
    });
});

test('drift reaches the header badge instead of only the Health filter', async ({ page }) => {
    await load(page);
    const r = await page.evaluate(() => {
        const u = window.HealthBadgeUtils;
        const counts = u.summarizeHealthCounts({ driftCount: 3, brokenCount: 0, monitorDownCount: 0 });
        return { drift: counts.drift, warn: counts.warn, href: u.buildHealthPageHref(counts) };
    });
    // Warning tier, not red: a drifted link still returns 200 and looks fine.
    expect(r.drift).toBe(3);
    expect(r.warn).toBeGreaterThanOrEqual(3);
    expect(r.href).toBe('/?hv_filter=drift#health');
});

test('a page description is searchable, below the note', async ({ page }) => {
    await load(page);
    const hit = await page.evaluate(() => {
        const F = window.FuzzySearchComponent;
        if (typeof F !== 'function') return 'no FuzzySearchComponent';
        const fs = new F([{ name: 'Untitled', url: 'https://x.example', previewDesc: 'quarterly revenue planning' }], () => {});
        const results = fs.handleFuzzy('quarterly');
        return results.length ? results[0].name : 'no match';
    });
    expect(hit).toBe('Untitled');
});
