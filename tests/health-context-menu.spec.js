// @ts-check
const { test, expect } = require('@playwright/test');
const { prepareDashboardInteraction } = require('./e2e-helpers');

/**
 * Right-clicking a health row opens its More menu, the way right-clicking a
 * bookmark row on the dashboard opens the context menu.
 *
 * What matters here is that this is a second way into the *same* menu, not a
 * second menu: the actions, the Escape handling and the outside-click dismiss
 * all belong to the existing ⋯ overflow. So these specs check where the menu
 * lands and that the button path still works afterwards, rather than
 * re-covering the actions themselves — health-copy-share.spec.js already does
 * that.
 *
 * The report is mocked so the rows are a known set rather than whatever the
 * seeded bookmarks happen to be.
 */

function report() {
    return {
        generatedAt: Date.now(),
        summary: { totalBookmarks: 2, healthyCount: 1, brokenCount: 1, duplicateCount: 0, uncheckedCount: 0 },
        issues: [
            {
                pageId: 1, index: 0, pageName: 'dev', name: 'Broken one',
                url: 'https://example.com/broken', category: 'tools',
                status: 'broken', score: 25, duplicateCount: 0,
                lastChecked: 1752000000000,
                reasons: ['HTTP 500'],
                reasonDetails: [{ code: 'last_error', detail: 'HTTP 500', penalty: 60 }],
            },
            {
                pageId: 1, index: 1, pageName: 'dev', name: 'Healthy one',
                url: 'https://example.com/fine', category: 'tools',
                status: 'healthy', score: 100, duplicateCount: 0,
                lastChecked: 1752000000000, reasons: [], reasonDetails: [],
            },
        ],
        duplicateGroups: [],
    };
}

async function openHealthView(page) {
    await page.route('**/api/bookmark-health**', async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(report()),
        });
    });
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await prepareDashboardInteraction(page);
    await page.click('.health-link a.health-link-anchor');
    await page.waitForSelector('#dashboard-layout.health-layout .health-view-item', { timeout: 15_000 });
}

/** The default filter hides healthy rows; several specs here need two. */
async function showAllRows(page) {
    await page.evaluate(() => {
        document.querySelector('[data-health-filter="all"]')?.click();
    });
    await expect(page.locator('.health-view-item')).toHaveCount(2);
}

const openMenu = (page) => page.locator('.health-view-menu:not([hidden])');

/**
 * Wait until the cursor placement has actually been written. It is applied
 * across animation frames and again once the row's actions bar finishes
 * expanding, so asserting on geometry straight after the click reads the menu
 * mid-flight.
 */
async function waitForCursorPlacement(page) {
    await expect.poll(() => page.evaluate(() => {
        const m = document.querySelector('.health-view-menu:not([hidden])');
        return Boolean(m && m.style.top && m.style.left);
    })).toBe(true);
}

