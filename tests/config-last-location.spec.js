const { test, expect } = require('@playwright/test');
const { prepareDashboardInteraction } = require('./e2e-helpers');

/**
 * Config returns you to where you were, for fifteen minutes.
 *
 * It used to remember only when you left via Shift+H or Shift+I, and clear the
 * memory on every other exit — so the common route, Escape out and Shift+S back
 * in, always landed on Overview. Now every exit remembers, which is only safe
 * because the entry expires: without that, a tab opened once weeks ago would
 * greet you forever.
 */

const KEY = 'nextdash:config-last-location-v1';

async function load(page) {
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await prepareDashboardInteraction(page);
    await page.evaluate((k) => localStorage.removeItem(k), KEY);
}

const section = (page) => page.evaluate(() => window.dashboardInstance.config.section);

const stored = (page) => page.evaluate((k) => {
    const raw = localStorage.getItem(k);
    return raw ? JSON.parse(raw) : null;
}, KEY);

/**
 * Open config with no explicit target, the way Shift+S does.
 *
 * `config.section` is reset first: closing the view leaves the last section in
 * memory, so asserting that it came back as `behavior` would pass on the stale
 * value whether or not anything was restored.
 */
async function openConfigBare(page) {
    await page.evaluate(() => {
        window.location.hash = '';
        window.dashboardInstance.config.section = 'overview';
        window.dashboardInstance.config.behaviorTab = 'general';
        return window.dashboardInstance.config.openConfigView();
    });
    await page.waitForSelector('#config-view-body', { timeout: 15_000 });
}

async function goToBehaviorPrivacy(page) {
    await page.evaluate(async () => {
        const c = window.dashboardInstance.config;
        await c.openConfigView('behavior');
        c.behaviorTab = 'privacy';
        c.render();
    });
    await page.waitForTimeout(200);
}

test.describe('config remembers where you were', () => {
    test('leaving by any route stores the section and sub-tab', async ({ page }) => {
        await load(page);
        await goToBehaviorPrivacy(page);

        // Escape, which used to be the exit that deliberately forgot.
        await page.evaluate(() => window.dashboardInstance.config.closeConfigView());
        await page.waitForTimeout(200);

        const saved = await stored(page);
        expect(saved).toMatchObject({ section: 'behavior', subTab: 'privacy' });
        expect(saved.savedAt).toBeGreaterThan(0);
    });

    test('reopening lands back on it, from the grid', async ({ page }) => {
        await load(page);
        await goToBehaviorPrivacy(page);
        await page.evaluate(() => window.dashboardInstance.config.closeConfigView());
        await page.waitForTimeout(200);
        expect(await page.evaluate(() => window.dashboardInstance.activeView)).not.toBe('config');

        await openConfigBare(page);
        expect(await section(page)).toBe('behavior');
        expect(await page.evaluate(() => window.dashboardInstance.config.behaviorTab)).toBe('privacy');
    });

    test('an entry older than fifteen minutes is ignored', async ({ page }) => {
        await load(page);
        await goToBehaviorPrivacy(page);
        await page.evaluate(() => window.dashboardInstance.config.closeConfigView());
        await page.waitForTimeout(200);

        // Age it past the window rather than waiting out the clock.
        await page.evaluate((k) => {
            const data = JSON.parse(localStorage.getItem(k));
            data.savedAt = Date.now() - (15 * 60 * 1000 + 1000);
            localStorage.setItem(k, JSON.stringify(data));
        }, KEY);

        await openConfigBare(page);
        expect(await section(page)).toBe('overview');
    });

    test('just inside the window still counts', async ({ page }) => {
        await load(page);
        await goToBehaviorPrivacy(page);
        await page.evaluate(() => window.dashboardInstance.config.closeConfigView());
        await page.waitForTimeout(200);

        await page.evaluate((k) => {
            const data = JSON.parse(localStorage.getItem(k));
            data.savedAt = Date.now() - (14 * 60 * 1000);
            localStorage.setItem(k, JSON.stringify(data));
        }, KEY);

        await openConfigBare(page);
        expect(await section(page)).toBe('behavior');
    });

    // Written before the location expired at all, so its age is unknowable.
    test('an entry with no timestamp is treated as stale', async ({ page }) => {
        await load(page);
        await page.evaluate((k) => localStorage.setItem(k, JSON.stringify({
            section: 'behavior', subTab: 'privacy',
        })), KEY);

        await openConfigBare(page);
        expect(await section(page)).toBe('overview');
    });

    test('an explicit section and a config hash both still win', async ({ page }) => {
        await load(page);
        await goToBehaviorPrivacy(page);
        await page.evaluate(() => window.dashboardInstance.config.closeConfigView());
        await page.waitForTimeout(200);

        await page.evaluate(() => window.dashboardInstance.config.openConfigView('help'));
        await page.waitForTimeout(200);
        expect(await section(page)).toBe('help');

        await page.evaluate(() => window.dashboardInstance.config.closeConfigView());
        await page.waitForTimeout(200);
        await page.evaluate(() => {
            window.location.hash = '#config/appearance';
            return window.dashboardInstance.config.openConfigView();
        });
        await page.waitForTimeout(300);
        expect(await section(page)).toBe('appearance');
    });

    test('a page-tab exit remembers too', async ({ page }) => {
        await load(page);
        await goToBehaviorPrivacy(page);

        // The 1–9 route out of config, which also used to forget deliberately.
        await page.evaluate(() => {
            const e = new KeyboardEvent('keydown', { key: '1', bubbles: true });
            window.dashboardInstance.config.handleShellViewShortcut(e);
        });
        await page.waitForTimeout(400);

        expect(await stored(page)).toMatchObject({ section: 'behavior', subTab: 'privacy' });
    });
});
