// @ts-check
const { test, expect } = require('@playwright/test');

async function waitForConfigReady(page) {
    await page.goto('/config#general');
    await page.waitForFunction(() => typeof window.configManager?.captureUndoSnapshot === 'function');
    await page.waitForSelector('.general-layout', { timeout: 20_000 });
    await page.evaluate(() => window.configManager.ui.switchToTab('general'));
    await page.waitForSelector('#columns-input', { timeout: 15_000 });
}

test.describe('config persistence (phase 2)', () => {
    test.beforeEach(async ({ page }) => {
        await page.setViewportSize({ width: 1280, height: 800 });
    });

    test('recomputeDirtyState marks dirty after settings change', async ({ page }) => {
        await waitForConfigReady(page);

        await expect.poll(() => page.evaluate(() => window.configManager.isDirty)).toBe(false);

        await page.evaluate(() => {
            const cm = window.configManager;
            const snap = cm.captureUndoSnapshot();
            cm.settingsData.showTitle = !snap.settingsData.showTitle;
            cm.scheduleDirtyRecompute();
        });

        await expect.poll(() => page.evaluate(() => window.configManager.isDirty), { timeout: 5_000 }).toBe(true);
        await expect.poll(() => page.evaluate(() => document.body.classList.contains('config-is-dirty'))).toBe(true);
        await expect(page.locator('#save-btn')).toHaveClass(/has-unsaved/);
    });

    test('captureUndoSnapshot reflects settings edits', async ({ page }) => {
        await waitForConfigReady(page);

        const result = await page.evaluate(() => {
            const cm = window.configManager;
            const before = cm.captureUndoSnapshot().settingsData.columnsPerRow;
            cm.settingsData.columnsPerRow = before === 4 ? 2 : 4;
            cm.markDirty();
            const after = cm.captureUndoSnapshot().settingsData.columnsPerRow;
            return { before, after };
        });

        expect(result.after).not.toBe(result.before);
    });

    test('signalDashboardReload writes structure sync payload', async ({ page }) => {
        await waitForConfigReady(page);

        const payload = await page.evaluate(() => {
            window.configManager.signalDashboardReload('test-structure-sync');
            const key = window.configManager.structureSyncEventKey;
            return JSON.parse(localStorage.getItem(key) || 'null');
        });

        expect(payload?.type).toBe('test-structure-sync');
        expect(typeof payload?.timestamp).toBe('number');
        expect(payload?.sourceTabId).toMatch(/^cfg-/);
    });

    test('restoreUndoSnapshot reverts dirty settings change', async ({ page }) => {
        await waitForConfigReady(page);

        const restored = await page.evaluate(() => {
            const cm = window.configManager;
            const snapshot = cm.captureUndoSnapshot();
            const original = snapshot.settingsData.columnsPerRow;
            cm.settingsData.columnsPerRow = original === 4 ? 2 : 4;
            cm.markDirty();
            cm.restoreUndoSnapshot(snapshot);
            return {
                columnsPerRow: cm.settingsData.columnsPerRow,
                isDirty: cm.isDirty,
            };
        });

        expect(restored.isDirty).toBe(true);
        expect(restored.columnsPerRow).toBe(
            await page.evaluate(() => {
                const cm = window.configManager;
                return cm.captureUndoSnapshot().settingsData.columnsPerRow;
            })
        );
    });
});
