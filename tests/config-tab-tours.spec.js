// @ts-check
const { test, expect } = require('@playwright/test');

async function waitForConfigReady(page) {
    await page.goto('/config#general');
    await page.waitForFunction(() => typeof window.configManager?.maybeStartConfigGeneralTour === 'function');
    await page.waitForSelector('.general-layout', { timeout: 20_000 });
    await page.evaluate(() => {
        window.configManager.ui.switchToTab('general');
    });
}

async function resetAndForceStartTour(page, tourId) {
    const tourGlobal = {
        general: 'ConfigGeneralTour',
        finders: 'ConfigFindersTour',
    }[tourId];
    const settingsFlag = {
        general: 'configGeneralTourCompleted',
        finders: 'configFindersTourCompleted',
    }[tourId];
    const storageKey = {
        general: 'nextdash:config-general-tour-v1',
        finders: 'nextdash:config-finders-tour-v1',
    }[tourId];
    const maybeStart = {
        general: 'maybeStartConfigGeneralTour',
        finders: 'maybeStartConfigFindersTour',
    }[tourId];
    const ensureTab = {
        general: 'ensureGeneralTabActive',
        finders: 'ensureFindersTabActive',
    }[tourId];

    const activeKey = {
        general: '_configGeneralTourActive',
        finders: '_configFindersTourActive',
    }[tourId];
    const startingKey = {
        general: '_configGeneralTourStarting',
        finders: '_configFindersTourStarting',
    }[tourId];

    return page.evaluate(async ({ tourGlobal, settingsFlag, storageKey, maybeStart, ensureTab, activeKey, startingKey }) => {
        const cm = window.configManager;
        cm.dismissOtherConfigTabTours?.();
        const Tour = window[tourGlobal];
        Tour?.teardownStaleDom?.();
        cm[activeKey] = false;
        cm[startingKey] = false;
        Tour?.resetSeen?.();
        cm.settingsData[settingsFlag] = false;
        localStorage.removeItem(storageKey);
        if (typeof cm[ensureTab] === 'function') {
            cm[ensureTab]();
        }
        if (tourGlobal === 'ConfigFindersTour') {
            await cm.reloadFindersTabData?.({ force: true });
        }
        await new Promise((r) => setTimeout(r, 250));
        return cm[maybeStart]({ force: true });
    }, { tourGlobal, settingsFlag, storageKey, maybeStart, ensureTab, activeKey, startingKey });
}

function tourActiveAttributes(page) {
    return page.evaluate(() => document.body.getAttributeNames().filter((n) => /^data-config-.+-tour-active$/.test(n)));
}

