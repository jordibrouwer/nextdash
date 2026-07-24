// @ts-check
const { test, expect } = require('@playwright/test');
const { dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * Config as a dashboard view — Phase 1 scaffold.
 *
 * These pin the shell wiring (the view opens, owns the hash, sets the
 * config-layout class, and closes back to bookmarks) rather than the section
 * content, which arrives in later phases.
 */

/** Load the dashboard and wait until the instance is ready to be driven. */
async function loadDashboard(page) {
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
}

test.describe('config dashboard view (scaffold)', () => {
    test('opening #config activates the config view', async ({ page }) => {
        await loadDashboard(page);

        await page.evaluate(() => window.dashboardInstance.config.openConfigView());

        expect(await page.evaluate(() => window.dashboardInstance.activeView)).toBe('config');
        const container = page.locator('#dashboard-layout');
        await expect(container).toHaveClass(/config-layout/);
        await expect(page.locator('.config-view')).toBeVisible();
        expect(await page.evaluate(() => window.location.hash)).toBe('#config');
    });

    test('the header config link opens the view without a page reload', async ({ page }) => {
        await loadDashboard(page);

        await page.evaluate(() => { window.__noReload = true; });
        await page.locator('.config-link a').click();

        await expect
            .poll(() => page.evaluate(() => window.dashboardInstance.activeView))
            .toBe('config');
        // Same document instance — never navigated away.
        expect(await page.evaluate(() => window.__noReload)).toBe(true);
    });

    test('Escape returns from config to the bookmarks view', async ({ page }) => {
        await loadDashboard(page);

        await page.evaluate(() => window.dashboardInstance.config.openConfigView());
        expect(await page.evaluate(() => window.dashboardInstance.activeView)).toBe('config');

        await page.locator('body').press('Escape');

        await expect
            .poll(() => page.evaluate(() => window.dashboardInstance.activeView))
            .toBe('bookmarks');
        await expect(page.locator('#dashboard-layout')).not.toHaveClass(/config-layout/);
    });

    test('a config/appearance hash selects the appearance section', async ({ page }) => {
        await loadDashboard(page);

        await page.evaluate(() => window.dashboardInstance.config.openConfigView('appearance'));

        expect(await page.evaluate(() => window.dashboardInstance.config.section)).toBe('appearance');
        expect(await page.evaluate(() => window.location.hash)).toBe('#config/appearance');
    });

    test('the overview section renders status tiles', async ({ page }) => {
        await loadDashboard(page);

        await page.evaluate(() => window.dashboardInstance.config.openConfigView());

        await expect(page.locator('.config-tiles .config-tile').first()).toBeVisible();
        // The bookmarks tile always exists; broken/duplicate/pages/inbox join it.
        const labels = await page.locator('.config-tile-label').allTextContents();
        expect(labels.join(' ').toLowerCase()).toContain('bookmarks');
    });

    test('clicking a section nav item switches section and hash', async ({ page }) => {
        await loadDashboard(page);
        await page.evaluate(() => window.dashboardInstance.config.openConfigView());

        await page.locator('[data-config-section="appearance"]').click();

        expect(await page.evaluate(() => window.dashboardInstance.config.section)).toBe('appearance');
        expect(await page.evaluate(() => window.location.hash)).toBe('#config/appearance');
        await expect(page.locator('[data-config-section="appearance"]')).toHaveClass(/is-active/);
    });

    test('a broken-links action tile hands off to the health view', async ({ page }) => {
        // Mock the health report so a broken count exists; loadOverviewData refetches
        // this endpoint, so forcing the in-memory report alone would be clobbered.
        await page.route('**/api/bookmark-health**', async (route) => {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    generatedAt: Date.now(),
                    summary: { totalBookmarks: 3, brokenCount: 2, duplicateCount: 0, uncheckedCount: 0, healthyCount: 1 },
                    issues: [],
                }),
            });
        });
        await loadDashboard(page);
        await page.evaluate(() => window.dashboardInstance.config.openConfigView());

        const brokenTile = page.locator('.config-tile[data-tile-view="health"][data-tile-filter="broken"]');
        await expect(brokenTile).toBeVisible();
        await brokenTile.click();

        await expect
            .poll(() => page.evaluate(() => window.dashboardInstance.activeView))
            .toBe('health');
        expect(await page.evaluate(() => window.dashboardInstance.health.filter)).toBe('broken');
    });

    test('the data & backups section renders tiles and the stored list', async ({ page }) => {
        await page.route('**/api/auto-backups', async (route) => {
            if (route.request().method() !== 'GET') return route.fallback();
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    enabled: true,
                    backups: [
                        { name: 'auto-2026-07-24T10-00-00Z.zip', size: 42000, createdAt: new Date(Date.now() - 3600_000).toISOString() },
                        { name: 'auto-2026-07-23T10-00-00Z.zip', size: 41000, createdAt: new Date(Date.now() - 90000_000).toISOString() },
                    ],
                }),
            });
        });
        await loadDashboard(page);
        await page.evaluate(() => window.dashboardInstance.config.openConfigView('data-backups'));

        await expect(page.locator('.config-tile-label', { hasText: /last backup/i })).toBeVisible();
        await expect(page.locator('.config-backup-row')).toHaveCount(2);
        await expect(page.locator('[data-backup-action="download"]')).toBeVisible();
        await expect(page.locator('[data-backup-action="reset"]')).toBeVisible();
    });

    test('make-a-backup-now posts to the run endpoint and reloads the list', async ({ page }) => {
        let runCalls = 0;
        let listCalls = 0;
        await page.route('**/api/auto-backups/run', async (route) => {
            runCalls += 1;
            await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'success' }) });
        });
        await page.route('**/api/auto-backups', async (route) => {
            if (route.request().method() !== 'GET') return route.fallback();
            listCalls += 1;
            await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ enabled: true, backups: [] }) });
        });
        await loadDashboard(page);
        await page.evaluate(() => window.dashboardInstance.config.openConfigView('data-backups'));
        await expect(page.locator('[data-backup-action="run"]')).toBeVisible();

        await page.locator('[data-backup-action="run"]').click();

        await expect.poll(() => runCalls).toBe(1);
        // The list is refetched after a successful run (initial load + post-run).
        await expect.poll(() => listCalls).toBeGreaterThanOrEqual(2);
    });

    test('data & backups exposes CSV, browser import, settings and reset controls', async ({ page }) => {
        await page.route('**/api/auto-backups', async (route) => {
            if (route.request().method() !== 'GET') return route.fallback();
            await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ enabled: true, backups: [] }) });
        });
        await loadDashboard(page);
        await page.evaluate(() => window.dashboardInstance.config.openConfigView('data-backups'));

        for (const action of ['csv-export', 'browser-import', 'settings-export', 'settings-import', 'reset-onboarding']) {
            await expect(page.locator(`[data-backup-action="${action}"]`)).toBeVisible();
        }
        await expect(page.locator('[data-backup-toggle="autoBackupEnabled"]')).toBeVisible();
        await expect(page.locator('[data-backup-toggle="healthAutoRecheckEnabled"]')).toBeVisible();
    });

    test('CSV export fetches bookmarks and triggers a download', async ({ page }) => {
        await page.route('**/api/auto-backups', async (route) => {
            if (route.request().method() !== 'GET') return route.fallback();
            await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ enabled: false, backups: [] }) });
        });
        await page.route('**/api/bookmarks?all=true', async (route) => {
            await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ name: 'Example', url: 'https://example.com', category: 'tools', pageId: 1 }]) });
        });
        await loadDashboard(page);
        await page.evaluate(() => window.dashboardInstance.config.openConfigView('data-backups'));

        const [download] = await Promise.all([
            page.waitForEvent('download'),
            page.locator('[data-backup-action="csv-export"]').click(),
        ]);
        expect(download.suggestedFilename()).toMatch(/nextdash-bookmarks-.*\.csv/);
    });

    test('toggling auto-backup saves settings and reloads the list', async ({ page }) => {
        let saved = null;
        await page.route('**/api/settings', async (route) => {
            if (route.request().method() === 'POST') {
                saved = JSON.parse(route.request().postData() || '{}');
                return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
            }
            return route.fallback();
        });
        await page.route('**/api/auto-backups', async (route) => {
            if (route.request().method() !== 'GET') return route.fallback();
            await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ enabled: false, backups: [] }) });
        });
        await loadDashboard(page);
        await page.evaluate(() => {
            window.dashboardInstance.settings.autoBackupEnabled = false;
            window.dashboardInstance.config.openConfigView('data-backups');
        });

        await page.locator('[data-backup-toggle="autoBackupEnabled"]').check();

        await expect.poll(() => saved && saved.autoBackupEnabled).toBe(true);
    });

    test('the appearance section renders theme and font-size controls', async ({ page }) => {
        await loadDashboard(page);
        await page.evaluate(() => window.dashboardInstance.config.openConfigView('appearance'));

        await expect(page.locator('.config-tile-label', { hasText: /active theme/i })).toBeVisible();
        await expect(page.locator('[data-appearance-theme="light"]')).toBeVisible();
        await expect(page.locator('[data-appearance-theme="dark"]')).toBeVisible();
        await expect(page.locator('[data-appearance-font="m"]')).toBeVisible();
    });

    test('switching theme applies live, saves, and updates the tile', async ({ page }) => {
        let saved = null;
        await page.route('**/api/settings', async (route) => {
            if (route.request().method() === 'POST') {
                saved = JSON.parse(route.request().postData() || '{}');
                return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
            }
            return route.fallback();
        });
        await loadDashboard(page);
        await page.evaluate(() => {
            window.dashboardInstance.settings.theme = 'dark';
            window.dashboardInstance.config.openConfigView('appearance');
        });

        await page.locator('[data-appearance-theme="light"]').click();

        // Applied live to the document.
        await expect
            .poll(() => page.evaluate(() => document.documentElement.getAttribute('data-theme')))
            .toBe('light');
        // Persisted.
        await expect.poll(() => saved && saved.theme).toBe('light');
        // Tile reflects the new theme.
        await expect(page.locator('.config-tile-value', { hasText: /light/i })).toBeVisible();
        // The light button is now the active choice.
        await expect(page.locator('[data-appearance-theme="light"]')).toHaveClass(/is-active/);
    });

    test('choosing a font size applies the body class and saves', async ({ page }) => {
        let saved = null;
        await page.route('**/api/settings', async (route) => {
            if (route.request().method() === 'POST') {
                saved = JSON.parse(route.request().postData() || '{}');
                return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
            }
            return route.fallback();
        });
        await loadDashboard(page);
        await page.evaluate(() => window.dashboardInstance.config.openConfigView('appearance'));

        await page.locator('[data-appearance-font="xl"]').click();

        await expect(page.locator('body')).toHaveClass(/font-size-xl/);
        await expect.poll(() => saved && saved.fontSize).toBe('xl');
    });
});
