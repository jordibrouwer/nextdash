// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * Clicking a row in a widget does not leave a ring round it.
 *
 * The cursor of keyboard navigation follows focus, and a click focuses the row
 * it hit, so the cursor ring (a 2px accent box-shadow, there because browsers
 * withhold :focus-visible after a click) appeared round every row that was
 * clicked. A ring says "the keyboard is here"; after a click it only looked like
 * a border that should not be there. It shows when the cursor got there by key.
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

const ring = (page, sel) => page.locator(sel).first().evaluate((el) => getComputedStyle(el).boxShadow);

test.describe('the cursor ring in a widget', () => {
    test('a click on a row leaves no ring round it', async ({ page }) => {
        await openDashboard(page);
        const sel = '.dashboard-widget .dashboard-widget-body button.dashboard-widget-health-row, .dashboard-widget .dashboard-widget-body button.dashboard-widget-row';
        const btn = page.locator(sel).first();
        await expect(btn, 'the starter page has a widget with a row to click').toBeVisible();
        await btn.click({ noWaitAfter: true });
        await page.evaluate(() => { document.activeElement?.blur?.(); });
        const state = await btn.evaluate((el) => ({ selected: el.classList.contains('keyboard-selected'), shadow: getComputedStyle(el).boxShadow }));
        expect(state.shadow).toBe('none');
    });

    test('the ring is there when the cursor arrived by key', async ({ page }) => {
        await openDashboard(page);
        const shadow = await page.evaluate(() => {
            const kn = window.dashboardInstance.keyboardNavigation;
            kn.updateNavigableElements();
            const i = kn.navigableElements.findIndex((el) => el.matches('.dashboard-widget .dashboard-widget-body button'));
            if (i < 0) return null;
            kn.currentIndex = i;
            kn.highlightCurrentElement({ focus: false, keyboardNav: true });
            return getComputedStyle(kn.navigableElements[i]).boxShadow;
        });
        expect(shadow, 'a widget button to stand on').not.toBeNull();
        expect(shadow).not.toBe('none');
    });
});
