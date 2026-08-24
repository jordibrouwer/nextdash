// @ts-check
const { test, expect } = require('./fixtures');

test.describe('dashboard config sync reload', () => {
    test('reload with pending structure sync fetches page bookmarks once', async ({ page }) => {
        await page.goto('/');
        await page.waitForSelector('#dashboard-layout .bookmark-link', { timeout: 15_000 });

        await page.evaluate(() => {
            sessionStorage.setItem(
                'nextdash:pending-dashboard-structure-sync',
                JSON.stringify({
                    type: 'structure-updated',
                    sourceTabId: 'cfg-test-tab',
                    timestamp: Date.now(),
                })
            );
        });

        let pageBookmarkFetches = 0;
        const onRequest = (req) => {
            const url = req.url();
            if (/\/api\/bookmarks\?page=\d+/.test(url)) {
                pageBookmarkFetches += 1;
            }
        };
        page.on('request', onRequest);

        await page.reload();
        await page.waitForSelector('#dashboard-layout .bookmark-link', { timeout: 15_000 });
        page.off('request', onRequest);

        expect(pageBookmarkFetches).toBeLessThanOrEqual(1);
    });

    test('reload with pending sync does not leave dashboard layout empty', async ({ page }) => {
        await page.goto('/');
        await page.waitForSelector('#dashboard-layout .bookmark-link', { timeout: 15_000 });

        await page.evaluate(() => {
            sessionStorage.setItem(
                'nextdash:pending-dashboard-structure-sync',
                JSON.stringify({
                    type: 'tags-updated',
                    sourceTabId: 'cfg-test-tab',
                    timestamp: Date.now() + 1000,
                })
            );
        });

        await page.reload();
        await page.waitForSelector('#dashboard-layout .bookmark-link', { timeout: 15_000 });

        await expect(page.locator('#dashboard-layout .empty-state')).toHaveCount(0);
        await expect(page.locator('#dashboard-layout .bookmark-link').first()).toBeVisible();
    });

    test('structure refresh reapplies layout chrome after config bookmark save', async ({ page }) => {
        await page.goto('/');
        await page.waitForSelector('#dashboard-layout .bookmark-link', { timeout: 15_000 });

        const result = await page.evaluate(async () => {
            localStorage.setItem('deviceSpecificSettings', 'true');
            localStorage.setItem('dashboardSettings', JSON.stringify({
                layoutVersion: 'modern',
                showTitle: true,
                showDate: true,
                showWeatherWithDate: true,
                showSmartTodayCollection: true,
                showSmartMostUsedCollection: true,
                showIcons: true,
            }));
            document.body.setAttribute('data-layout-version', 'classic');
            const d = window.dashboardInstance;
            await d.configSync.refreshAfterConfigStructureUpdate({ type: 'config-saved' });
            const layout = document.body.getAttribute('data-layout-version');
            const smartCount = document.querySelectorAll('#dashboard-layout [data-smart-collection="true"]').length;
            const titleText = document.querySelector('.title')?.textContent?.trim() || '';
            return {
                layout,
                smartCount,
                titleText,
                showTitle: d.settings.showTitle,
                layoutSetting: d.settings.layoutVersion,
            };
        });

        expect(result.layoutSetting).toBe('modern');
        expect(result.layout).toBe('modern');
        expect(result.showTitle).toBe(true);
        expect(result.smartCount).toBeGreaterThan(0);
        expect(result.titleText.length).toBeGreaterThan(0);
    });

    test('pending settings sync survives structure sync and is applied after return', async ({ page }) => {
        await page.goto('/');
        await page.waitForSelector('#dashboard-layout .bookmark-link', { timeout: 15_000 });

        const result = await page.evaluate(async () => {
            const d = window.dashboardInstance;
            const now = Date.now();
            sessionStorage.setItem(
                d.pendingStructureSyncKey,
                JSON.stringify({ type: 'structure-updated', sourceTabId: 'cfg-test', timestamp: now + 1000 })
            );
            sessionStorage.setItem(
                d.pendingSettingsSyncKey,
                JSON.stringify({ type: 'settings-updated', sourceTabId: 'cfg-test', timestamp: now + 2000 })
            );

            let structureCalls = 0;
            let settingsCalls = 0;
            const originalStructureRefresh = d.configSync.refreshAfterConfigStructureUpdate.bind(d.configSync);
            const originalSettingsRefresh = d.configSync.refreshAfterConfigSettingsUpdate.bind(d.configSync);

            d.configSync.refreshAfterConfigStructureUpdate = async (payload) => {
                structureCalls += 1;
                return originalStructureRefresh(payload);
            };
            d.configSync.refreshAfterConfigSettingsUpdate = async (payload) => {
                settingsCalls += 1;
                return originalSettingsRefresh(payload);
            };

            try {
                await d.configSync.maybeRefreshAfterConfigReturn();
            } finally {
                d.configSync.refreshAfterConfigStructureUpdate = originalStructureRefresh;
                d.configSync.refreshAfterConfigSettingsUpdate = originalSettingsRefresh;
            }

            return {
                structureCalls,
                settingsCalls,
                pendingStructure: sessionStorage.getItem(d.pendingStructureSyncKey),
                pendingSettings: sessionStorage.getItem(d.pendingSettingsSyncKey),
                lastAppliedStructureSyncAt: d.lastAppliedStructureSyncAt,
                lastAppliedSettingsSyncAt: d.lastAppliedSettingsSyncAt,
            };
        });

        expect(result.structureCalls).toBe(1);
        expect(result.settingsCalls).toBe(1);
        expect(result.pendingStructure).toBeNull();
        expect(result.pendingSettings).toBeNull();
        expect(result.lastAppliedSettingsSyncAt).toBeGreaterThan(0);
    });
});
