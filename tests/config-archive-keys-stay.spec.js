// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * The archive keys are saved through their own route. Every ordinary settings
 * save posted the copy loaded with the page, so "Forget keys" was undone the
 * next time anything else was saved.
 */

test('forgotten archive keys stay forgotten after another settings save', async ({ page }) => {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    const api = (path, init) => page.evaluate(async ({ path, init }) => {
        const f = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        const res = await f(path, init);
        return res.json().catch(() => ({}));
    }, { path, init });
    const put = (body) => api('/api/health/archive-settings', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });

    await put({ enabled: true, accessKey: 'k1', secret: 's1' });
    // Loaded with the keys, as a page opened after they were saved.
    await page.reload();
    await page.waitForFunction(() => window.dashboardInstance?.settings != null, null, { timeout: 20_000 });

    await page.evaluate(() => { void window.dashboardInstance.config.forgetArchiveKeys(); });
    await page.locator('#config-confirm-modal [data-confirm="ok"]').click();
    await expect.poll(async () => (await api('/api/health/archive-settings')).hasKeys).toBe(false);

    await page.evaluate(() => window.dashboardInstance.data.saveSettings());
    const state = await api('/api/health/archive-settings');
    expect(state.hasKeys, 'a settings save brought the forgotten keys back').toBe(false);
    expect(state.enabled).toBe(false);
});

// With "Keep settings on this device only", the device copy overlaid the
// server's own data too: a tag rule or saved search added in another browser
// was gone here, and the next save removed it from the server.
test('device-only settings leave the server\'s data lists alone', async ({ page }) => {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.DeviceSettingsMerge != null, null, { timeout: 20_000 });
    const merged = await page.evaluate(() => {
        localStorage.setItem('deviceSpecificSettings', 'true');
        try {
            return window.DeviceSettingsMerge.mergeServerAndDeviceSettings(
                { columnsPerRow: 4, tagRules: [{ tag: 'new' }], savedSearches: [{ name: 'b' }] },
                { columnsPerRow: 6, tagRules: [], savedSearches: [] },
            );
        } finally {
            localStorage.removeItem('deviceSpecificSettings');
        }
    });
    expect(merged.columnsPerRow, 'the layout stays this device\'s').toBe(6);
    expect(merged.tagRules).toEqual([{ tag: 'new' }]);
    expect(merged.savedSearches).toEqual([{ name: 'b' }]);
});
