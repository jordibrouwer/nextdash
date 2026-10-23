// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissBlockingOverlays, dismissOnboardingIfPresent } = require('./e2e-helpers');

/**
 * Config → Help has a Glances topic: what to set up first, the page, what is
 * recorded, several hosts, the link with the Containers view, notices and
 * commands. The Tips carry the Glances keys too.
 */

async function openHelp(page, hash) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.goto(`/#config/help/${hash}`);
    await expect(page.locator('#config-help-body')).toBeVisible({ timeout: 15_000 });
}

test.describe('Help: Glances', () => {
    test('a Glances topic with its seven panels, each with text under it', async ({ page }) => {
        await openHelp(page, 'glances');
        await expect(page.locator('[data-help-tab="glances"], [data-help-more="glances"]').first()).toBeAttached();
        const panels = page.locator('#config-help-body [data-help-panel]');
        await expect(panels).toHaveCount(7);
        for (const title of ['Before it works: a Glances 4 host', 'The Glances page', 'What nextDash records', 'Several hosts', 'Glances and the Containers view', 'Notices and commands', 'Compare, forecast and the widget']) {
            await expect(page.locator('#config-help-body').getByText(title, { exact: true }).first()).toBeAttached();
        }
        await expect(page.locator('#config-help-body .config-help-prose').first()).not.toHaveText('');
        // The setup panel leads to Config → Glances.
        await page.locator('#config-help-body [data-overview-go]').first().click();
        await expect(page).toHaveURL(/#config\/glances/);
    });

    test('the Tips list the Glances tips', async ({ page }) => {
        await openHelp(page, 'tips');
        await expect(page.locator('#config-help-body')).toContainText('opens the Glances page from anywhere');
        await expect(page.locator('#config-help-body')).toContainText(':glances record 10s');
    });
});
