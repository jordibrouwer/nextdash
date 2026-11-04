// @ts-check
const { test, expect } = require('./fixtures');
const { dismissOnboardingIfPresent, dismissBlockingOverlays, markWhatsNewSeen } = require('./e2e-helpers');

/**
 * The urgent sources and the outage row in the bell: a newer release, and
 * monitored bookmarks that are down. Both are driven through the real paths
 * (the update-status request, the health-facts request and the tab badge
 * refresh), not by setting state by hand.
 */

const UPDATE_ROW = '.notification-bell-row[data-bell-id="update-notice"]';
const HEALTH_ROW = '.notification-bell-row[data-bell-id="health-outage"]';

let latest = 'v9.9.9';
let newer = false;
let down = 1;

async function load(page) {
    latest = 'v9.9.9';
    newer = false;
    down = 1;
    await page.route('**/api/update-status*', (route) => route.fulfill({ json: {
        enabled: true, current: 'v1.0.0', latest, updateAvailable: newer,
        releaseUrl: `https://github.com/jordibrouwer/nextdash/releases/tag/${latest}`,
    } }));
    await page.route('**/api/bookmark-health?view=facts*', (route) => route.fulfill({ json: {
        generatedAt: Date.now(),
        summary: { monitorDownCount: down, brokenCount: 0 },
        rows: Array.from({ length: down }, (_, i) => ({ url: `https://down-${i}.example.test/`, monitor: true, downSince: Date.now() - 60_000, lastError: 'timeout' })),
    } }));
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0 && window.NotificationBell && window.HealthBellSource, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.evaluate(() => {
        // A "No" said in a test must not reach the shared ./data.
        window.DiscoverabilityState.schedulePersist = () => {};
        // Put the real Task 5 rows away, so the grey count is only about this spec.
        ['tag-suggestions-notice', 'health-review-notice', 'health-recheck-offer', 'kept-pile',
            'install-count-notice', 'analytics-notice']
            .forEach((id) => window.DiscoverabilityState.markBellNo(id, { count: 1, ids: [], forever: true }, { persist: false }));
    });
}

const counts = (page) => page.evaluate(() => window.NotificationBell.counts());
const refreshUpdate = (page) => page.evaluate(() => window.nextdashRefreshUpdateStatus(true));
const refreshBadge = (page) => page.evaluate(() => window.dashboardInstance.updateHealthBadge());
async function openBell(page) {
    await page.evaluate(() => window.NotificationBell.open());
}

test.describe('urgent sources in the bell', () => {
    test('a newer release is a red row with the version, and No holds until a newer one', async ({ page }) => {
        await load(page);
        const before = (await counts(page)).red;
        newer = true;
        await refreshUpdate(page);
        await expect.poll(async () => (await counts(page)).red).toBe(before + 1);
        await openBell(page);
        const row = page.locator(UPDATE_ROW);
        await expect(row).toBeVisible();
        await expect(row).toContainText('v9.9.9');
        await expect(row.getByRole('button', { name: "What's new" })).toBeVisible();

        await row.getByRole('button', { name: 'No', exact: true }).click();
        await expect(row).toHaveCount(0);
        await expect.poll(async () => (await counts(page)).red).toBe(before);

        // The same release, asked again: still answered.
        await refreshUpdate(page);
        await expect(page.locator(UPDATE_ROW)).toHaveCount(0);

        latest = 'v9.9.10';
        await refreshUpdate(page);
        await expect(page.locator(UPDATE_ROW)).toBeVisible();
        await expect(page.locator(UPDATE_ROW)).toContainText('v9.9.10');
        await expect.poll(async () => (await counts(page)).red).toBe(before + 1);
    });

    test('a dismissed release leaves the bell', async ({ page }) => {
        await load(page);
        newer = true;
        await refreshUpdate(page);
        await openBell(page);
        await expect(page.locator(UPDATE_ROW)).toBeVisible();
        await page.evaluate(() => window.nextdashDismissUpdateNotice('v9.9.9'));
        await expect(page.locator(UPDATE_ROW)).toHaveCount(0);
        await page.evaluate(() => localStorage.removeItem('nextdash:dismissed-update-tag'));
    });
});

test.describe('outages in the bell', () => {
    test('a down bookmark is a health row, not a red number, and the tab keeps its badge', async ({ page }) => {
        await load(page);
        const before = await counts(page);
        await refreshBadge(page);
        await openBell(page);
        const row = page.locator(HEALTH_ROW);
        await expect(row).toBeVisible();
        await expect(row).toContainText('1 monitored bookmarks not responding');
        await expect(row.locator('.notification-bell-row-icon')).toHaveText('\u{1F534}');
        expect(await counts(page)).toEqual(before);
        await expect(page.locator('.library-link a .health-badge')).toHaveText('1');
        await expect(row.getByRole('button', { name: 'View' })).toBeVisible();
    });

    test('the row follows the tab badge and No holds until another goes down', async ({ page }) => {
        await load(page);
        await refreshBadge(page);
        await openBell(page);
        const row = page.locator(HEALTH_ROW);
        await row.getByRole('button', { name: 'No', exact: true }).click();
        await expect(row).toHaveCount(0);

        down = 2;
        await refreshBadge(page);
        await expect(row).toBeVisible();
        await expect(page.locator('.library-link a .health-badge')).toHaveText('2');

        down = 0;
        await refreshBadge(page);
        await expect(row).toHaveCount(0);
    });

    test('View opens the Bookmarks view on the monitored filter', async ({ page }) => {
        await load(page);
        await refreshBadge(page);
        await openBell(page);
        await page.locator(HEALTH_ROW).getByRole('button', { name: 'View' }).click();
        await expect.poll(() => page.evaluate(() => window.dashboardInstance.activeView)).toBe('library');
        expect(await page.evaluate(() => window.location.hash)).toContain('health=monitored');
    });
});
