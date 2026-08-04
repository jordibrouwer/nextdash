// @ts-check
const { test, expect } = require('@playwright/test');
const { dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * A release can be recorded without being announced.
 *
 * The release tag, Config → Overview → Latest update and the What's new modal
 * all read the first entry of the what's-new index, and a Go test ties the tag
 * to it — so a docs-only or maintenance release cannot simply be left out of the
 * index without rolling the other two back to the previous version. The
 * hideFromModal flag keeps the entry in the index, and out of the modal.
 */

async function loadDashboard(page) {
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.allBookmarks?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
}

test.describe('a release flagged hideFromModal', () => {
    test('is still the newest entry in the index', async ({ page }) => {
        await page.goto('/');
        const index = await page.evaluate(async () => {
            const res = await fetch('/static/data/whats-new/index.json');
            return res.json();
        });
        expect(index[0].id).toBe('v2026.08.09.1');
        expect(index[0].hideFromModal).toBe(true);
    });

    test('shows in Config → Overview → Latest update', async ({ page }) => {
        await loadDashboard(page);
        await page.evaluate(() => window.dashboardInstance.config.openConfigView('overview'));
        await page.waitForFunction(() => typeof window.DashboardConfig === 'function', null, { timeout: 10_000 });
        // The panel is the reason the entry stays in the index at all.
        const tag = page.locator('.config-release-tag');
        await expect(tag).toBeVisible({ timeout: 10_000 });
        await expect(tag).toContainText('v2026.08.09.1');
    });

    test('does not appear in the What\'s new modal', async ({ page }) => {
        await loadDashboard(page);
        await page.evaluate(() => window.dashboardInstance.config.openWhatsNew());
        const modal = page.locator('.whats-new-modal');
        await expect(modal).toBeVisible({ timeout: 15_000 });
        await page.waitForTimeout(1200);

        // Compare rendered version tags, not raw text: "v2026.08.09.1" contains
        // "v2026.08.09", so a substring check cannot tell the two apart.
        const tags = await modal.evaluate((m) => [...new Set(
            [...m.querySelectorAll('*')]
                .filter((e) => e.childElementCount === 0)
                .map((e) => e.textContent.trim())
                .filter((t) => /^v2026\.\d/.test(t)),
        )]);
        expect(tags).toContain('v2026.08.09');
        expect(tags).not.toContain('v2026.08.09.1');
    });

    test('does not raise the unread badge', async ({ page }) => {
        // DASHBOARD_RELEASE is what marks a release unread, and a maintenance
        // release deliberately leaves it alone — otherwise every user would get
        // a star for a changelog entry.
        const stub = await page.request.get('/static/js/whats-new-stub.js');
        const src = await stub.text();
        expect(src).toContain("DASHBOARD_RELEASE = '2026.07-dashboard-release-v167'");
        // The data version must still move, or the new JSON is served from cache.
        expect(src).toContain("NEXTDASH_WHATS_NEW_DATA_VERSION = 'whats-new-v226'");
    });
});
