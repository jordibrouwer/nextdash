// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * Two callers that kept an escaper of their own now use the shared one.
 *
 * The analytics notice asked the dashboard for its escaper and, when there was
 * none, fell back to String() -- which escapes nothing. The stat tile checked
 * for a window.escapeHtml that nothing defines, so it always ran its private
 * copy. Both go through window.NextDashHtml now; what these hold is that markup
 * in a value still arrives as text.
 */

const MARKUP = '<b class="escape-probe">bold</b>';

async function openDashboard(page) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
}

test('the analytics detail shows markup in a translation as text', async ({ page }) => {
    await openDashboard(page);
    await page.waitForFunction(() => window.DashboardAnalyticsNotice && window.AppModal
        && window.dashboardInstance?.language?.translations, null, { timeout: 20_000 });
    await page.evaluate((markup) => {
        const lang = window.dashboardInstance.language;
        lang.translations.dashboard = { ...(lang.translations.dashboard || {}), analyticsNoticeWhyTitle: markup };
        window.DashboardAnalyticsNotice.openDetails();
    }, MARKUP);

    const heading = page.locator('.analytics-notice-heading').first();
    await expect(heading).toHaveText(MARKUP);
    await expect(page.locator('.analytics-notice-modal-body .escape-probe')).toHaveCount(0);
});

test('a stat tile drawn as markup escapes its label and value', async ({ page }) => {
    await openDashboard(page);
    const html = await page.evaluate((markup) => window.StatTile.html({ label: markup, value: `"'${markup}` }), MARKUP);
    expect(html).not.toContain('<b ');
    expect(html).toContain('&lt;b class=&quot;escape-probe&quot;&gt;');
    expect(html).toContain('&quot;&#39;&lt;b');
});
