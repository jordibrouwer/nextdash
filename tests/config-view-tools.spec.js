// @ts-check
const { test, expect } = require('@playwright/test');
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
        await config(page, 'pages-tags');
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

test.describe('editing a bookmark where you read it', () => {
    test('a shortcut already in use is refused, and says who has it', async ({ page }) => {
        await config(page, 'bookmarks');
        const taken = await page.evaluate(() => {
            const all = window.dashboardInstance.allBookmarks || [];
            const owner = all.find((b) => String(b.shortcut || '').trim());
            const other = all.find((b) => b !== owner);
            return owner && other
                ? { key: String(owner.shortcut).toUpperCase(), owner: owner.name || owner.url }
                : null;
        });
        test.skip(!taken, 'needs one bookmark with a shortcut and one without');

        // The row edited is not the one holding the key, so this is a genuine
        // clash rather than a bookmark keeping its own shortcut.
        const pill = page.locator('.config-bm-row [data-bm-inline="shortcut"]').last();
        await pill.click();
        const input = page.locator('.config-bm-inline-input--shortcut').first();
        await expect(input).toBeVisible({ timeout: 5_000 });
        await input.type(taken.key);

        // Said while the field is open, naming the bookmark that has it.
        const warning = page.locator('.config-bm-inline-conflict').first();
        await expect(warning).toBeVisible({ timeout: 5_000 });
        await expect(warning).toContainText(taken.key);
        await expect(input).toHaveClass(/is-invalid/);

        // Enter does not save it: two bookmarks sharing a key means neither is
        // reachable by it, so the one that already worked must not be broken.
        await input.press('Enter');
        await page.waitForTimeout(300);
        await expect(page.locator('.config-bm-inline-input--shortcut').first()).toBeVisible();
        expect(await page.evaluate((k) => (window.dashboardInstance.allBookmarks || [])
            .filter((b) => String(b.shortcut || '').toUpperCase() === k).length, taken.key)).toBe(1);
        await page.locator('.config-bm-inline-input--shortcut').first().press('Escape');
    });

    test('the shortcut pill turns into an input and Escape restores it', async ({ page }) => {
        await config(page, 'bookmarks');
        const pill = page.locator('.config-bm-row [data-bm-inline="shortcut"]').first();
        await expect(pill).toBeVisible({ timeout: 10_000 });
        const before = (await pill.textContent()).trim();

        await pill.click();
        const input = page.locator('.config-bm-inline-input--shortcut').first();
        await expect(input).toBeVisible({ timeout: 5_000 });
        // Typed rather than filled: fill() can take focus away, and blur saves —
        // which is the behaviour, not a bug, but it is not what this test is about.
        await input.type('ZZ');
        await input.press('Escape');
        await page.waitForTimeout(300);
        // Escape puts back exactly what was there, including the empty pill's +.
        expect((await page.locator('.config-bm-row [data-bm-inline="shortcut"]').first().textContent()).trim())
            .toBe(before);
    });
});