test.describe('health view right-click menu', () => {
    test('right-clicking a row opens its More menu', async ({ page }) => {
        await openHealthView(page);
        const row = page.locator('.health-view-item').first();
        await row.click({ button: 'right', position: { x: 60, y: 20 } });

        await expect(openMenu(page)).toHaveCount(1);
        // Visible, not merely present: the actions bar it lives in is collapsed
        // and transparent until the row is hovered or selected, so an open menu
        // inside it could easily render invisible.
        await expect(openMenu(page)).toBeVisible();
        await expect(openMenu(page)).toHaveAttribute('data-menu-for', '1:0');
    });

    test('the menu opens near the cursor rather than under the button', async ({ page }) => {
        await openHealthView(page);
        const row = page.locator('.health-view-item').first();
        await row.click({ button: 'right', position: { x: 60, y: 20 } });
        await expect(openMenu(page)).toBeVisible();
        await waitForCursorPlacement(page);

        const geometry = await page.evaluate(() => {
            const menu = document.querySelector('.health-view-menu:not([hidden])');
            const button = document.querySelector('.health-view-more-btn');
            const m = menu.getBoundingClientRect();
            const b = button.getBoundingClientRect();
            return {
                menuLeft: m.left,
                buttonLeft: b.left,
                onScreen: m.left >= 0 && m.right <= window.innerWidth
                    && m.top >= 0 && m.bottom <= window.innerHeight,
            };
        });
        // The ⋯ button sits at the right end of the actions bar; a menu opened at
        // a cursor near the row's left edge cannot be sharing its left edge.
        expect(geometry.menuLeft).toBeLessThan(geometry.buttonLeft);
        expect(geometry.onScreen).toBe(true);
    });

    test('a menu opened at the cursor stays within the viewport', async ({ page }) => {
        await openHealthView(page);
        const row = page.locator('.health-view-item').first();
        const box = await row.boundingBox();
        // Far right, where an unclamped menu would hang off the edge.
        await row.click({ button: 'right', position: { x: Math.round(box.width) - 4, y: 20 } });
        await expect(openMenu(page)).toBeVisible();
        await waitForCursorPlacement(page);

        const overflow = await page.evaluate(() => {
            const r = document.querySelector('.health-view-menu:not([hidden])').getBoundingClientRect();
            return { right: r.right - window.innerWidth, left: r.left, bottom: r.bottom - window.innerHeight };
        });
        expect(overflow.right).toBeLessThanOrEqual(0);
        expect(overflow.left).toBeGreaterThanOrEqual(0);
        expect(overflow.bottom).toBeLessThanOrEqual(0);
    });

    test('right-clicking another row moves the menu instead of closing it', async ({ page }) => {
        await openHealthView(page);
        await showAllRows(page);
        const rows = page.locator('.health-view-item');

        await rows.nth(0).click({ button: 'right', position: { x: 60, y: 20 } });
        await expect(openMenu(page)).toHaveAttribute('data-menu-for', '1:0');

        await rows.nth(1).click({ button: 'right', position: { x: 60, y: 20 } });
        // Exactly one, on the second row: the first row's menu closed rather than
        // leaving two menus up at once.
        await expect(openMenu(page)).toHaveCount(1);
        await expect(openMenu(page)).toHaveAttribute('data-menu-for', '1:1');
    });

    test('right-clicking the same row again moves the menu rather than closing it', async ({ page }) => {
        await openHealthView(page);
        const row = page.locator('.health-view-item').first();

        await row.click({ button: 'right', position: { x: 40, y: 20 } });
        await waitForCursorPlacement(page);
        const first = await page.evaluate(
            () => document.querySelector('.health-view-menu:not([hidden])').getBoundingClientRect().left,
        );

        // A second right-click further along the same row. The menu is already
        // open, so a plain toggle would dismiss it — but a right-click is a
        // request to open here, not to close.
        await row.click({ button: 'right', position: { x: 160, y: 20 } });
        await expect(openMenu(page)).toHaveCount(1);
        await expect
            .poll(() => page.evaluate(
                () => document.querySelector('.health-view-menu:not([hidden])')?.getBoundingClientRect().left ?? -1,
            ))
            .toBeGreaterThan(first);
    });

    test('the ⋯ button still opens the menu under itself afterwards', async ({ page }) => {
        await openHealthView(page);
        const row = page.locator('.health-view-item').first();
        await row.click({ button: 'right', position: { x: 60, y: 20 } });
        await expect(openMenu(page)).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(openMenu(page)).toHaveCount(0);

        // Clicked through the DOM because the row actions only surface on hover.
        await page.evaluate(() => document.querySelector('.health-view-more-btn').click());
        await expect(openMenu(page)).toBeVisible();

        const placement = await page.evaluate(() => {
            const menu = document.querySelector('.health-view-menu:not([hidden])');
            const button = document.querySelector('.health-view-more-btn');
            const m = menu.getBoundingClientRect();
            const b = button.getBoundingClientRect();
            return {
                stillAtCursor: menu.classList.contains('health-view-menu--at-cursor'),
                inlineTop: menu.style.top,
                alignedWithButton: Math.abs(m.left - b.left) < 2,
            };
        });
        // The cursor placement has to be torn down, or the button would open the
        // menu wherever the last right-click happened to leave it.
        expect(placement.stillAtCursor).toBe(false);
        expect(placement.inlineTop).toBe('');
        expect(placement.alignedWithButton).toBe(true);
    });

    test('an action picked from the right-click menu runs on the right row', async ({ page }) => {
        await openHealthView(page);
        await showAllRows(page);
        await page.evaluate(() => {
            // @ts-ignore - removing an optional platform API on purpose
            delete navigator.share;
            window.__writes = [];
            Object.defineProperty(navigator, 'clipboard', {
                configurable: true,
                value: { writeText: (t) => { window.__writes.push(t); return Promise.resolve(); } },
            });
        });

        // The second row, so a menu wired to the first would copy the wrong URL.
        await page.locator('.health-view-item').nth(1).click({ button: 'right', position: { x: 60, y: 20 } });
        await expect(openMenu(page)).toBeVisible();
        await page.evaluate(() => {
            document.querySelector('.health-view-menu:not([hidden]) [data-menu-action="copy-url"]').click();
        });

        await expect.poll(() => page.evaluate(() => window.__writes)).toEqual(['https://example.com/fine']);
    });

    test('shift+right-click leaves the browser menu alone', async ({ page }) => {
        await openHealthView(page);
        const row = page.locator('.health-view-item').first();
        await page.keyboard.down('Shift');
        await row.click({ button: 'right', position: { x: 60, y: 20 } });
        await page.keyboard.up('Shift');

        // The escape hatch to the native menu, matching the dashboard's rule.
        await expect(openMenu(page)).toHaveCount(0);
    });
});
