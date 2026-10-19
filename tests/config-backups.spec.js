// @ts-check
const { test, expect } = require('./fixtures');
const { dismissOnboardingIfPresent, dismissBlockingOverlays, markWhatsNewSeen } = require('./e2e-helpers');

/**
 * Config → Data & backups: the panel has to say what will happen, not only what
 * has happened.
 *
 * The tile promised "Next" and then nothing, because the one thing here that
 * points at the future went through a formatter that only knew how to say
 * "ago". The rotation limit was a constant the client never saw, so nothing
 * warned that making a backup on a full rotation drops the oldest. And a row
 * offered Restore with a size in kilobytes as the only clue to what was in it.
 */

async function openBackups(page) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.evaluate(() => window.dashboardInstance.config.openConfigView('data-backups'));
    await page.waitForSelector('#config-db-body', { timeout: 15_000 });
    await expect.poll(() => page.evaluate(() =>
        window.dashboardInstance.config._backupData != null), { timeout: 15_000 }).toBe(true);
}

/** Wait for the stored backups list: it is on the page, under Restore. */
async function openStoredBackups(page) {
    await page.waitForSelector('#config-backup-list', { timeout: 15_000 });
}

test.describe('a relative time that can face forwards', () => {
    test('the future reads as the future, not as "just now"', async ({ page }) => {
        await openBackups(page);

        const said = await page.evaluate(() => {
            const c = window.dashboardInstance.config;
            const hour = 3600_000;
            return {
                // The next backup is days off. Under the old formatter every one
                // of these fell into the under-a-minute branch, because the
                // difference was negative.
                inDays: c.formatRelative(new Date(Date.now() + 6 * 24 * hour).toISOString()),
                inHours: c.formatRelative(new Date(Date.now() + 5 * hour).toISOString()),
                // And a timestamp rather than a string used to come back empty,
                // which is what left the tile reading "Next" with nothing after.
                fromNumber: c.formatRelative(Date.now() + 6 * 24 * hour),
                // The past still works.
                ago: c.formatRelative(new Date(Date.now() - 5 * hour).toISOString()),
            };
        });

        expect(said.inDays).toMatch(/6/);
        expect(said.inDays).not.toMatch(/ago|just now/i);
        expect(said.inHours).toMatch(/5/);
        expect(said.fromNumber).not.toBe('');
        expect(said.ago).toMatch(/ago/i);
    });

    test('the status names when the next backup is due', async ({ page }) => {
        await openBackups(page);
        const detail = await page.evaluate(() => {
            const c = window.dashboardInstance.config;
            const note = document.querySelector('#config-db-body [data-db-status] .config-db-status-text .config-panel-note');
            return { text: note?.textContent?.trim() || '', enabled: c._backupData?.enabled };
        });
        test.skip(!detail.enabled, 'automatic backups are off on this install');
        // It used to render the label and stop.
        expect(detail.text).toMatch(/Next one .*\d/);
    });
});

test.describe('what the rotation will do', () => {
    test('the panel says how many are kept', async ({ page }) => {
        await openBackups(page);
        const keep = await page.evaluate(() => window.dashboardInstance.config._backupData?.keep);
        expect(keep).toBeGreaterThanOrEqual(1);

        const backups = await page.evaluate(() =>
            window.dashboardInstance.config._backupData?.backups?.length || 0);
        test.skip(backups === 0, 'no stored backups on this install');
        /*
         * The list is behind a fold now, so this opens the panel it lives in —
         * which is what a person does. The rotation note is inside that list,
         * and the tile above the panels carries the count for a glance.
         */
        await openStoredBackups(page);
        await expect(page.locator('#config-backup-list .config-panel-note').first())
            .toContainText(String(keep));
    });

    test('a row says what is inside, and when exactly it was made', async ({ page }) => {
        await openBackups(page);
        const backups = await page.evaluate(() =>
            window.dashboardInstance.config._backupData?.backups?.length || 0);
        test.skip(backups === 0, 'no stored backups on this install');

        const row = page.locator('#config-db-body .config-backup-row').first();
        // Size alone cannot tell you whether this is the backup from before the
        // import that went wrong.
        await expect(row.locator('.config-backup-size')).toContainText(/bookmarks/i);
        // "15h ago" is the right thing to read; the exact moment is what you
        // need when three of them are from the same day.
        await expect(row.locator('.config-backup-name')).toHaveAttribute('title', /\d/);
    });

    test('every stored backup can be saved in one go', async ({ page }) => {
        await openBackups(page);
        const backups = await page.evaluate(() =>
            window.dashboardInstance.config._backupData?.backups?.length || 0);
        test.skip(backups === 0, 'no stored backups on this install');
        await openStoredBackups(page);
        await expect(page.locator('[data-backup-action="download-all"]')).toBeVisible();
    });
});

test.describe('the tab holds what belongs to it', () => {
    test('how often a backup is made is a choice', async ({ page }) => {
        await openBackups(page);
        const select = page.locator('[data-backup-select="autoBackupIntervalDays"]');
        await expect(select).toBeVisible();
        // Daily to monthly, which is what the server clamps to.
        const values = await select.locator('option').evaluateAll((els) => els.map((e) => e.value));
        expect(values).toEqual(['1', '7', '14', '30']);
    });

    test('link rechecking is not on the backups tab', async ({ page }) => {
        await openBackups(page);
        // It was a second copy of a control that already lives on
        // Monitoring → Checks, on a tab about moving data around.
        await expect(page.locator('#config-db-body [data-backup-toggle="healthAutoRecheckEnabled"]'))
            .toHaveCount(0);

        await page.evaluate(() => {
            const c = window.dashboardInstance.config;
            c.monitoringTab = 'checks';
            return c.openConfigView('monitoring');
        });
        // Behaviour panels stamp their controls with data-behavior-field.
        await expect(page.locator('[data-behavior-field="healthAutoRecheckEnabled"]').first())
            .toBeVisible({ timeout: 10_000 });
    });
});

test.describe('Backups & data is read top to bottom', () => {
    test('a status, then Protect, Restore and Move, with the actions in view', async ({ page }) => {
        await openBackups(page);
        const body = page.locator('#config-db-body');
        await expect(body.locator('[data-db-status]')).toBeVisible();
        await expect(body.locator('.config-db-group')).toHaveText(['Protect', 'Restore', 'Move']);
        // Nothing is folded away: the buttons are on the page.
        for (const action of ['run', 'download', 'import', 'html-export', 'csv-export', 'csv-import', 'browser-import', 'settings-export', 'settings-import']) {
            await expect(body.locator(`[data-backup-action="${action}"]`)).toBeVisible();
        }
    });

    test('an ℹ opens its explanation in a dialog', async ({ page }) => {
        await openBackups(page);
        await page.locator('#config-db-body [data-db-info="secrets"]').click();
        await expect(page.locator('#app-modal.show')).toContainText('the backup file itself is a secret');
        await page.keyboard.press('Escape');
        await expect(page.locator('#app-modal.show')).toHaveCount(0);
    });
});
