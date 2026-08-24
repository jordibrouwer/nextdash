// @ts-check
const { test, expect } = require('./fixtures');
const { prepareDashboardInteraction } = require('./e2e-helpers');

/**
 * "Last opened" on a health row, and the recording behind it.
 *
 * The report is mocked so the timestamps are exact rather than whatever the
 * seeded bookmarks happen to carry.
 */
function report(now = Date.now()) {
    const mk = (i, name, lastOpened) => ({
        pageId: 1, index: i, pageName: 'dev', name, url: `https://example.com/${i}`,
        category: 'tools', status: 'broken', score: 40, duplicateCount: 0,
        lastChecked: now - 3600e3, reasons: ['HTTP 500'],
        reasonDetails: [{ code: 'last_error', detail: 'HTTP 500', penalty: 60 }],
        ...(lastOpened === null ? {} : { lastOpened, openCount: 3 }),
    });
    return {
        generatedAt: now,
        summary: { totalBookmarks: 5, healthyCount: 0, brokenCount: 5, duplicateCount: 0, uncheckedCount: 0 },
        issues: [
            mk(0, 'Never', null),
            mk(1, 'Seconds', now - 20e3),
            mk(2, 'Hours', now - 4 * 3600e3),
            mk(3, 'Last week', now - 9 * 86400e3),
            mk(4, 'Last year', now - 400 * 86400e3),
        ],
    };
}

async function openHealth(page) {
    // window.open is stubbed before load: a real popup is blocked in the harness
    // and the Open click would hang waiting for a tab that never appears.
    await page.addInitScript(() => {
        window.__opened = [];
        window.open = (url) => { window.__opened.push(url); return null; };
    });
    await page.route('**/api/bookmark-health**', (route) =>
        route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(report()) }));
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await prepareDashboardInteraction(page);
    await page.click('.health-link a.health-link-anchor');
    await page.waitForSelector('#dashboard-layout.health-layout .health-view-item', { timeout: 15_000 });
}

/** The label on the row whose title matches. */
async function labelFor(page, name) {
    return page.evaluate((wanted) => {
        const row = [...document.querySelectorAll('.health-view-item')]
            .find((r) => r.querySelector('.health-view-item-title')?.textContent.trim() === wanted);
        const el = row?.querySelector('[data-health-opened]');
        return el ? { label: el.textContent.trim(), never: el.classList.contains('is-never'), title: el.getAttribute('title') } : null;
    }, name);
}

test.describe('health view — last opened', () => {
    test('every row says when it was last opened', async ({ page }) => {
        await openHealth(page);

        // Always present, so the meta line keeps one shape across rows.
        const count = await page.locator('.health-view-item [data-health-opened]').count();
        expect(count).toBe(await page.locator('.health-view-item').count());

        expect((await labelFor(page, 'Seconds')).label).toBe('just opened');
        expect((await labelFor(page, 'Hours')).label).toBe('4h ago');
        // Past a week the label becomes a date rather than a day count.
        expect((await labelFor(page, 'Last week')).label).toMatch(/\d/);
        expect((await labelFor(page, 'Last week')).label).not.toMatch(/ago/);
        // Past a year it carries the year.
        expect((await labelFor(page, 'Last year')).label).toMatch(/\d{4}/);
    });

    test('never-opened is called out rather than left blank', async ({ page }) => {
        await openHealth(page);

        const never = await labelFor(page, 'Never');
        expect(never.never).toBe(true);
        expect(never.label).not.toBe('');
    });

    test('the exact moment is in the tooltip', async ({ page }) => {
        await openHealth(page);

        const hours = await labelFor(page, 'Hours');
        // The rounded label stays short; the precise timestamp survives on hover.
        expect(hours.title).not.toBe(hours.label);
        expect(hours.title.length).toBeGreaterThan(10);
    });

    test('the label updates the moment the row is opened', async ({ page }) => {
        await openHealth(page);
        await page.route('**/api/track-open', (route) =>
            route.fulfill({ status: 200, contentType: 'application/json', body: '{"success":true}' }));

        // The first row is the never-opened one, which makes the change visible.
        const row = page.locator('.health-view-item').first();
        const name = await row.locator('.health-view-item-title').textContent();
        const before = await labelFor(page, name.trim());

        await row.click();
        await page.waitForTimeout(300);
        await row.locator('[data-health-action="open"]').click({ force: true });

        await expect
            .poll(() => page.evaluate(() => document.querySelector('.health-view-item [data-health-opened]')?.textContent.trim()))
            .not.toBe(before.label);

        const after = await labelFor(page, name.trim());
        expect(after.never).toBe(false);
    });
});
