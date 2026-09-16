// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissBlockingOverlays, dismissOnboardingIfPresent } = require('./e2e-helpers');

/**
 * Five things config could describe but not do: find a setting by what it is
 * set to, say which settings do not follow the device rule, act on a statistics
 * row, copy a page or a category, and edit a bookmark's name or shortcut where
 * you read it.
 */

async function config(page, section) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 20_000 });
    await page.evaluate((s) => window.dashboardInstance.config.openConfigView(s), section);
    await page.waitForTimeout(700);
}

test.describe('finding a setting by its value', () => {
    test('the jump index matches and shows what a setting is set to', async ({ page }) => {
        await config(page, 'overview');
        const found = await page.evaluate(() => {
            const c = window.dashboardInstance.config;
            c.dash.settings.healthCheckTimeoutSeconds = 15;
            const hits = c.filterSettingsJumpEntries('15');
            return {
                any: hits.some((e) => e.field === 'healthCheckTimeoutSeconds'),
                shown: (hits.find((e) => e.field === 'healthCheckTimeoutSeconds') || {}).value,
                // A boolean reads as On/Off rather than true/false.
                boolText: c.settingsJumpValueText('showGridKeyLegend'),
            };
        });
        expect(found.any).toBe(true);
        expect(String(found.shown)).toBe('15');
        expect(['On', 'Off']).toContain(found.boolText);
    });
});

test.describe('which settings follow the device rule', () => {
    test('only the exceptions are marked', async ({ page }) => {
        await config(page, 'behavior');
        const marks = await page.evaluate(() => {
            const c = window.dashboardInstance.config;
            return {
                // The switch itself is always local.
                self: c.fieldScopeNote('deviceSpecificSettings')?.label || null,
                // With device mode off, everything else is shared and unmarked.
                ordinaryOff: c.fieldScopeNote('showGridKeyLegend'),
            };
        });
        expect(marks.self).toBeTruthy();
        expect(marks.ordinaryOff).toBeNull();
    });
});

test.describe('a statistics row leads somewhere', () => {
    test('a tag row hands off to the bookmark list filtered by it', async ({ page }) => {
        await config(page, 'stats');
        const tagBtn = page.locator('[data-stats-goto^="tag:"]').first();
        const has = await tagBtn.count();
        test.skip(!has, 'needs at least one tag in the statistics');

        const tag = (await tagBtn.getAttribute('data-stats-goto')).split(':').slice(1).join(':');
        await tagBtn.click();
        await page.waitForTimeout(600);
        const state = await page.evaluate(() => {
            const c = window.dashboardInstance.config;
            return { section: c.section, tags: c.bmTagFilter, cleanup: c.bmCleanupFilter };
        });
        expect(state.section).toBe('bookmarks');
        expect(state.tags).toEqual([tag.toLowerCase()]);
        // The other filters are cleared, so what lands is the row you clicked.
        expect(state.cleanup).toBeFalsy();
    });
});

test.describe('copying structure', () => {
    test('a page row offers Duplicate, and the method exists', async ({ page }) => {
        await config(page, 'structure');
        // Pages & tags opens on Categories; the pages list is the other tab.
        await page.evaluate(() => {
            const c = window.dashboardInstance.config;
            c.ptTab = 'pages';
            c.render();
        });
        await page.waitForTimeout(500);
        await expect(page.locator('[data-page-duplicate]').first()).toBeVisible({ timeout: 10_000 });
        expect(await page.evaluate(() =>
            typeof window.dashboardInstance.config.duplicatePage)).toBe('function');
        expect(await page.evaluate(() =>
            typeof window.dashboardInstance.config.duplicateCategory)).toBe('function');
    });
});

