// @ts-check
const { test, expect } = require('@playwright/test');

/**
 * Tab-through navigation. nextDash is keyboard-first, so reaching a bookmark must
 * not cost dozens of presses, and the row list must never trap focus.
 */

function report(rowCount) {
    return {
        score: 40,
        summary: { brokenCount: rowCount, healthyCount: 0, totalBookmarks: rowCount },
        issues: Array.from({ length: rowCount }, (_, i) => ({
            pageId: 1, index: i, pageName: 'main', name: `Row ${i}`,
            url: `https://example.com/${i}`, category: 'test',
            status: 'broken', score: 25,
            reasons: ['HTTP 500'],
            reasonDetails: [{ code: 'last_error', detail: 'HTTP 500', penalty: 60 }]
        })),
        duplicateGroups: []
    };
}

async function gotoHealth(page, rowCount = 3) {
    await page.route('**/api/bookmark-health**', async (route) => {
        await route.fulfill({
            status: 200, contentType: 'application/json',
            body: JSON.stringify(report(rowCount))
        });
    });
    await page.goto('/health?filter=all');
    await page.waitForSelector('#health-issues .health-row', { timeout: 15_000 });
}

/** Describe whatever currently holds focus. */
function focusInfo(page) {
    return page.evaluate(() => {
        const el = document.activeElement;
        if (!el || el === document.body) return { tag: 'BODY', row: null };
        const row = el.closest('.health-row');
        return {
            tag: el.tagName.toLowerCase(),
            id: el.id || null,
            cls: typeof el.className === 'string' ? el.className.split(/\s+/)[0] : null,
            row: row ? Number(row.getAttribute('data-row-index')) : null
        };
    });
}

test.describe('health tab navigation', () => {
    test('the row list costs one tab stop per row, not one per control', async ({ page }) => {
        await gotoHealth(page, 3);

        const stops = [];
        for (let i = 0; i < 14; i++) {
            await page.keyboard.press('Tab');
            stops.push(await focusInfo(page));
        }

        // Each row contributes exactly one stop.
        const rowStops = stops.filter((s) => s.row !== null);
        expect(rowStops.map((s) => s.row)).toEqual([0, 1, 2]);

        // And the first row is reachable in a sane number of presses.
        const firstRowAt = stops.findIndex((s) => s.row === 0);
        expect(firstRowAt).toBeGreaterThanOrEqual(0);
        expect(firstRowAt).toBeLessThan(12);
    });

    test('tab leaves the list at the last row instead of trapping focus', async ({ page }) => {
        await gotoHealth(page, 3);

        for (let i = 0; i < 11; i++) await page.keyboard.press('Tab');
        expect((await focusInfo(page)).row).toBe(0);

        await page.keyboard.press('Tab');
        await page.keyboard.press('Tab');
        expect((await focusInfo(page)).row).toBe(2);

        // Past the last row focus must escape the list.
        await page.keyboard.press('Tab');
        expect((await focusInfo(page)).row).toBeNull();
    });

    test('shift+tab walks back up and releases at the first row', async ({ page }) => {
        await gotoHealth(page, 3);

        await page.locator('body').click({ position: { x: 5, y: 5 } });
        await page.keyboard.press('G');
        expect((await focusInfo(page)).row).toBe(2);

        await page.keyboard.press('Shift+Tab');
        expect((await focusInfo(page)).row).toBe(1);

        await page.keyboard.press('Shift+Tab');
        expect((await focusInfo(page)).row).toBe(0);

        await page.keyboard.press('Shift+Tab');
        expect((await focusInfo(page)).row).toBeNull();
    });

    test('j/k move DOM focus so tab resumes from the current row', async ({ page }) => {
        await gotoHealth(page, 3);

        await page.locator('body').click({ position: { x: 5, y: 5 } });
        await page.keyboard.press('j');
        await page.keyboard.press('j');
        expect((await focusInfo(page)).row).toBe(1);

        await page.keyboard.press('Tab');
        expect((await focusInfo(page)).row).toBe(2);
    });

    test('tabbing into a row makes it the current row for j/k', async ({ page }) => {
        await gotoHealth(page, 3);

        for (let i = 0; i < 11; i++) await page.keyboard.press('Tab');
        expect((await focusInfo(page)).row).toBe(0);

        // j must continue from the row Tab landed on, not from a stale index.
        await page.keyboard.press('j');
        expect((await focusInfo(page)).row).toBe(1);
        await expect(page.locator('.health-row--focused')).toHaveCount(1);
    });

    test('filter pills are one tab stop with arrow keys inside', async ({ page }) => {
        await gotoHealth(page, 2);

        const pills = page.locator('#health-filter-pills .health-pill');
        await expect(pills.first()).toBeVisible();

        // Exactly one pill is tabbable.
        const tabbable = await page.locator('#health-filter-pills .health-pill[tabindex="0"]').count();
        expect(tabbable).toBe(1);

        await pills.first().focus();
        await page.keyboard.press('ArrowRight');
        const focusedIdx = await page.evaluate(() => {
            const all = [...document.querySelectorAll('#health-filter-pills .health-pill')];
            return all.indexOf(document.activeElement);
        });
        expect(focusedIdx).toBe(1);

        await page.keyboard.press('End');
        const lastIdx = await page.evaluate(() => {
            const all = [...document.querySelectorAll('#health-filter-pills .health-pill')];
            return all.indexOf(document.activeElement);
        });
        expect(lastIdx).toBe((await pills.count()) - 1);
    });

    test('every row control stays reachable by keyboard via shortcuts', async ({ page }) => {
        await gotoHealth(page, 2);

        await page.locator('body').click({ position: { x: 5, y: 5 } });
        await page.keyboard.press('j');

        // Controls are out of the tab order, so the shortcuts must cover them.
        await page.keyboard.press('s');
        await expect(page.locator('.health-row--focused [data-score-panel]')).toBeVisible();

        await page.keyboard.press('x');
        await expect(page.locator('.health-row--selected')).toHaveCount(1);
    });

    test('m opens the row action menu and moves focus into it', async ({ page }) => {
        await gotoHealth(page, 2);

        await page.locator('body').click({ position: { x: 5, y: 5 } });
        await page.keyboard.press('j');
        await page.keyboard.press('m');

        const menu = page.locator('.health-row--focused .health-actions-menu:not([hidden])');
        await expect(menu).toBeVisible();
        // The menu is useless if focus stays behind on the row.
        await expect(menu.locator('.health-actions-menu-item').first()).toBeFocused();

        await page.keyboard.press('ArrowDown');
        await expect(menu.locator('.health-actions-menu-item').nth(1)).toBeFocused();

        // Escape closes it and returns focus to the row, so j/k keep working.
        await page.keyboard.press('Escape');
        await expect(menu).toBeHidden();
        await expect(page.locator('.health-row--focused .health-row-main')).toBeFocused();

        await page.keyboard.press('j');
        expect((await focusInfo(page)).row).toBe(1);
    });
});
