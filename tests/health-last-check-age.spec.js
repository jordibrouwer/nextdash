// @ts-check
const { test, expect } = require('./fixtures');
const { dismissOnboardingIfPresent, dismissBlockingOverlays, markWhatsNewSeen } = require('./e2e-helpers');

/**
 * The health rail's age row says when links were last checked. It used to read
 * the report's build time, which is "just now" on every request however old the
 * checks themselves were.
 */
test('the age row counts from the newest check, not from when the report was built', async ({ page }) => {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.evaluate(() => window.dashboardInstance.health?.openHealthView?.());
    await page.waitForFunction(() => window.dashboardInstance.health?.instance, null, { timeout: 15_000 });

    const rows = await page.evaluate(() => {
        const h = window.dashboardInstance.health.instance;
        const day = 86400000;
        const read = (summary) => {
            h.report = { generatedAt: Date.now(), summary: { totalBookmarks: 3, ...summary }, issues: [] };
            const row = h.shellSummary().find((r) => r.key === 'age');
            return row ? { label: row.label, value: row.value } : null;
        };
        return { old: read({ lastCheckedAt: Date.now() - 10 * day }), never: read({ lastCheckedAt: 0 }) };
    });

    expect(rows.old.label).toBe('Last check');
    expect(rows.old.value).toMatch(/^10d/);
    expect(rows.never).toBeNull();
});
