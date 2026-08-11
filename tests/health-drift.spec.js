// @ts-check
const { test, expect } = require('@playwright/test');
const { prepareDashboardInteraction } = require('./e2e-helpers');

/**
 * Rot signals: a bookmark that quietly stopped pointing where it was saved,
 * even while it still answers 200. Watching is opt-in per monitored bookmark,
 * set from the same row popover as the keyword and status expectations.
 */
function issue(overrides = {}) {
    return {
        pageId: 1, index: 0, pageName: 'dev', category: 'tools',
        status: 'ok', score: 90, duplicateCount: 0,
        lastChecked: 1752000000000, reasons: [], reasonDetails: [],
        ...overrides,
    };
}

function reportWith(issueOverrides) {
    return {
        generatedAt: Date.now(),
        summary: { totalBookmarks: 1, healthyCount: 1, brokenCount: 0, duplicateCount: 0, uncheckedCount: 0 },
        issues: [issue({ index: 0, name: 'Drift probe', url: 'https://example.com/drift-probe', monitor: true, ...issueOverrides })],
        duplicateGroups: [],
    };
}

async function openHealthView(page, issueOverrides = {}) {
    await page.route('**/api/bookmark-health**', (route) =>
        route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(reportWith(issueOverrides)) }));
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await prepareDashboardInteraction(page);
    await page.click('.health-link a.health-link-anchor');
    await page.waitForSelector('#dashboard-layout.health-layout', { timeout: 15_000 });
    await page.waitForFunction(() => {
        const h = window.dashboardInstance?.healthView || window.dashboardInstance?.health;
        return h?.report?.issues?.length === 1;
    }, null, { timeout: 15_000 });
    await page.click('[data-health-filter="all"]');
    await page.waitForSelector('.health-view-item', { timeout: 15_000 });
}

test.describe('drift watching', () => {
    test('the checkbox saves through the same endpoint as the keyword expectation', async ({ page }) => {
        let posted = null;
        await openHealthView(page);
        await page.route('**/api/health/expectations', async (route) => {
            posted = route.request().postDataJSON();
            await route.fulfill({ status: 200, contentType: 'application/json',
                body: JSON.stringify({ status: 'success', watchDrift: posted.watchDrift }) });
        });

        await page.locator('.health-check-mode').click();
        const checkbox = page.locator('[data-watch-drift]');
        await expect(checkbox).toBeVisible();
        await expect(checkbox).not.toBeChecked();

        await checkbox.check();
        await page.locator('[data-expect-save]').click();

        await expect.poll(() => posted?.watchDrift).toBe(true);
        // Sent alongside the keyword/status fields, not through a separate
        // endpoint — this is the fourth "what counts as healthy" question the
        // same request already answers.
        expect(posted).toMatchObject({ url: 'https://example.com/drift-probe', expectText: '', expectStatus: '' });
    });

    test('a finding shows a badge naming the reason', async ({ page }) => {
        await openHealthView(page, {
            watchDrift: true, driftNoticed: 'host', driftReason: 'Now redirects to evil.example',
        });
        const badge = page.locator('.health-drift-badge');
        await expect(badge).toHaveText('Moved');
        await expect(badge).toHaveAttribute('title', 'Now redirects to evil.example');
    });

    test('no badge without a finding, even while watching', async ({ page }) => {
        await openHealthView(page, { watchDrift: true, driftNoticed: '' });
        await expect(page.locator('.health-drift-badge')).toHaveCount(0);
    });

    test('a title finding is badged distinctly from a moved one', async ({ page }) => {
        await openHealthView(page, {
            watchDrift: true, driftNoticed: 'title-parked', driftReason: 'Page title now reads "Domain for sale"',
        });
        await expect(page.locator('.health-drift-badge')).toHaveText('Retitled');
    });
});
