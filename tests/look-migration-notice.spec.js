// @ts-check
const { test, expect } = require('./fixtures');
const { dismissOnboardingIfPresent, markWhatsNewSeen } = require('./e2e-helpers');

/**
 * The dialog that explains the move onto Aurora Glass.
 *
 * The server moves an existing install once (migrateToAuroraGlass) and leaves
 * settings.lookMigration = { from, pending: true }. The page answers with a dialog in the middle,
 * not a corner card. A fresh install has no lookMigration and sees nothing.
 */
async function withMigration(page, migration, theme) {
    await page.route('**/api/settings', async (route) => {
        if (route.request().method() !== 'GET') return route.continue();
        const response = await route.fetch();
        const body = await response.json();
        if (migration) body.lookMigration = migration;
        if (theme) body.theme = theme;
        await route.fulfill({ response, json: body });
    });
    await markWhatsNewSeen(page);
}

const dialog = (page) => page.locator('.look-migration-modal');

test.describe('the look migration dialog', () => {
    test('an upgraded install is told what it had, what is better and where Classic lives', async ({ page }) => {
        await withMigration(page, { from: 'slate-dark', pending: true, at: 1 }, 'aurora-glass-dark');
        await page.goto('/');
        await page.waitForSelector('.bookmark-link', { timeout: 20_000 });
        await dismissOnboardingIfPresent(page);
        await expect(dialog(page)).toBeVisible({ timeout: 20_000 });
        await expect(dialog(page)).toContainText('looks different now, and better');
        // It opens with an apology and a joke, not with a notice.
        await expect(dialog(page).locator('.look-migration-sorry')).toHaveText(/^Sorry!/);
        await expect(dialog(page)).toContainText('Slate [dark]');
        await expect(dialog(page)).toContainText('Aurora Glass [dark]');
        await expect(dialog(page)).toContainText('Surface → Material style → Classic');
        // Spoken about the dashboard and the reader, never about "we".
        expect(await dialog(page).innerText()).not.toMatch(/\bwe\b/i);
    });

    test('no corner card opens while the dialog is up, or on its way', async ({ page }) => {
        await withMigration(page, { from: 'slate-dark', pending: true, at: 1 }, 'aurora-glass-dark');
        await page.goto('/');
        await page.waitForSelector('.bookmark-link', { timeout: 20_000 });
        await dismissOnboardingIfPresent(page);
        // On its way: the dialog is pending and has not opened yet.
        expect(await page.evaluate(() => window.NoticeCard.cornerIsFree('x'))).toBe(false);
        await expect(dialog(page)).toBeVisible({ timeout: 20_000 });
        expect(await page.evaluate(() => window.LookMigrationNotice.blocking())).toBe(true);
        expect(await page.evaluate(() => window.NoticeCard.cornerIsFree('x'))).toBe(false);
        await page.getByRole('button', { name: 'Got it' }).click();
        await expect(dialog(page)).toHaveCount(0);
        await expect.poll(() => page.evaluate(() => window.LookMigrationNotice.blocking())).toBe(false);
    });

    test('Back to the old theme puts it back, and the question is answered when the dialog opens', async ({ page }) => {
        await withMigration(page, { from: 'slate-dark', pending: true, at: 1 }, 'aurora-glass-dark');
        const saved = [];
        page.on('request', (request) => {
            if (request.method() === 'POST' && request.url().endsWith('/api/settings')) saved.push(request.postData());
        });
        await page.goto('/');
        await page.waitForSelector('.bookmark-link', { timeout: 20_000 });
        await dismissOnboardingIfPresent(page);
        await expect(dialog(page)).toBeVisible({ timeout: 20_000 });
        await expect.poll(() => saved.some((body) => /"pending":false/.test(body || ''))).toBe(true);
        await dialog(page).locator('[data-look-migration="back"]').click();
        await expect.poll(() => page.evaluate(() => window.dashboardInstance.settings.theme)).toBe('slate-dark');
        await expect(dialog(page)).toHaveCount(0);
        // Put the shared server back where the next test expects it.
        await page.evaluate(async () => {
            window.dashboardInstance.settings.theme = 'aurora-glass-dark';
            await window.dashboardInstance.saveSettings();
        });
    });

    test('Open the Theme Studio opens the studio on the Surface tab', async ({ page }) => {
        await withMigration(page, { from: 'slate-dark', pending: true, at: 1 }, 'aurora-glass-dark');
        await page.goto('/');
        await page.waitForSelector('.bookmark-link', { timeout: 20_000 });
        await dismissOnboardingIfPresent(page);
        await expect(dialog(page)).toBeVisible({ timeout: 20_000 });
        await page.getByRole('button', { name: 'Open the Theme Studio' }).click();
        await expect(dialog(page)).toHaveCount(0);
        await expect.poll(() => page.evaluate(() => window.ThemeBrowser?.isOpen?.()), { timeout: 15_000 }).toBe(true);
        await expect(page.locator('[data-studio-tab="surface"][aria-selected="true"]')).toBeVisible();
    });

    test('Got it closes it and nothing else changes', async ({ page }) => {
        await withMigration(page, { from: 'slate-light', pending: true, at: 1 }, 'aurora-glass-light');
        await page.goto('/');
        await page.waitForSelector('.bookmark-link', { timeout: 20_000 });
        await dismissOnboardingIfPresent(page);
        await expect(dialog(page)).toBeVisible({ timeout: 20_000 });
        await expect(dialog(page)).toContainText('Slate [light]');
        await page.getByRole('button', { name: 'Got it' }).click();
        await expect(dialog(page)).toHaveCount(0);
        expect(await page.evaluate(() => window.dashboardInstance.settings.theme)).toBe('aurora-glass-light');
    });

    test('a fresh install has no dialog', async ({ page }) => {
        await withMigration(page, null, null);
        await page.goto('/');
        await page.waitForSelector('.bookmark-link', { timeout: 20_000 });
        await dismissOnboardingIfPresent(page);
        await page.waitForTimeout(6000);
        await expect(dialog(page)).toHaveCount(0);
    });
});
