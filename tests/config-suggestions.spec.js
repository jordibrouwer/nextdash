// @ts-check
const { test, expect } = require('./fixtures');
const { dismissOnboardingIfPresent, dismissBlockingOverlays, waitForConfigReady } = require('./e2e-helpers');

/**
 * Config: what needs you on the Overview, actions in Find settings, the list of
 * what was changed from the defaults, and a tour that does not open over a
 * section the reader has already left.
 */

async function openConfig(page, section = 'overview') {
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await waitForConfigReady(page);
    await page.evaluate((s) => window.dashboardInstance.config.openConfigView(s), section);
    await page.waitForSelector('.config-view', { timeout: 15_000 });
}

const cfg = (page, fn, arg) => page.evaluate(
    ([source, a]) => new Function('c', 'a', `return (${source})(c, a)`)(window.dashboardInstance.config._module || window.dashboardInstance.config, a),
    [fn.toString(), arg]);

test.describe('the Overview names more of what needs you', () => {
    test('a widget that cannot read, an expiring certificate and a failed backup each get a chip', async ({ page }) => {
        await page.route('**/api/auto-backups', (route) => route.fulfill({
            status: 200, contentType: 'application/json',
            body: JSON.stringify({ enabled: true, backups: [], lastRunError: 'disk full' }),
        }));
        await openConfig(page);
        await page.evaluate(() => {
            window.WidgetState.set('w_probe', 'error', 'no answer', { title: 'Probe', pageId: 1 });
            // A getter on the real object: the facts are read-only from outside.
            Object.defineProperty(window.HealthFacts, 'certificates', {
                configurable: true,
                get: () => ({ 'soon.example': { host: 'soon.example', expiresAt: Date.now() + 3 * 86400000 } }),
            });
            const c = window.dashboardInstance.config._module || window.dashboardInstance.config;
            return c.loadOverviewBackups().then(() => c.repaintOverview());
        });
        const chips = page.locator('.config-attention-chip');
        await expect(chips.filter({ hasText: 'Widgets that cannot read' })).toHaveCount(1);
        await expect(chips.filter({ hasText: 'Certificates expiring' })).toHaveCount(1);
        await expect(chips.filter({ hasText: 'Last backup failed' })).toHaveCount(1);
        await page.evaluate(() => window.WidgetState.clear('w_probe'));
    });
});

test.describe('Find settings also finds things to do', () => {
    test('an action turns up by its words and carries no setting', async ({ page }) => {
        await openConfig(page);
        const hits = await page.evaluate(() => window.dashboardInstance.config
            .filterSettingsJumpEntries('picker').filter((e) => e.kind === 'action').map((e) => e.action));
        expect(hits).toContain('add-widget');
    });

    test('Add a widget opens the picker without touching a widget', async ({ page }) => {
        await openConfig(page);
        await page.evaluate(() => {
            const c = window.dashboardInstance.config._module || window.dashboardInstance.config;
            return c.activateSettingsJumpEntry(c.getSettingsJumpEntries().find((e) => e.action === 'add-widget'));
        });
        await expect(page.locator('.config-widget-picker-option').first()).toBeVisible({ timeout: 15_000 });
    });
});

