// @ts-check
const { test, expect } = require('@playwright/test');
const { dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * The reset actions used to POST with no body, while the server requires an
 * explicit {"confirm":true} and answered 400. These tests assert the server's
 * response, not just that a click happened, so a silent 400 fails them.
 */
async function openReset(page) {
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.evaluate(() => window.dashboardInstance.config.openConfigView('data-backups'));
    await page.locator('[data-db-tab="reset"]').click();
    await expect(page.locator('[data-backup-action="reset"]')).toBeVisible();
}

test.describe('config data & backups — reset tab', () => {
    test('destructive actions live on their own Reset tab', async ({ page }) => {
        await page.goto('/');
        await page.waitForSelector('#dashboard-layout', { timeout: 15_000 });
        await dismissOnboardingIfPresent(page);
        await dismissBlockingOverlays(page);
        await page.evaluate(() => window.dashboardInstance.config.openConfigView('data-backups'));

        // Not on the default tab...
        await expect(page.locator('[data-backup-action="reset"]')).toHaveCount(0);
        await expect(page.locator('[data-backup-action="download"]')).toBeVisible();

        // ...and present once you switch to Reset.
        await page.locator('[data-db-tab="reset"]').click();
        await expect(page.locator('[data-backup-action="reset"]')).toBeVisible();
        await expect(page.locator('[data-backup-action="delete-bookmarks"]')).toBeVisible();
        await expect(page.locator('[data-backup-action="download"]')).toHaveCount(0);
    });

    test('the reset tab is deep-linkable', async ({ page }) => {
        await page.goto('/#config/data-backups/reset');
        await page.waitForSelector('#dashboard-layout', { timeout: 15_000 });
        await dismissOnboardingIfPresent(page);
        await expect(page.locator('[data-backup-action="reset"]')).toBeVisible({ timeout: 10_000 });
    });

    test('reset asks twice: confirm, then type the word', async ({ page }) => {
        await openReset(page);
        await page.locator('[data-backup-action="reset"]').click();

        // First gate: the plain confirm.
        await expect(page.locator('#config-confirm-modal')).toBeVisible();
        await page.locator('[data-confirm="ok"]').click();

        // Second gate: a text field, with the confirm button disabled until the
        // typed word matches.
        const input = page.locator('[data-confirm-input]');
        await expect(input).toBeVisible();
        const ok = page.locator('[data-confirm="ok"]');
        await expect(ok).toBeDisabled();

        await input.fill('nope');
        await expect(ok).toBeDisabled();

        await input.fill('RESET');
        await expect(ok).toBeEnabled();

        // Leave without resetting: this suite must not wipe the test data.
        await page.locator('[data-confirm="cancel"]').click();
        await expect(page.locator('#config-confirm-modal')).toHaveCount(0);
    });

    test('the typed word is matched case- and space-insensitively', async ({ page }) => {
        await openReset(page);
        await page.locator('[data-backup-action="reset"]').click();
        await page.locator('[data-confirm="ok"]').click();
        const input = page.locator('[data-confirm-input]');
        await input.fill('  reset  ');
        await expect(page.locator('[data-confirm="ok"]')).toBeEnabled();
        await page.locator('[data-confirm="cancel"]').click();
    });

    test('delete-all-bookmarks is accepted by the server', async ({ page }) => {
        await openReset(page);
        // Watch the real response: a missing confirm body answers 400.
        const status = page.waitForResponse((r) => r.url().includes('/api/bookmarks/delete-all'));
        await page.locator('[data-backup-action="delete-bookmarks"]').click();
        await page.locator('[data-confirm="ok"]').click();
        expect((await status).status()).toBe(200);
    });
});
