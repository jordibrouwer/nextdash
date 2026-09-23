// @ts-check
const { test, expect } = require('./fixtures');
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
        await page.evaluate(() => (window.dashboardInstance.config.behaviorTab = window.dashboardInstance.config.behaviorTab || 'general', window.dashboardInstance.config).openConfigView('behavior'));
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
        await page.evaluate(() => (window.dashboardInstance.config.behaviorTab = window.dashboardInstance.config.behaviorTab || 'general', window.dashboardInstance.config).openConfigView('behavior'));
        await page.locator('[data-info-field="openInNewTab"]').click();
        // The AppModal dialog by name, not the first dialog on the page. The
        // loose `.modal, [role="dialog"]` matched #tag-cloud-modal, which sits
        // earlier in the document and is a dialog whether or not it is open --
        // so this passed on the tag cloud and never once looked at the info
        // modal it is about.
        await expect(page.locator('#app-modal.show .modal')).toBeVisible();
        await expect(page.locator('#modal-title')).toHaveText('Open in new tab');
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
            (window.dashboardInstance.config.appearanceTab = window.dashboardInstance.config.appearanceTab || 'general', window.dashboardInstance.config).openConfigView('appearance');
        });
        await page.locator('[data-appearance-tab="datetime"]').click();

        const resetBtn = page.locator('[data-reset-field="dateFormat"]');
        await expect(resetBtn).toHaveClass(/is-visible/);
        await resetBtn.click();

        await expect.poll(() => saved && saved.dateFormat).toBe('short-slash');
        // After reset, the button hides again.
        await expect(page.locator('[data-reset-field="dateFormat"]')).not.toHaveClass(/is-visible/);
    });

    test('date & weather number fields show info buttons', async ({ page }) => {
        await loadDashboard(page);
        await page.evaluate(() => (window.dashboardInstance.config.appearanceTab = window.dashboardInstance.config.appearanceTab || 'general', window.dashboardInstance.config).openConfigView('appearance'));
        await page.locator('[data-appearance-tab="datetime"]').click();
        await expect(page.locator('[data-info-field="weatherRefreshMinutes"]')).toBeVisible();
        await page.locator('[data-info-field="weatherRefreshMinutes"]').click();
        await expect(page.locator('#app-modal .modal-text')).toContainText(/1440/);
    });

    test('every field with a default also explains itself', async ({ page }) => {
        await loadDashboard(page);
        // dashboard-config.js is lazy-loaded on first open; until then the
        // class it defines is not on window.
        await page.evaluate(() => (window.dashboardInstance.config.behaviorTab = window.dashboardInstance.config.behaviorTab || 'general', window.dashboardInstance.config).openConfigView('behavior'));
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
        // The action bar and the header panel used to be the exception here --
        // "Show the recent button" was taken as self-describing. It says what
        // the button is, not what it does or which key does the same, so every
        // one of them carries an ℹ now and none of them is listed below.
        const allowed = new Set([
            'showSmartTodayCollection', 'showSmartRecentCollection', 'showSmartStaleCollection',
            'showSmartMostUsedCollection', 'showSmartAddedCollection', 'pushNotifyMonitor', 'pushNotifyBackup',
            'pushNotifyRelease', 'pushNotifySubject',
            // Listed in FIELD_META for the ↺ button and the changed-settings
            // count, with a comment saying they carry no ℹ of their own: a
            // field with no `def` reports itself unchanged whatever it holds.
            'pasteDestination', 'monitorEmphasis', 'theme', 'fontSize', 'customTitle',
            // Carried for the ↺ button and the changed-settings count; it has no
            // control of its own, so there is nothing for an ℹ to sit beside.
            'newBookmarkCategory',
            // Reads as part of the toggle above it, which carries the ℹ.
            'rowTagsMax', 'smartAddedLimit',
            // The control names its own default: the first option is
            // "Default (3 seconds)", so an ℹ would repeat the select.
            'healthCheckTimeoutSeconds',
            // Credentials and addresses for one chosen service. Empty is the
            // only sensible default and the label already says which service
            // it belongs to; there is nothing an ℹ could add.
            'monitorNotifyPreset', 'monitorNotifyDashboardUrl', 'monitorNotifyTelegramChatId',
            'monitorNotifyPushoverToken', 'monitorNotifyPushoverUserKey',
            // "Tokens and passwords" / "Saved page copies" — the label is the
            // explanation, like the toolbar toggles above.
            'backupExcludeSecrets', 'backupExcludeArchives',
            // The two review offers carry a hint line under the toggle that
            // says what the card does and what switching it off leaves alone,
            // so the explanation is on screen rather than behind an ℹ.
            'enableTagSuggestionNotice', 'enableHealthReviewNotice',
            // The Kept pair, for the same reason: the hint under each says what
            // it does in a sentence — "Adds a Kept tab to the inbox, and makes
            // Keep in triage put a link there instead of marking it read" —
            // which is the whole of what an ℹ would say.
            'unsortedEnabled', 'keepAutoFile',
            // Two choice cards with a sentence on each, like shortcutDisplay
            // and monitorEmphasis above: the explanation is the control.
            'rowHighlight',
            /*
             * Appearance → Theme, and the header panel beside it.
             *
             * Every one of these is a select or a number with a
             * .config-panel-note under it saying what it does — the paragraph
             * beside Depth, Glow, Text contrast and the two Backdrop controls
             * is longer than an ℹ dialog would be, and it is on screen while
             * you are choosing rather than behind a button.
             */
            'themeDepth', 'glowStrength', 'inkGap', 'themeBackdrop', 'backgroundPattern',
            'headerClockPlacement',
        ]);
        expect(gaps.filter((f) => !allowed.has(f))).toEqual([]);
    });

    test('date & weather sits under Appearance, after Action bar', async ({ page }) => {
        await loadDashboard(page);
        await page.evaluate(() => (window.dashboardInstance.config.appearanceTab = window.dashboardInstance.config.appearanceTab || 'general', window.dashboardInstance.config).openConfigView('appearance'));
        const order = await page.locator('[data-appearance-tab]').evaluateAll((els) =>
            els.map((el) => el.getAttribute('data-appearance-tab')));
        expect(order.indexOf('datetime')).toBe(order.indexOf('buttonbar') + 1);

        await page.locator('[data-appearance-tab="datetime"]').click();
        await expect(page.locator('[data-behavior-field="weatherLocation"]')).toBeVisible();

        await page.evaluate(() => (window.dashboardInstance.config.behaviorTab = window.dashboardInstance.config.behaviorTab || 'general', window.dashboardInstance.config).openConfigView('behavior'));
        await expect(page.locator('[data-behavior-tab="datetime"]')).toHaveCount(0);

        // An old link follows the tab to its new home.
        await page.goto('/#config/behavior/datetime');
        await expect(page.locator('[data-appearance-tab="datetime"]')).toHaveAttribute('aria-selected', 'true');
        await expect.poll(() => page.evaluate(() => location.hash)).toBe('#config/appearance/datetime');
    });

    test('behavior is split into sub-tabs', async ({ page }) => {
        await loadDashboard(page);
        await page.evaluate(() => (window.dashboardInstance.config.behaviorTab = window.dashboardInstance.config.behaviorTab || 'general', window.dashboardInstance.config).openConfigView('behavior'));
        for (const tab of ['general', 'search', 'inbox', 'privacy', 'status']) {
            await expect(page.locator(`[data-behavior-tab="${tab}"]`)).toBeVisible();
        }
        await page.evaluate(() => (window.dashboardInstance.config.appearanceTab = window.dashboardInstance.config.appearanceTab || 'general', window.dashboardInstance.config).openConfigView('appearance'));
        for (const tab of ['general', 'layout', 'datetime', 'display']) {
            await expect(page.locator(`[data-appearance-tab="${tab}"]`)).toBeVisible();
        }
    });

    test('appearance controls show info buttons', async ({ page }) => {
        await loadDashboard(page);
        await page.evaluate(() => (window.dashboardInstance.config.appearanceTab = window.dashboardInstance.config.appearanceTab || 'general', window.dashboardInstance.config).openConfigView('appearance'));
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
            (window.dashboardInstance.config.appearanceTab = window.dashboardInstance.config.appearanceTab || 'general', window.dashboardInstance.config).openConfigView('appearance');
        });

        const resetBtn = page.locator('[data-reset-field="backgroundType"]');
        await expect(resetBtn).toHaveClass(/is-visible/);
        await resetBtn.click();

        await expect.poll(() => saved && saved.backgroundType).toBe('none');
        await expect(page.locator('[data-reset-field="backgroundType"]')).not.toHaveClass(/is-visible/);
    });
});
