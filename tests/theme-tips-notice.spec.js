// @ts-check
const { test, expect } = require('./fixtures');
const { dismissOnboardingIfPresent, dismissBlockingOverlays, markWhatsNewSeen, WRITE_TOKEN } = require('./e2e-helpers');

/**
 * The three tips in the bell about the themes that react to something: Skywatch (the weather),
 * Tidewatch (the health of your services) and Daydrift (the time of day). One a day, counted
 * from the first run of the release, upgraded installs only, and not for a theme already worn.
 */
const DAY = 24 * 60 * 60 * 1000;
const IDS = { sky: 'theme-tip-skywatch', tide: 'theme-tip-tidewatch', drift: 'theme-tip-daydrift' };

async function load(page, { from = 'now', fresh = false, theme = 'aurora-glass-dark' } = {}) {
    // Pressing Use this theme or Open in the theme studio reads the tip, and the server keeps that:
    // the next test would find no row. The three records are put back to empty, as the server takes
    // a record that is sent per id as the truth.
    await page.request.post('/api/settings', {
        data: { discoverabilityState: { bell: { 'theme-tip-skywatch': {}, 'theme-tip-tidewatch': {}, 'theme-tip-daydrift': {} } } },
        headers: { 'X-NextDash-Token': WRITE_TOKEN },
    });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.evaluate(({ from, fresh, theme, day }) => {
        // Marks written by these tests must not reach the ./data the dev server shares.
        window.DiscoverabilityState.schedulePersist = () => {};
        for (const id of ['theme-tip-skywatch', 'theme-tip-tidewatch', 'theme-tip-daydrift']) {
            window.DiscoverabilityState.resetBellNo?.(id, { persist: false });
        }
        Object.assign(window.dashboardInstance.settings, { firstRunInstall: fresh, theme });
        window.DiscoverabilityState.noteThemeTipsFrom(from === 'unset' ? 0 : Date.now() - from * day, { persist: false });
    }, { from: from === 'now' ? 0 : from, fresh, theme, day: DAY });
    if (from === 'unset') await page.evaluate(() => window.DiscoverabilityState.noteThemeTipsFrom(0, { persist: false }));
}

const row = (page, id) => page.locator(`.notification-bell-row[data-bell-id="${id}"]`);

async function openBell(page) {
    await page.evaluate(() => window.NotificationBell.refreshAll());
    await page.evaluate(() => window.NotificationBell.open());
}

test.describe('the theme tips in the bell', () => {
    test('on the first day only Skywatch is there, and it says what the theme follows', async ({ page }) => {
        await load(page, { from: 0.1 });
        await openBell(page);
        await expect(row(page, IDS.sky)).toBeVisible();
        await expect(row(page, IDS.sky)).toContainText('weather');
        await expect(row(page, IDS.tide)).toHaveCount(0);
        await expect(row(page, IDS.drift)).toHaveCount(0);
        await expect(page.locator('.notification-bell-group[data-bell-group="tips"]')).toBeVisible();
    });

    test('Tidewatch comes on the second day and Daydrift on the third', async ({ page }) => {
        await load(page, { from: 1.1 });
        await openBell(page);
        await expect(row(page, IDS.sky)).toBeVisible();
        await expect(row(page, IDS.tide)).toContainText('health');
        await expect(row(page, IDS.drift)).toHaveCount(0);
        await page.evaluate(() => window.DiscoverabilityState.noteThemeTipsFrom(Date.now() - 2.1 * 24 * 60 * 60 * 1000, { persist: false }));
        await openBell(page);
        await expect(row(page, IDS.drift)).toContainText('time');
    });

    test('the first visit writes the day the count starts from, once', async ({ page }) => {
        await load(page, { from: 'unset' });
        expect(await page.evaluate(() => window.DiscoverabilityState.getThemeTipsFrom())).toBe(0);
        await openBell(page);
        const first = await page.evaluate(() => window.DiscoverabilityState.getThemeTipsFrom());
        expect(first).toBeGreaterThan(0);
        await openBell(page);
        expect(await page.evaluate(() => window.DiscoverabilityState.getThemeTipsFrom())).toBe(first);
        await expect(row(page, IDS.sky)).toBeVisible();
    });

    test('a fresh install is not told, and writes no start day', async ({ page }) => {
        await load(page, { from: 'unset', fresh: true });
        await openBell(page);
        await expect(page.locator('.notification-bell-row[data-bell-id^="theme-tip-"]')).toHaveCount(0);
        expect(await page.evaluate(() => window.DiscoverabilityState.getThemeTipsFrom())).toBe(0);
    });

    test('a theme already worn, in either half, has no tip', async ({ page }) => {
        await load(page, { from: 3, theme: 'living-tidewatch-light' });
        await openBell(page);
        await expect(row(page, IDS.sky)).toBeVisible();
        await expect(row(page, IDS.drift)).toBeVisible();
        await expect(row(page, IDS.tide)).toHaveCount(0);
    });

    test('Use this theme puts the theme on, in the half in use, and reads the row', async ({ page }) => {
        await load(page, { from: 0.1, theme: 'aurora-glass-light' });
        await openBell(page);
        await row(page, IDS.sky).getByRole('button', { name: 'Use this theme' }).click();
        await expect.poll(() => page.evaluate(() => window.dashboardInstance.settings.theme)).toBe('living-skywatch-light');
        await page.evaluate(() => window.NotificationBell.refreshAll());
        await expect(row(page, IDS.sky)).toHaveCount(0);
    });

    test('Open in the theme studio opens it on that family', async ({ page }) => {
        await load(page, { from: 0.1 });
        await openBell(page);
        await row(page, IDS.sky).getByRole('button', { name: 'Open in the theme studio' }).click();
        await expect(page.locator('.theme-browser input[type="search"], .theme-browser-search').first()).toHaveValue(/skywatch/i, { timeout: 20_000 });
    });
});
