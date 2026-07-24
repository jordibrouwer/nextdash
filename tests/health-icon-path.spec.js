// @ts-check
const { test, expect } = require('@playwright/test');
const { prepareDashboardInteraction } = require('./e2e-helpers');

/**
 * Health-view bookmark icons must resolve to /data/icons/<file> exactly like the
 * dashboard rows do. Rendering the bare stored filename as the <img src> makes the
 * browser request it from the site root, producing confusing "Failed to load
 * resource: 404" errors in the console even though nothing is actually wrong.
 */

// A 1x1 transparent PNG, so a routed icon request resolves successfully.
const PNG_1x1 = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64',
);

function report(icon) {
    return {
        generatedAt: Date.now(),
        summary: { totalBookmarks: 1, healthyCount: 0, brokenCount: 1, duplicateCount: 0, uncheckedCount: 0 },
        issues: [
            {
                pageId: 1, index: 0, pageName: 'dev', name: 'Broken one',
                url: 'https://example.com/broken', category: 'tools',
                status: 'broken', score: 25, duplicateCount: 0,
                lastChecked: 1752000000000,
                icon,
                reasons: ['HTTP 500'],
                reasonDetails: [{ code: 'last_error', detail: 'HTTP 500', penalty: 60 }],
            },
        ],
        duplicateGroups: [],
    };
}

async function openHealthView(page, icon) {
    await page.route('**/api/bookmark-health**', async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(report(icon)),
        });
    });
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await prepareDashboardInteraction(page);
    await page.click('.health-link a.health-link-anchor');
    await page.waitForSelector('#dashboard-layout.health-layout .health-view-item', { timeout: 15_000 });
}

test.describe('health view icons', () => {
    test('resolves a bare filename to /data/icons/ and does not 404', async ({ page }) => {
        const iconRequests = [];
        const failures = [];
        // Serve any /data/icons/ request so the resolved path loads cleanly.
        await page.route('**/data/icons/**', async (route) => {
            iconRequests.push(new URL(route.request().url()).pathname);
            await route.fulfill({ status: 200, contentType: 'image/png', body: PNG_1x1 });
        });
        page.on('requestfailed', (req) => { if (req.resourceType() === 'image') failures.push(req.url()); });
        page.on('response', (res) => { if (res.status() === 404) failures.push(res.url()); });

        await openHealthView(page, 'icon-8cf59ef5c5c8d226.jpg');

        const img = page.locator('.health-view-item-icon-img').first();
        await expect(img).toHaveAttribute('src', '/data/icons/icon-8cf59ef5c5c8d226.jpg');
        await img.evaluate((el) => el.complete || new Promise((r) => el.addEventListener('load', r, { once: true })));

        expect(iconRequests).toContain('/data/icons/icon-8cf59ef5c5c8d226.jpg');
        expect(failures).toEqual([]);
    });

    test('leaves an absolute icon URL untouched', async ({ page }) => {
        await openHealthView(page, 'https://cdn.example.com/logo.png');
        const img = page.locator('.health-view-item-icon-img').first();
        await expect(img).toHaveAttribute('src', 'https://cdn.example.com/logo.png');
    });

    test('falls back to the link glyph when the icon file is missing', async ({ page }) => {
        // The file genuinely does not exist: reply 404 for any icon fetch.
        await page.route('**/data/icons/**', (route) => route.fulfill({ status: 404, body: '' }));

        await openHealthView(page, 'gone.png');

        const slot = page.locator('.health-view-item-icon').first();
        await expect(slot.locator('img')).toHaveCount(0);
        await expect(slot).toContainText('🔗');
    });
});
