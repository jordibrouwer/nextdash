// @ts-check
const { test, expect } = require('./fixtures');
const { dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');
const fs = require('fs');
const os = require('os');
const path = require('path');

async function openBackups(page) {
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.evaluate(() => window.dashboardInstance.config.openConfigView('data-backups'));
    /*
     * The panels on this tab are <details> and shut by default. Their contents
     * stay in the DOM either way, but a click needs them on screen — so this
     * opens them all, which is what a person does to the one they came for.
     */
    await page.waitForSelector('.config-source-panel', { timeout: 15_000 });
    await page.evaluate(() => {
        document.querySelectorAll('.config-source-panel').forEach((panel) => panel.setAttribute('open', ''));
    });
    await expect(page.locator('[data-backup-action="download"]')).toBeVisible();
}

test.describe('backup download and restore', () => {
    test('the full backup downloads instead of failing on the write token', async ({ page }) => {
        await openBackups(page);
        // /api/backup requires a write token; a plain window.location navigation
        // does not carry one, so this used to 401 and produce no file at all —
        // silently, because nothing checks the result of a navigation.
        const download = page.waitForEvent('download', { timeout: 20_000 });
        await page.locator('[data-backup-action="download"]').click();
        const file = await download;
        expect(file.suggestedFilename()).toMatch(/\.zip$/);
        const saved = path.join(os.tmpdir(), `nd-test-${Date.now()}.zip`);
        await file.saveAs(saved);
        expect(fs.statSync(saved).size).toBeGreaterThan(0);
        fs.unlinkSync(saved);
    });

    test('a downloaded backup can be imported again', async ({ page }) => {
        await openBackups(page);
        const download = page.waitForEvent('download', { timeout: 20_000 });
        await page.locator('[data-backup-action="download"]').click();
        const saved = path.join(os.tmpdir(), `nd-roundtrip-${Date.now()}.zip`);
        await (await download).saveAs(saved);

        // Something that is deliberately not in the archive.
        const marker = `RESTORE-MARKER-${Date.now()}`;
        await page.evaluate(async (name) => {
            await window.dashboardInstance.config.writeFetch('/api/bookmarks/add', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ page: 1, bookmark: { name, url: 'https://marker.example.com' } }),
            });
        }, marker);
        await expect.poll(() => page.evaluate(async (n) =>
            (await (await fetch('/api/bookmarks?all=true')).json()).some((b) => b.name === n), marker)).toBe(true);

        await page.locator('[data-backup-action="import"]').click();
        await page.locator('#config-import-input').setInputFiles(saved);
        await expect(page.locator('#config-confirm-modal')).toBeVisible();
        await page.locator('[data-confirm="ok"]').click();

        // The archive is a .zip posted whole; the endpoint used to expect the
        // loose files the old config produced with JSZip and answered 400.
        await expect.poll(() => page.evaluate(async (n) =>
            (await (await fetch('/api/bookmarks?all=true')).json()).some((b) => b.name === n), marker),
            { timeout: 15_000 }).toBe(false);
        fs.unlinkSync(saved);
    });

    test('a stored automatic backup can be downloaded and restored', async ({ page }) => {
        await openBackups(page);
        // Make sure there is one to work with.
        await page.locator('[data-backup-action="run"]').click();
        await expect.poll(() => page.locator('[data-backup-item="restore"]').count(),
            { timeout: 15_000 }).toBeGreaterThan(0);

        const download = page.waitForEvent('download', { timeout: 20_000 });
        await page.locator('[data-backup-item="download"]').first().click();
        expect((await download).suggestedFilename()).toMatch(/\.zip$/);

        const marker = `AUTO-MARKER-${Date.now()}`;
        await page.evaluate(async (name) => {
            await window.dashboardInstance.config.writeFetch('/api/bookmarks/add', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ page: 1, bookmark: { name, url: 'https://auto.example.com' } }),
            });
        }, marker);

        await page.locator('[data-backup-item="restore"]').first().click();
        await expect(page.locator('#config-confirm-modal')).toBeVisible();
        await page.locator('[data-confirm="ok"]').click();
        await expect.poll(() => page.evaluate(async (n) =>
            (await (await fetch('/api/bookmarks?all=true')).json()).some((b) => b.name === n), marker),
            { timeout: 15_000 }).toBe(false);
    });

    /*
     * Making a backup builds the whole archive in one request, and with local
     * copies of pages in it that takes seconds. Without the overlay the button
     * does nothing visible for that whole time, which reads as a dead button
     * rather than as work in progress -- so the reader presses it again.
     */
    test('making a backup shows the same progress overlay the rest of the app uses', async ({ page }) => {
        await openBackups(page);

        // The archive is written fast enough here that the overlay would open
        // and close between two polls. Holding the response open makes the
        // in-progress state observable; it is the same request either way.
        await page.route('**/api/auto-backups/run', async (route) => {
            await new Promise((resolve) => setTimeout(resolve, 2000));
            await route.continue();
        });

        // Through the button a person actually presses, not the method behind it.
        await page.locator('[data-backup-action="run"]').click();

        const overlay = page.locator('#nextdash-progress-overlay');
        await expect(overlay).toBeVisible({ timeout: 5_000 });
        // Indeterminate while the length is unknown -- a bar parked at zero
        // reads as frozen, which is the problem the overlay exists to solve.
        await expect(overlay.locator('[data-progress-fill]'))
            .toHaveClass(/progress-overlay-fill--indeterminate/);
        await expect(overlay.locator('[data-progress-title]')).not.toHaveText('');

        // And it goes again once the backup is written, rather than sitting there.
        await expect(overlay).toBeHidden({ timeout: 15_000 });
        await expect.poll(() => page.locator('[data-backup-item="restore"]').count(),
            { timeout: 15_000 }).toBeGreaterThan(0);
    });

    test('a backup that fails takes the overlay down with it', async ({ page }) => {
        await openBackups(page);
        // The failure path used to be the one that left an overlay on screen
        // with no way back: hide() has to run whether or not the write worked.
        await page.route('**/api/auto-backups/run', (route) =>
            route.fulfill({ status: 500, body: 'Failed to create backup' }));

        await page.locator('[data-backup-action="run"]').click();
        await expect(page.locator('#nextdash-progress-overlay')).toBeHidden({ timeout: 10_000 });
    });
});
