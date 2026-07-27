// @ts-check
const { test, expect } = require('@playwright/test');
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
});
