// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissBlockingOverlays, dismissOnboardingIfPresent, WRITE_TOKEN } = require('./e2e-helpers');

/**
 * A save the page makes on its own sends only the keys it owns.
 *
 * The discoverability state (a tip or tour seen) was saved 700 ms later by
 * posting this tab's whole settings copy. A tab loaded earlier so put back
 * whatever had changed since: an MCP group switched off in another tab or
 * through the API came back on, the assistant's history limit went back.
 */
const AUTH = { 'X-NextDash-Token': WRITE_TOKEN };

/** Two settings the page does not touch on its own, changed behind its back. */
const ELSEWHERE = { mcpBookmarksWrite: false, aiHistoryMax: 77 };

async function serverSettings(page) {
    return (await page.request.get('/api/settings', { headers: AUTH })).json();
}

async function post(page, data) {
    expect((await page.request.post('/api/settings', { data, headers: AUTH })).ok()).toBe(true);
}

async function openApp(page) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });
    // The load's own saves (a tour marked seen) have landed: the server holds
    // what this tab holds. Only then is the change below made "elsewhere".
    await expect.poll(async () => {
        const local = await page.evaluate(() => JSON.stringify(window.DiscoverabilityState.exportState()));
        return JSON.stringify((await serverSettings(page)).discoverabilityState || {}) === local;
    }, { timeout: 10_000 }).toBe(true);
}

test.describe('Background settings saves', () => {
    test.describe.configure({ mode: 'serial' });

    let prior = null;

    test.beforeEach(async ({ page }) => {
        prior = await serverSettings(page);
        await post(page, { mcpBookmarksWrite: true, aiHistoryMax: 50 });
    });

    test.afterEach(async ({ page }) => {
        if (prior) await post(page, prior);
    });

    test('a tour seen in a stale tab saves the tour and leaves settings changed elsewhere', async ({ page }) => {
        await openApp(page);
        // The keyboard tour not yet seen, so dismissing it is a real write.
        // After the load, which marks it seen on its way in.
        const exported = await page.evaluate(() => {
            window.DiscoverabilityState.forgetTip('keyboardTutorialV1', { persist: false });
            return window.DiscoverabilityState.exportState();
        });
        expect(exported.seenTips).not.toContain('keyboardTutorialV1');
        await post(page, { discoverabilityState: exported });
        expect(await page.evaluate(() => window.dashboardInstance.settings.mcpBookmarksWrite)).toBe(true);

        await post(page, ELSEWHERE);
        // Through the palette, as a reader would: `:tour keyboard`, then away.
        await page.evaluate(() => { document.body.focus(); });
        await page.keyboard.press(':');
        await page.keyboard.type('tour keyboard');
        await expect(page.locator('#shortcut-search')).toContainText('The keyboard');
        await page.keyboard.press('Enter');
        await expect(page.locator('.keyboard-tour, #app-modal.show')).toBeVisible();
        await page.keyboard.press('Escape');

        await expect.poll(async () => (await serverSettings(page)).discoverabilityState?.seenTips || [], { timeout: 10_000 })
            .toContain('keyboardTutorialV1');
        const after = await serverSettings(page);
        expect(after.mcpBookmarksWrite).toBe(false);
        expect(after.aiHistoryMax).toBe(77);
        // And the tab took the other tab's values from the answer, so a later
        // save of everything (Config) does not put the old ones back.
        await expect.poll(() => page.evaluate(() => [
            window.dashboardInstance.settings.mcpBookmarksWrite,
            window.dashboardInstance.settings.aiHistoryMax,
        ])).toEqual([false, 77]);
    });

    /** The other saves the page makes on its own: what sets them off, and the key each owns. */
    const SAVES = [
        {
            name: 'a setting promo dismissed',
            key: 'discoverabilityState',
            run: () => window.DiscoverabilityState.markSettingPromoSeen('backgroundSaveSpec'),
            landed: (s) => (s.discoverabilityState?.seenSettingPromos || []).includes('backgroundSaveSpec'),
        },
        {
            name: 'a search pick',
            key: 'searchPicks',
            run: () => {
                const sc = window.dashboardInstance.searchComponent;
                sc.currentQuery = 'backgroundsave';
                sc.recordSearchPick({ url: 'https://background-save.example/' });
            },
            landed: (s) => (s.searchPicks || []).some((p) => p.url === 'https://background-save.example/'),
        },
        {
            name: 'quick start progress',
            key: 'quickStart',
            run: () => {
                const d = window.dashboardInstance;
                const qs = d.settings.quickStart || {};
                d.settings.quickStart = { ...qs, seenAnalyticsNotice: !qs.seenAnalyticsNotice };
                new window.QuickStart(d).persistState();
            },
            landed: (s, before) => Boolean(s.quickStart?.seenAnalyticsNotice) !== Boolean(before?.seenAnalyticsNotice),
        },
        {
            name: 'the list density carried over from this browser',
            key: 'densityMode',
            run: () => {
                const d = window.dashboardInstance;
                const next = d.settings.densityMode === 'dense' ? 'comfortable' : 'dense';
                localStorage.setItem('nextdash:list-density', next);
                window.ListDensity.migrate();
            },
            landed: (s, before) => s.densityMode !== before,
        },
        {
            name: 'an old font size moved to its new name',
            key: 'fontSize',
            run: () => {
                const d = window.dashboardInstance;
                d.settings.fontSize = 'small';
                d.visual.applyFontSize();
            },
            landed: (s) => s.fontSize === 'sm',
        },
    ];

    for (const save of SAVES) {
        test(`${save.name} saves ${save.key} only`, async ({ page }) => {
            await openApp(page);
            const before = (await serverSettings(page))[save.key];
            await post(page, ELSEWHERE);
            await page.evaluate(save.run);
            await expect.poll(async () => save.landed(await serverSettings(page), before), { timeout: 10_000 }).toBe(true);
            const after = await serverSettings(page);
            expect(JSON.stringify(after[save.key])).not.toBe(JSON.stringify(before));
            expect(after.mcpBookmarksWrite).toBe(false);
            expect(after.aiHistoryMax).toBe(77);
        });
    }
});