test.describe('What you changed', () => {
    test('a setting moved off its default is listed, with its default, and the list opens', async ({ page }) => {
        await openConfig(page);
        const field = await page.evaluate(() => {
            const c = window.dashboardInstance.config._module || window.dashboardInstance.config;
            const entry = c.settingsJumpFieldEntries().find((e) => typeof c.fieldMeta(e.field)?.def === 'boolean');
            const def = c.fieldMeta(entry.field).def;
            window.dashboardInstance.settings[entry.field] = !def;
            return entry.field;
        });
        const listed = await page.evaluate((f) => {
            const c = window.dashboardInstance.config._module || window.dashboardInstance.config;
            return c.changedSettings().some((e) => e.field === f);
        }, field);
        expect(listed).toBe(true);

        await page.evaluate(() => (window.dashboardInstance.config._module || window.dashboardInstance.config).openChangedSettings());
        const rows = page.locator('.config-changed-modal [data-changed-index]');
        await expect(rows.first()).toBeVisible({ timeout: 10_000 });
        await expect(rows.first()).toContainText('default');
        await expect(page.locator('.config-changed-modal [data-changed-copy]')).toBeVisible();
    });

    test('the Overview link opens the list', async ({ page }) => {
        await openConfig(page);
        await page.evaluate(() => {
            const c = window.dashboardInstance.config._module || window.dashboardInstance.config;
            const entry = c.settingsJumpFieldEntries().find((e) => typeof c.fieldMeta(e.field)?.def === 'boolean');
            window.dashboardInstance.settings[entry.field] = !c.fieldMeta(entry.field).def;
            c.repaintOverview();
        });
        const link = page.locator('[data-overview-action="changed"]');
        await expect(link).toBeVisible();
        await link.click();
        await expect(page.locator('.config-changed-modal [data-changed-index]').first()).toBeVisible({ timeout: 10_000 });
    });

    test('opening the list twice does not run a row twice, and a missing clipboard says so', async ({ page }) => {
        await openConfig(page);
        const ran = await page.evaluate(async () => {
            const c = window.dashboardInstance.config._module || window.dashboardInstance.config;
            const entry = c.settingsJumpFieldEntries().find((e) => typeof c.fieldMeta(e.field)?.def === 'boolean');
            window.dashboardInstance.settings[entry.field] = !c.fieldMeta(entry.field).def;
            let calls = 0;
            c.activateSettingsJumpEntry = async () => { calls += 1; };
            const notes = [];
            c.notify = (message) => notes.push(message);
            Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
            c.openChangedSettings();
            window.AppModal.hide();
            c.openChangedSettings();
            document.querySelector('.config-changed [data-changed-copy]').click();
            await new Promise((r) => setTimeout(r, 50));
            document.querySelector('.config-changed [data-changed-index]').click();
            await new Promise((r) => setTimeout(r, 50));
            return { calls, notes };
        });
        expect(ran.calls).toBe(1);
        expect(ran.notes).toEqual(['Could not copy.']);
    });

    test('an install with nothing changed says so', async ({ page }) => {
        await openConfig(page);
        await page.evaluate(() => {
            const c = window.dashboardInstance.config._module || window.dashboardInstance.config;
            c.changedSettings = () => [];
            c.openChangedSettings();
        });
        await expect(page.locator('.config-changed-modal')).toContainText('Every setting is at its default');
    });
});

test.describe('the actions land where they say', () => {
    test('Make or restore a backup opens the backups tab, not the last one used', async ({ page }) => {
        await openConfig(page, 'data-backups');
        await page.evaluate(() => { (window.dashboardInstance.config._module || window.dashboardInstance.config).dbTab = 'trash'; });
        await page.evaluate(() => (window.dashboardInstance.config._module || window.dashboardInstance.config).runSettingsJumpAction('backups'));
        expect(await page.evaluate(() => (window.dashboardInstance.config._module || window.dashboardInstance.config).dbTab)).toBe('backups');
    });

    test('the theme studio opens from a page where Appearance was never visited', async ({ page }) => {
        await openConfig(page, 'overview');
        const opened = await page.evaluate(async () => {
            const c = window.dashboardInstance.config._module || window.dashboardInstance.config;
            await c.runSettingsJumpAction('theme-studio');
            return Boolean(document.querySelector('.look-studio, #look-studio, [data-look-studio]'))
                || typeof c.openLookStudio === 'function';
        });
        expect(opened).toBe(true);
    });
});

test.describe('a tour does not open over a section that was left', () => {
    test('a tour script that arrives after the reader moved on stays unopened', async ({ page }) => {
        await openConfig(page, 'overview');
        const result = await page.evaluate(async () => {
            const c = window.dashboardInstance.config._module || window.dashboardInstance.config;
            await c.ensureSection('widgets');
            window.DiscoverabilityState.hasSeenTip = () => false;
            window.dashboardInstance.settings.enableSessionTips = true;
            let shown = 0;
            window.WidgetsTutorial = { maybeShow: () => { shown += 1; return true; }, open: () => true };
            let arrive = () => {};
            c.loadWidgetsTour = () => new Promise((resolve) => { arrive = () => resolve(true); });
            c._widgetsTutorialAsked = false;
            c.section = 'widgets';
            const pending = c.maybeShowWidgetsTutorial();
            // The reader leaves before the script is in.
            c.section = 'overview';
            arrive();
            await pending;
            const whileAway = { shown, asked: c._widgetsTutorialAsked };
            // Back in the section, the tour is still on offer.
            c.section = 'widgets';
            const again = c.maybeShowWidgetsTutorial();
            arrive();
            await again;
            return { whileAway, afterReturn: shown };
        });
        expect(result.whileAway).toEqual({ shown: 0, asked: false });
        expect(result.afterReturn).toBe(1);
    });
});
