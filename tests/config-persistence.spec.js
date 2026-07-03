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
    test.describe.configure({ mode: 'serial' });

    test.beforeEach(async ({ page }) => {
        await page.setViewportSize({ width: 1280, height: 800 });
    });

    test('recomputeDirtyState marks dirty after settings change', async ({ page }) => {
        await waitForConfigReady(page);

        await expect.poll(() => page.evaluate(() => window.configManager.isDirty)).toBe(false);

        await page.evaluate(async () => {
            const cm = window.configManager;
            const savedColumns = Number(cm.savedSnapshot?.settingsData?.columnsPerRow);
            let next = Number(cm.settingsData.columnsPerRow) || 3;
            do {
                next = next >= 6 ? 2 : next + 1;
            } while (Number.isFinite(savedColumns) && next === savedColumns);
            cm.settingsData.columnsPerRow = next;
            cm.scheduleDirtyRecompute();
            await new Promise((resolve) => setTimeout(resolve, 250));
        });

        await expect.poll(() => page.evaluate(() => window.configManager.isDirty), { timeout: 5_000 }).toBe(true);
        await expect.poll(() => page.evaluate(() => document.body.classList.contains('config-is-dirty'))).toBe(true);
        await expect(page.locator('#save-btn')).toHaveClass(/has-unsaved/);
    });

    test('saveChanges persists a settings edit', async ({ page }) => {
        await waitForConfigReady(page);

        const before = await page.evaluate(() => window.configManager.settingsData.columnsPerRow);
        const next = before >= 6 ? 2 : before + 1;

        await page.locator('#columns-input').fill(String(next));
        await page.locator('#columns-input').dispatchEvent('input');
        await page.locator('#columns-input').dispatchEvent('change');

        await expect.poll(() => page.evaluate(() => window.configManager.isDirty)).toBe(true);

        const saveError = await page.evaluate(async () => {
            try {
                await window.configManager.saveChanges();
                return null;
            } catch (error) {
                return error?.message || String(error);
            }
        });
        expect(saveError).toBeNull();

        await expect.poll(() => page.evaluate(() => window.configManager.isDirty)).toBe(false);
        await expect.poll(() => page.evaluate(() => window.configManager.settingsData.columnsPerRow)).toBe(next);
    });

    test('settings-only save skips bookmark API writes', async ({ page }) => {
        await waitForConfigReady(page);

        const before = await page.evaluate(() => window.configManager.settingsData.columnsPerRow);
        const next = before >= 6 ? 2 : before + 1;

        await page.locator('#columns-input').fill(String(next));
        await page.locator('#columns-input').dispatchEvent('input');
        await page.locator('#columns-input').dispatchEvent('change');
        await expect.poll(() => page.evaluate(() => window.configManager.isDirty)).toBe(true);

        const stats = await page.evaluate(async (columns) => {
            let bookmarkPosts = 0;
            let settingsPosts = 0;
            const originalFetch = window.fetch.bind(window);
            window.fetch = (input, init = {}) => {
                const url = String(input || '');
                const method = String(init.method || 'GET').toUpperCase();
                if (url.includes('/api/bookmarks') && method === 'POST') {
                    bookmarkPosts += 1;
                }
                if (url.includes('/api/settings') && method === 'POST') {
                    settingsPosts += 1;
                }
                return originalFetch(input, init);
            };
            const started = performance.now();
            await window.configManager.saveChanges();
            return {
                bookmarkPosts,
                settingsPosts,
                elapsedMs: performance.now() - started,
            };
        }, next);

        expect(stats.bookmarkPosts).toBe(0);
        expect(stats.settingsPosts).toBe(1);
        expect(stats.elapsedMs).toBeLessThan(2000);

        await expect.poll(async () => {
            const text = await page.locator('#app-notification .app-notification-text').textContent();
            return text || '';
        }).toMatch(/saved|opgeslagen/i);
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

    test('saveChanges with bookmark category edit signals settings sync', async ({ page }) => {
        await waitForConfigReady(page);

        const result = await page.evaluate(async () => {
            const cm = window.configManager;
            cm.ui.switchToTab('bookmarks');
            await cm.loadPageBookmarks(cm.currentPageId || 1);
            const bm = cm.bookmarksData?.[0];
            if (!bm) {
                return { ok: false, reason: 'no-bookmarks' };
            }
            const originalCategory = bm.category;
            const nextCategory = originalCategory === 'media' ? 'development' : 'media';
            bm.category = nextCategory;
            cm.markDirty();

            const structureKey = cm.structureSyncEventKey;
            const settingsKey = cm.settingsSyncEventKey;
            localStorage.removeItem(structureKey);
            localStorage.removeItem(settingsKey);
            sessionStorage.removeItem('nextdash:pending-dashboard-structure-sync');
            sessionStorage.removeItem('nextdash:pending-dashboard-settings-sync');

            await cm.saveChanges();

            const structurePayload = JSON.parse(localStorage.getItem(structureKey) || 'null');
            const settingsPayload = JSON.parse(localStorage.getItem(settingsKey) || 'null');

            bm.category = originalCategory;
            cm.markDirty();
            await cm.saveChanges();

            return {
                ok: true,
                settingsType: settingsPayload?.type,
                hasStructurePayload: Boolean(structurePayload),
            };
        });

        expect(result.ok).toBe(true);
        expect(result.settingsType).toBe('settings-saved');
        expect(result.hasStructurePayload).toBe(false);
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
