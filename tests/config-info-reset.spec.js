// @ts-check
const { test, expect } = require('@playwright/test');
const { dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

async function loadDashboard(page) {
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
}

test.describe('config info + reset affordances', () => {
    test('behavior settings show info buttons and a privacy hint', async ({ page }) => {
        await loadDashboard(page);
        await page.evaluate(() => window.dashboardInstance.config.openConfigView('behavior'));
        // General tab: openInNewTab has an info button.
        await expect(page.locator('[data-info-field="openInNewTab"]')).toBeVisible();
        // Privacy tab: the long analytics hint text is shown inline.
        await page.locator('[data-behavior-tab="privacy"]').click();
        await expect(page.locator('#config-behavior-body .config-field-hint').filter({ hasText: /Umami|analytics/i }))
            .toBeVisible();
        await expect(page.locator('[data-info-field="analyticsOptIn"]')).toBeVisible();
    });

    test('clicking an info button opens the modal', async ({ page }) => {
        await loadDashboard(page);
        await page.evaluate(() => window.dashboardInstance.config.openConfigView('behavior'));
        await page.locator('[data-info-field="openInNewTab"]').click();
        // AppModal renders a dialog with the info title/message.
        await expect(page.locator('.modal, [role="dialog"]').first()).toBeVisible();
    });

    test('reset-to-default appears only when a value differs and resets it', async ({ page }) => {
        let saved = null;
        await page.route('**/api/settings', async (route) => {
            if (route.request().method() === 'POST') {
                saved = JSON.parse(route.request().postData() || '{}');
                return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
            }
            return route.fallback();
        });
        await loadDashboard(page);
        // dateFormat default is 'short-slash'; set a non-default first.
        await page.evaluate(() => {
            window.dashboardInstance.settings.dateFormat = 'iso';
            window.dashboardInstance.config.openConfigView('behavior');
        });
        await page.locator('[data-behavior-tab="datetime"]').click();

        const resetBtn = page.locator('[data-reset-field="dateFormat"]');
        await expect(resetBtn).toHaveClass(/is-visible/);
        await resetBtn.click();

        await expect.poll(() => saved && saved.dateFormat).toBe('short-slash');
        // After reset, the button hides again.
        await expect(page.locator('[data-reset-field="dateFormat"]')).not.toHaveClass(/is-visible/);
    });

    test('date & weather number fields show info buttons', async ({ page }) => {
        await loadDashboard(page);
        await page.evaluate(() => window.dashboardInstance.config.openConfigView('behavior'));
        await page.locator('[data-behavior-tab="datetime"]').click();
        await expect(page.locator('[data-info-field="weatherRefreshMinutes"]')).toBeVisible();
        await page.locator('[data-info-field="weatherRefreshMinutes"]').click();
        await expect(page.locator('#app-modal .modal-text')).toContainText(/1440/);
    });

    test('every field with a default also explains itself', async ({ page }) => {
        await loadDashboard(page);
        // dashboard-config.js is lazy-loaded on first open; until then the
        // class it defines is not on window.
        await page.evaluate(() => window.dashboardInstance.config.openConfigView('behavior'));
        await page.waitForFunction(() => !!window.DashboardConfig?.FIELD_META);
        // A field carrying a reset affordance but no info button is a gap: the
        // UI offers to restore a default it never names.
        const gaps = await page.evaluate(() => {
            // dashboardInstance.config is the lazy loader proxy, so the class
            // statics come from the global rather than from its constructor.
            const meta = window.DashboardConfig.FIELD_META;
            return Object.entries(meta)
                .filter(([, m]) => m && m.def !== undefined && !m.info)
                .map(([field]) => field);
        });
        // Toolbar toggles are self-describing ("Show recent button"), so they
        // are the deliberate exception rather than an oversight.
        const allowed = new Set([
            'showRecentButton', 'showCheatSheetButton', 'showConfigButton', 'showHealthDashboard',
            'showAddBookmarkButton', 'showSearchButton', 'showFindersButton', 'showCommandsButton',
            'showSmartTodayCollection', 'showSmartRecentCollection', 'showSmartStaleCollection',
            'showSmartMostUsedCollection', 'pushNotifyMonitor', 'pushNotifyBackup',
            'pushNotifyRelease', 'pushNotifySubject', 'showCollapseAllButton',
            // Listed in FIELD_META for the ↺ button and the changed-settings
            // count, with a comment saying they carry no ℹ of their own: a
            // field with no `def` reports itself unchanged whatever it holds.
            'pasteDestination', 'monitorEmphasis', 'theme', 'fontSize', 'customTitle',
        ]);
        expect(gaps.filter((f) => !allowed.has(f))).toEqual([]);
    });

    test('behavior is split into sub-tabs', async ({ page }) => {
        await loadDashboard(page);
        await page.evaluate(() => window.dashboardInstance.config.openConfigView('behavior'));
        for (const tab of ['general', 'datetime', 'search', 'privacy', 'status']) {
            await expect(page.locator(`[data-behavior-tab="${tab}"]`)).toBeVisible();
        }
        await page.evaluate(() => window.dashboardInstance.config.openConfigView('appearance'));
        for (const tab of ['general', 'layout', 'display']) {
            await expect(page.locator(`[data-appearance-tab="${tab}"]`)).toBeVisible();
        }
    });

    test('appearance controls show info buttons', async ({ page }) => {
        await loadDashboard(page);
        await page.evaluate(() => window.dashboardInstance.config.openConfigView('appearance'));
        // fontPreset and backgroundType carry info entries in the old config.
        await expect(page.locator('[data-info-field="fontPreset"]')).toBeVisible();
        await expect(page.locator('[data-info-field="backgroundType"]')).toBeVisible();
        await expect(page.locator('[data-info-field="autoDarkMode"]')).toBeVisible();
    });

    test('appearance reset-to-default appears when a value differs and resets it', async ({ page }) => {
        let saved = null;
        await page.route('**/api/settings', async (route) => {
            if (route.request().method() === 'POST') {
                saved = JSON.parse(route.request().postData() || '{}');
                return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
            }
            return route.fallback();
        });
        await loadDashboard(page);
        // backgroundType default is 'none'; set a non-default first.
        await page.evaluate(() => {
            window.dashboardInstance.settings.backgroundType = 'gradient';
            window.dashboardInstance.config.openConfigView('appearance');
        });

        const resetBtn = page.locator('[data-reset-field="backgroundType"]');
        await expect(resetBtn).toHaveClass(/is-visible/);
        await resetBtn.click();

        await expect.poll(() => saved && saved.backgroundType).toBe('none');
        await expect(page.locator('[data-reset-field="backgroundType"]')).not.toHaveClass(/is-visible/);
    });
});
