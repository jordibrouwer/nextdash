// @ts-check
const { test, expect } = require('./fixtures');
const { dismissOnboardingIfPresent, dismissBlockingOverlays, markWhatsNewSeen } = require('./e2e-helpers');

/**
 * Icons & previews is its own sub-tab of Data & backups.
 *
 * It used to be the last panel of Backups & data, below the export buttons —
 * unrelated to backing anything up, and two of its three buttons walk every
 * bookmark. Moving it out puts it behind a deliberate click.
 */
async function openData(page) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => !!window.dashboardInstance?.config, null, { timeout: 15_000 });
    await page.evaluate(() => window.dashboardInstance.config.openConfigView('data-backups'));
    await expect(page.locator('[data-db-tab="backups"]')).toBeVisible();
}

test.describe('Data & backups → Icons & previews', () => {
    test('follows Backups & data in the tab strip', async ({ page }) => {
        await openData(page);
        await expect.poll(() => page.evaluate(() =>
            [...document.querySelectorAll('[data-db-tab]')].map((b) => b.getAttribute('data-db-tab'))
        )).toEqual(['backups', 'sources', 'webhooks', 'icons', 'logs', 'trash', 'reset']);
        await expect(page.locator('[data-db-tab="icons"]')).toHaveText('Icons & previews');
    });

    test('the panel and its three actions live on that tab', async ({ page }) => {
        await openData(page);
        await page.locator('[data-db-tab="icons"]').click();

        await expect(page.locator('[data-backup-select="faviconRefreshPolicy"]')).toBeVisible();
        await expect(page.locator('[data-backup-action="refresh-favicons"]')).toBeVisible();
        await expect(page.locator('[data-backup-action="refresh-previews"]')).toBeVisible();
        await expect(page.locator('[data-backup-action="clear-previews"]')).toBeVisible();
        // The tab is the whole content, so nothing else came along with it.
        await expect(page.locator('#config-db-body .config-panel')).toHaveCount(1);
    });

    test('and no longer on Backups & data', async ({ page }) => {
        await openData(page);
        // Still on the first tab: the panel it used to end with must be gone,
        // while the panels that belong there stayed.
        await expect(page.locator('[data-backup-select="faviconRefreshPolicy"]')).toHaveCount(0);
        await expect(page.locator('[data-backup-action="refresh-favicons"]')).toHaveCount(0);
        await expect(page.locator('[data-backup-action="download"]')).toBeVisible();
        await expect(page.locator('[data-backup-action="csv-export"]')).toBeVisible();
    });

    test('the favicon select is still wired up after the move', async ({ page }) => {
        await openData(page);
        await page.locator('[data-db-tab="icons"]').click();

        // Not asserted past this point: the server clamps the stored value to
        // manual/on-save, so none of the four options in this dropdown survives
        // a round-trip. That is a pre-existing mismatch between models.go and
        // the option list, unrelated to which tab the control sits on.
        const next = await page.evaluate(() =>
            window.dashboardInstance.settings.faviconRefreshPolicy === 'weekly' ? 'monthly' : 'weekly');
        // Panels are bound by attribute across the container, but the tab
        // switch repaints only the body — so the binding has to survive it.
        await page.locator('[data-backup-select="faviconRefreshPolicy"]').selectOption(next);
        await expect.poll(() => page.evaluate(() =>
            window.dashboardInstance.settings.faviconRefreshPolicy)).toBe(next);
    });

    test('settings search lands on the new tab, not the old one', async ({ page }) => {
        await openData(page);
        // The jump entry carries the sub-tab; leaving it at 'backups' would
        // open a tab the control is no longer on.
        const target = await page.evaluate(() =>
            window.dashboardInstance.config.settingsJumpFieldEntries()
                .find((e) => e.field === 'faviconRefreshPolicy'));
        expect(target).toMatchObject({ section: 'data-backups', subTab: 'icons' });
        expect(target.subtitle).toContain('Icons & previews');

        // Activating it drives switchSubTab, so this also proves 'icons' is a
        // tab the strip can actually switch to.
        await page.evaluate(async () => {
            const cfg = window.dashboardInstance.config;
            const entry = cfg.settingsJumpFieldEntries()
                .find((e) => e.field === 'faviconRefreshPolicy');
            await cfg.activateSettingsJumpEntry(entry);
        });
        await expect.poll(() => page.evaluate(() => window.dashboardInstance.config.dbTab)).toBe('icons');
        await expect(page.locator('[data-backup-select="faviconRefreshPolicy"]')).toBeVisible();
    });
});
