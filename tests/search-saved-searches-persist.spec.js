const { test, expect } = require('@playwright/test');
const { markWhatsNewSeen, dismissBlockingOverlays, dismissOnboardingIfPresent } = require('./e2e-helpers');

/**
 * :save and :saved are documented, but the entries lived only in localStorage:
 * gone on a cleared cache or a different browser, and — the part that mattered
 * — absent from every backup, so a reassuring ZIP did not contain them.
 */
async function open(page) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => !!window.dashboardInstance?.searchComponent, null, { timeout: 20_000 });
}

test.describe('saved searches survive the browser', () => {
    test('saving one puts it in settings, which the backup carries', async ({ page }) => {
        await open(page);

        await page.evaluate(async () => {
            const s = window.dashboardInstance.searchComponent;
            s.savedSearches = [{ name: 'Probe search', query: 'tag:probe' }];
            s.saveSavedSearches();
        });

        // Round-trip through the server, not just the in-memory copy.
        await expect.poll(async () => page.evaluate(async () => {
            const settings = await (await fetch('/api/settings')).json();
            return (settings.savedSearches || []).map((e) => e.name);
        }), { timeout: 10_000 }).toContain('Probe search');
    });

    test('the server drops incomplete entries rather than storing them', async ({ page }) => {
        await open(page);
        const stored = await page.evaluate(async () => {
            const current = await (await fetch('/api/settings')).json();
            const post = (body) => (typeof nextDashFetch === 'function' ? nextDashFetch : fetch)('/api/settings', {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
            });
            await post({ ...current, savedSearches: [
                { name: 'Good', query: 'tag:x' },
                { name: '', query: 'tag:y' },        // no name
                { name: 'No query', query: '   ' },  // no query
            ] });
            const after = await (await fetch('/api/settings')).json();
            return (after.savedSearches || []).map((e) => e.name);
        });
        expect(stored).toEqual(['Good']);
    });

    test('entries left in localStorage are migrated on first read', async ({ page }) => {
        await open(page);
        const migrated = await page.evaluate(async () => {
            // Clear the server side, then plant a legacy entry as an old build left it.
            const current = await (await fetch('/api/settings')).json();
            await (typeof nextDashFetch === 'function' ? nextDashFetch : fetch)('/api/settings', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ...current, savedSearches: [] }),
            });
            window.dashboardInstance.settings.savedSearches = [];
            localStorage.setItem('dashboardSavedSearches',
                JSON.stringify([{ name: 'Legacy', query: 'tag:legacy' }]));

            const s = window.dashboardInstance.searchComponent;
            const read = s.loadSavedSearches();
            return { read: read.map((e) => e.name), inSettings: (window.dashboardInstance.settings.savedSearches || []).map((e) => e.name) };
        });
        expect(migrated.read).toEqual(['Legacy']);
        expect(migrated.inSettings).toEqual(['Legacy']);
    });
});
