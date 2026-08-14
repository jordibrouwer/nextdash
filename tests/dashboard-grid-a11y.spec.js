// @ts-check
const { test, expect } = require('@playwright/test');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * Keyboard and screen-reader gaps around the bookmark grid.
 *
 * Every row is built with `tabIndex = -1` for the roving tab stop, and
 * KeyboardNavigation hands one of them a 0 only once it has walked the grid —
 * which happens on the first arrow key, not on a render. Between the first paint
 * and that key, Tab skipped the whole grid.
 *
 * The reorder handle carried an aria-label on a plain div with no role and no
 * tab stop, so it was announced by nothing while promising an affordance the
 * keyboard does not have (Alt+↑/↓ on the row is the real one). And the context
 * menu's submenu entry said aria-haspopup without ever saying aria-expanded, and
 * could only be entered with Enter — the same key that activates an ordinary
 * item, so nothing distinguished the two.
 */

async function openDashboard(page) {
    await page.setViewportSize({ width: 1400, height: 900 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });
}

const tabStops = (page) => page.evaluate(() => {
    const links = [...document.querySelectorAll('#dashboard-layout .bookmark-link a.bookmark-open')];
    return {
        total: links.length,
        tabbable: links.filter((link) => link.tabIndex === 0).length,
        index: links.findIndex((link) => link.tabIndex === 0),
    };
});

/**
 * Repaint and read the tab stops in the same tick.
 *
 * Asynchronously, this is unreliable: KeyboardNavigation re-syncs the roving tab
 * stop on its own schedule, so a check a few hundred milliseconds after the
 * render passes whether or not the render itself guarantees anything. Reading
 * synchronously pins it to what the render left behind, which is the claim.
 */
const tabStopsRightAfterRender = (page) => page.evaluate(() => {
    window.dashboardInstance.renderDashboard({ incremental: false });
    const links = [...document.querySelectorAll('#dashboard-layout .bookmark-link a.bookmark-open')];
    return {
        total: links.length,
        tabbable: links.filter((link) => link.tabIndex === 0).length,
        index: links.findIndex((link) => link.tabIndex === 0),
    };
});

test.describe('the grid is reachable by Tab', () => {
    test('a render leaves exactly one row in the tab order', async ({ page }) => {
        await openDashboard(page);
        const stops = await tabStopsRightAfterRender(page);

        expect(stops.total).toBeGreaterThan(0);
        // Exactly one: a roving tab stop with several 0s is no longer roving.
        expect(stops.tabbable).toBe(1);
        expect(stops.index).toBe(0);
    });

    test('it keeps the row the cursor is on rather than resetting to the first', async ({ page }) => {
        await openDashboard(page);
        await page.evaluate(() => document.activeElement?.blur());
        await page.keyboard.press('ArrowDown');
        await page.keyboard.press('ArrowDown');

        const stops = await tabStopsRightAfterRender(page);
        expect(stops.tabbable).toBe(1);
        expect(stops.index).toBe(await page.evaluate(
            () => window.dashboardInstance.keyboardNavigation.currentIndex));
    });

    test('arrow keys still move it', async ({ page }) => {
        await openDashboard(page);
        await page.evaluate(() => document.activeElement?.blur());
        await page.keyboard.press('ArrowDown');
        const first = await tabStops(page);
        await page.keyboard.press('ArrowDown');
        const second = await tabStops(page);

        expect(second.tabbable).toBe(1);
        expect(second.index).toBe(first.index + 1);
    });
});

test.describe('the reorder handle', () => {
    test('is hidden from assistive tech rather than falsely labelled', async ({ page }) => {
        await openDashboard(page);

        const handle = await page.evaluate(() => {
            const el = document.querySelector('#dashboard-layout .bookmark-reorder-handle');
            if (!el) return null;
            return {
                ariaHidden: el.getAttribute('aria-hidden'),
                ariaLabel: el.getAttribute('aria-label'),
                hasTitle: Boolean(el.getAttribute('title')),
                tabIndex: el.tabIndex,
            };
        });

        expect(handle, 'no reorder handle on the grid').not.toBeNull();
        expect(handle.ariaHidden).toBe('true');
        // The label promised an affordance that does not exist for the keyboard.
        expect(handle.ariaLabel).toBeNull();
        // The mouse tooltip stays.
        expect(handle.hasTitle).toBe(true);
        expect(handle.tabIndex).toBeLessThan(0);
    });
});

test.describe('the context menu submenu', () => {
    async function openContextMenu(page) {
        await page.evaluate(() => document.activeElement?.blur());
        await page.keyboard.press('ArrowDown');
        await expect
            .poll(() => page.evaluate(() => window.dashboardInstance.keyboardNavigation?.currentIndex ?? -1))
            .toBeGreaterThanOrEqual(0);
        await page.evaluate(() => {
            const kn = window.dashboardInstance.keyboardNavigation;
            const row = kn.navigableElements[kn.currentIndex];
            row.dispatchEvent(new MouseEvent('contextmenu', {
                bubbles: true, clientX: 300, clientY: 300,
            }));
        });
        await expect(page.locator('#bookmark-context-menu')).toBeVisible({ timeout: 5000 });
    }

    test('says it is collapsed while it is', async ({ page }) => {
        await openDashboard(page);
        await openContextMenu(page);

        const entry = page.locator('#bookmark-context-menu [aria-haspopup="menu"]');
        await expect(entry).toHaveCount(1);
        await expect(entry).toHaveAttribute('aria-expanded', 'false');
    });

    test('ArrowRight opens it, the way a native submenu works', async ({ page }) => {
        await openDashboard(page);
        await openContextMenu(page);

        // Walk down to the entry that has a submenu, then step into it.
        const steps = await page.evaluate(() => {
            const items = [...document.querySelectorAll('#bookmark-context-menu [role="menuitem"]')];
            return items.findIndex((el) => el.getAttribute('aria-haspopup') === 'menu');
        });
        expect(steps).toBeGreaterThanOrEqual(0);
        for (let i = 0; i < steps; i += 1) {
            await page.keyboard.press('ArrowDown');
        }

        await page.keyboard.press('ArrowRight');
        await expect(page.locator('#bookmark-check-mode-menu')).toBeVisible({ timeout: 5000 });
        // Stepping in replaces the parent, as it did before via Enter.
        await expect(page.locator('#bookmark-context-menu')).toHaveCount(0);
    });

    test('ArrowLeft walks back out to the parent', async ({ page }) => {
        await openDashboard(page);
        await openContextMenu(page);

        const steps = await page.evaluate(() => {
            const items = [...document.querySelectorAll('#bookmark-context-menu [role="menuitem"]')];
            return items.findIndex((el) => el.getAttribute('aria-haspopup') === 'menu');
        });
        for (let i = 0; i < steps; i += 1) {
            await page.keyboard.press('ArrowDown');
        }
        await page.keyboard.press('ArrowRight');
        await expect(page.locator('#bookmark-check-mode-menu')).toBeVisible({ timeout: 5000 });

        await page.keyboard.press('ArrowLeft');
        await expect(page.locator('#bookmark-check-mode-menu')).toHaveCount(0, { timeout: 5000 });
        // Back where it came from, not the whole stack dropped.
        await expect(page.locator('#bookmark-context-menu')).toBeVisible({ timeout: 5000 });
    });
});
