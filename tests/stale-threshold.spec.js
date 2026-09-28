// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * "Stale" is the reader's own "count as neglected after" setting everywhere:
 * the server's reason carries the number, and the bookmark Usage tab counts
 * down to it rather than to a fixed thirty days.
 */

async function ready(page) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });
}

test('the stale reason names the threshold it was counted against', async ({ page }) => {
    await ready(page);
    const text = await page.evaluate(async () => {
        await window.LazyScript.loadScriptOnce('js/health-reason-utils.js', 'dashboardHealthReason',
            () => typeof window.HealthReasonUtils !== 'undefined');
        return window.HealthReasonUtils.translateReasonDetail(null,
            { code: 'not_opened_30_days', params: { days: '7' } });
    });
    expect(text).toBe('Not opened in over 7 days');
});

test('the usage tab counts down to the setting, not to thirty days', async ({ page }) => {
    await ready(page);
    const text = await page.evaluate(async () => {
        const d = window.dashboardInstance;
        await d.config.ensureBookmarkRenderers();
        const before = d.settings.bookmarkStaleDays;
        d.settings.bookmarkStaleDays = 7;
        const html = d.config.renderBmUsageStaleHint({ lastOpened: Date.now() - 3 * 86400000 });
        d.settings.bookmarkStaleDays = before;
        return html;
    });
    expect(text).toContain('Counts as stale in 4 days');
});