test.describe('config tab tours (phase 1 registry)', () => {
    test.beforeEach(async ({ page }) => {
        await page.setViewportSize({ width: 1280, height: 800 });
    });

    test('general tour shows dimming, lock, and single active tour', async ({ page }) => {
        const pageErrors = [];
        page.on('pageerror', (e) => pageErrors.push(e.message));

        await waitForConfigReady(page);
        const result = await resetAndForceStartTour(page, 'general');
        expect(result?.ok).toBe(true);

        const bodyAttr = 'data-config-general-tour-active';
        await expect.poll(() => page.evaluate((attr) => document.body.hasAttribute(attr), bodyAttr)).toBe(true);
        await expect.poll(() => page.evaluate(() => document.body.classList.contains('guided-flow-locked'))).toBe(true);

        await page.waitForSelector('.config-general-tour-card', { state: 'visible', timeout: 10_000 });
        await expect.poll(() => page.evaluate(() => document.body.classList.contains('config-general-tour-ready'))).toBe(true);

        await page.evaluate(() => {
            document.querySelector('.config-general-tour-card .config-general-tour-next')?.click();
        });
        await expect.poll(async () => page.evaluate(() => Boolean(document.querySelector('.config-general-tour-highlight')))).toBe(true);

        const dimming = await page.evaluate(() => {
            const highlight = document.querySelector('.config-general-tour-highlight');
            if (!highlight) return null;
            const shadow = window.getComputedStyle(highlight).boxShadow;
            return { hasHighlight: true, shadow };
        });
        expect(dimming?.hasHighlight).toBe(true);
        expect(dimming?.shadow).toMatch(/9999px/);

        const activeTours = await tourActiveAttributes(page);
        expect(activeTours).toEqual(['data-config-general-tour-active']);

        expect(pageErrors).toEqual([]);
    });

    test('general tour blocks tab switches and non-highlight controls', async ({ page }) => {
        await waitForConfigReady(page);
        const result = await resetAndForceStartTour(page, 'general');
        expect(result?.ok).toBe(true);

        await page.waitForSelector('.config-general-tour-card', { state: 'visible', timeout: 10_000 });
        await page.evaluate(() => {
            document.querySelector('.config-general-tour-card .config-general-tour-next')?.click();
        });
        await expect.poll(() => page.evaluate(() => Boolean(document.querySelector('.config-general-tour-highlight')))).toBe(true);

        const tabBefore = await page.evaluate(() => document.querySelector('.tab-button.active')?.getAttribute('data-tab'));
        await page.locator('.tab-button[data-tab="bookmarks"]').click({ force: true, timeout: 2000 }).catch(() => {});
        const tabAfter = await page.evaluate(() => document.querySelector('.tab-button.active')?.getAttribute('data-tab'));
        expect(tabAfter).toBe(tabBefore);

        const blocked = await page.evaluate(() => {
            const saveBtn = document.getElementById('save-btn');
            if (!saveBtn) return { missing: true };
            return { pointerEvents: window.getComputedStyle(saveBtn).pointerEvents };
        });
        expect(blocked.pointerEvents).toBe('none');

        const highlightClickable = await page.evaluate(() => {
            const highlight = document.querySelector('.config-general-tour-highlight');
            if (!highlight) return null;
            return window.getComputedStyle(highlight).pointerEvents;
        });
        expect(highlightClickable).toBe('auto');
    });

    test('general tour blocks keyboard tab shortcuts and settings search', async ({ page }) => {
        await waitForConfigReady(page);
        const result = await resetAndForceStartTour(page, 'general');
        expect(result?.ok).toBe(true);

        await page.waitForSelector('.config-general-tour-card', { state: 'visible', timeout: 10_000 });
        await page.locator('.config-general-tour-next').focus();

        const tabBefore = await page.evaluate(() => document.querySelector('.tab-button.active')?.getAttribute('data-tab'));
        await page.keyboard.press('2');
        const tabAfterDigit = await page.evaluate(() => document.querySelector('.tab-button.active')?.getAttribute('data-tab'));
        expect(tabAfterDigit).toBe(tabBefore);

        await page.keyboard.press('ArrowRight');
        const tabAfterArrow = await page.evaluate(() => document.querySelector('.tab-button.active')?.getAttribute('data-tab'));
        expect(tabAfterArrow).toBe(tabBefore);

        const mod = process.platform === 'darwin' ? 'Meta+Shift+K' : 'Control+Shift+K';
        await page.keyboard.press(mod);
        const searchFocused = await page.evaluate(() => document.activeElement?.id === 'config-settings-search-input');
        expect(searchFocused).toBe(false);

        await page.keyboard.press(process.platform === 'darwin' ? 'Meta+K' : 'Control+K');
        const paletteOpen = await page.evaluate(() => Boolean(document.querySelector('.config-command-palette.show')));
        expect(paletteOpen).toBe(false);
    });

    test('finders tour replaces general tour without duplicate overlays', async ({ page }) => {
        await waitForConfigReady(page);

        const generalResult = await resetAndForceStartTour(page, 'general');
        expect(generalResult?.ok).toBe(true);
        await page.waitForSelector('.config-general-tour-card', { state: 'visible', timeout: 10_000 });

        await page.evaluate(() => {
            window.configManager.ensureFindersTabActive();
        });
        await page.waitForSelector('[data-tab-content="finders"].active', { timeout: 10_000 }).catch(() => {});

        const findersResult = await resetAndForceStartTour(page, 'finders');
        expect(findersResult?.ok).toBe(true);

        await expect.poll(() => page.evaluate(() => document.body.hasAttribute('data-config-finders-tour-active'))).toBe(true);
        await expect.poll(() => page.evaluate(() => document.body.hasAttribute('data-config-general-tour-active'))).toBe(false);
        await expect(page.locator('.config-general-tour-card')).toHaveCount(0);
        await page.waitForSelector('.config-finders-tour-card', { state: 'visible', timeout: 10_000 });

        const activeTours = await tourActiveAttributes(page);
        expect(activeTours).toEqual(['data-config-finders-tour-active']);

        const dimming = await page.evaluate(() => {
            const highlight = document.querySelector('.config-finders-tour-highlight');
            if (!highlight) return null;
            return window.getComputedStyle(highlight).boxShadow;
        });
        expect(dimming).toMatch(/9999px/);
    });

    test('skip tour persists completion before step content and blocks auto-start', async ({ page }) => {
        await waitForConfigReady(page);

        const afterSkip = await page.evaluate(async () => {
            const cm = window.configManager;
            cm.settingsData.configGeneralTourCompleted = false;
            localStorage.removeItem('nextdash:config-general-tour-v1');

            const tour = new ConfigGeneralTour({
                language: cm.language,
                hasSeen: () => cm.hasSeenConfigGeneralTour(),
                onMarkSeen: () => cm.markConfigGeneralTourCompleted(),
            });
            tour._tourShown = false;
            window.ConfigTourRuntime.skipConfigTour(tour);
            await new Promise((r) => setTimeout(r, 400));

            const blocked = await cm.maybeStartConfigGeneralTour();
            return {
                completed: cm.settingsData.configGeneralTourCompleted === true,
                localSeen: localStorage.getItem('nextdash:config-general-tour-v1') === '1',
                autoStartBlocked: blocked?.ok === false && blocked?.reason === 'completed',
            };
        });

        expect(afterSkip.completed).toBe(true);
        expect(afterSkip.localSeen).toBe(true);
        expect(afterSkip.autoStartBlocked).toBe(true);
    });
});
