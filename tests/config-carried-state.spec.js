// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * State config carried where it could not be seen or undone: a filter into a
 * section without a filter bar, focus thrown away by a tip step, and a
 * bookmark counted as missing an icon that it shows.
 */

async function openConfig(page) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => !!window.dashboardInstance?.config, null, { timeout: 20_000 });
}

test('Only changed does not follow into a section without its bar', async ({ page }) => {
    await openConfig(page);
    const state = await page.evaluate(async () => {
        const cfg = window.dashboardInstance.config;
        await cfg.openConfigView('behavior');
        cfg.changedOnly = true;
        cfg.settingsFilter = 'webhook';
        cfg.selectSection('containers');
        return { changedOnly: cfg.changedOnly, filter: cfg.settingsFilter };
    });
    expect(state).toEqual({ changedOnly: false, filter: '' });
});

test('the next tip keeps the keyboard on its button', async ({ page }) => {
    await openConfig(page);
    await page.evaluate(async () => { await window.dashboardInstance.config.openConfigView('overview'); });
    const next = page.locator('#config-view-body .config-widget--tip [data-overview-action="tip-next"]');
    await expect(next).toBeVisible();
    await next.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#config-view-body .config-widget--tip [data-overview-action="tip-next"]')).toBeFocused();
});

test('a chosen letter is not an icon that is missing', async ({ page }) => {
    await openConfig(page);
    const missing = await page.evaluate(() => {
        return window.BookmarkPredicates.match('noicon', { url: 'https://x.example', icon: '', iconMode: 'letter' });
    });
    expect(missing).toBe(false);
});
