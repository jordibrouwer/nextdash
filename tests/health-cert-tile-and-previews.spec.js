// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * Two tiles that promised something the view could not deliver.
 *
 * Certificates counted hosts rather than bookmarks, so it was drawn with no
 * key: a tile identical to the six beside it that did nothing when clicked.
 * The rows are reachable after all — certFor() already maps a row to its host's
 * certificate to draw the badge — so the tile is a filter and the count above
 * still reads in hosts.
 *
 * Missing preview was the opposite: a filter whose rows the toolbar could not
 * act on. Re-check and Retest all run the availability check, which never asks
 * a page for its title or image, so the number could not move however often
 * they were pressed. The route that fetches previews lives in Config → Data &
 * backups; the button offers it where the question is asked.
 */

const REPORT = {
    generatedAt: Date.now(),
    summary: { total: 3, healthyCount: 1, brokenCount: 0, missingPreviewCount: 2 },
    certificates: { 'expiring.example.com': { expiresAt: Date.now() + 5 * 86400000, issuer: 'Test CA' } },
    issues: [
        {
            pageId: 1, index: 0, name: 'On the expiring host', url: 'https://expiring.example.com/a',
            certHost: 'expiring.example.com', status: 'healthy', flags: ['healthy'], score: 100,
            lastChecked: Date.now(),
        },
        {
            pageId: 1, index: 1, name: 'No preview one', url: 'https://a.example.com/',
            status: 'missing-preview', flags: ['missing-preview'], score: 95, lastChecked: Date.now(),
        },
        {
            pageId: 1, index: 2, name: 'No preview two', url: 'https://b.example.com/',
            status: 'missing-preview', flags: ['missing-preview'], score: 95, lastChecked: Date.now(),
        },
    ],
};

async function openHealth(page) {
    await page.route('**/api/bookmark-health**', (route) => route.fulfill({
        status: 200, contentType: 'application/json', body: JSON.stringify(REPORT),
    }));
    await markWhatsNewSeen(page);
    await page.goto('/#health');
    await page.waitForSelector('.health-view-tiles', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
}

test.describe('the certificates tile', () => {
    test('is a button, and filters to the bookmarks on that host', async ({ page }) => {
        await openHealth(page);

        const tile = page.locator('.health-view-tile', { hasText: 'Certificates' }).first();
        // A static span was the bug: it looked exactly like the tiles that filter.
        await expect(tile).toHaveAttribute('data-health-tile', 'certificates');

        await tile.click();
        await expect.poll(() => page.evaluate(() => window.dashboardInstance.health.filter)).toBe('certificates');
        // The count is hosts; the list is the bookmarks on them.
        await expect(page.locator('.health-view-item-title')).toHaveText(['On the expiring host']);
        await expect(page.locator('.health-view-filter-note')).toContainText(/certificate expires soon/i);
    });
});

/*
 * The three buttons that appear on one filter only had no CSS rule at all, so
 * each rendered as the browser's default grey button -- square, 2px outset --
 * in a row of soft-cornered ones. Nobody saw it because they are on screen only
 * while their own filter is, which is also why a visibility check would not
 * have caught it: the button was there, it just did not look like a button of
 * this toolbar.
 */
test.describe('the filter-specific buttons', () => {
    test('look like the toolbar buttons beside them', async ({ page }) => {
        await openHealth(page);

        const shapeOf = (selector) => page.evaluate((sel) => {
            const el = document.querySelector(sel);
            if (!el) return null;
            const c = getComputedStyle(el);
            return [c.paddingTop, c.paddingLeft, c.borderTopWidth, c.borderTopStyle,
                c.borderTopLeftRadius, c.fontSize].join('|');
        }, selector);

        // Rot report is a plain member of the secondary set; it is the yardstick.
        const reference = await shapeOf('.health-view-rot-btn');
        expect(reference).not.toBeNull();

        await page.click('[data-health-filter="missing-preview"]');
        await expect(page.locator('.health-view-fetch-previews-btn')).toBeVisible();
        expect(await shapeOf('.health-view-fetch-previews-btn')).toBe(reference);
    });
});

test.describe('the missing-preview filter', () => {
    test('offers the one action that can empty it', async ({ page }) => {
        let refreshCalls = 0;
        await page.route('**/api/previews/refresh', (route) => {
            refreshCalls += 1;
            return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
        });
        await openHealth(page);

        // Not on every filter: it is an answer to this question only.
        await page.click('[data-health-filter="healthy"]');
        await expect(page.locator('.health-view-fetch-previews-btn')).toHaveCount(0);

        await page.click('[data-health-filter="missing-preview"]');
        const button = page.locator('.health-view-fetch-previews-btn');
        await expect(button).toBeVisible();

        await button.click();
        // It says what it is about to do -- one request per bookmark is slow.
        const modal = page.locator('#app-modal.show');
        await expect(modal).toBeVisible();
        await expect(modal).toContainText(/one request per bookmark/i);

        await page.getByRole('button', { name: 'Fetch previews', exact: true }).last().click();
        await expect.poll(() => refreshCalls, { timeout: 10_000 }).toBe(1);
    });
});
