// @ts-check
const { test, expect } = require('@playwright/test');
const { prepareDashboardInteraction, dismissWhatsNewIfPresent } = require('./e2e-helpers');

/**
 * The dashboard grid on a touch device.
 *
 * Thirty-odd dashboard specs and none of them ran on a touch viewport, which is
 * how a 28x33 tab and a nameless page button both survived: on a mouse neither
 * is wrong, and nothing else looks.
 *
 * The distinction these tests turn on is that nextDash has two mobile stories.
 * A narrow window on a desktop keeps the ordinary layout — a mouse is still a
 * mouse. The phone layout needs a genuinely coarse pointer, and it hides the
 * page navigation outright. What was missing is the case in between: a tablet,
 * or a phone in landscape, where the pointer is a finger but the screen is wide
 * enough that the desktop layout stays and its tabs are tapped.
 */

async function openDashboard(page) {
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await prepareDashboardInteraction(page);
    await dismissWhatsNewIfPresent(page);
    await page.waitForSelector('.bookmark-link', { timeout: 15_000 });
}

test.describe('dashboard on a tablet — touch, desktop layout', () => {
    test.use({ viewport: { width: 1024, height: 1366 }, hasTouch: true, isMobile: true });

    test('the page tabs are big enough to tap', async ({ page }) => {
        await openDashboard(page);

        // The premise: this is the in-between case, not the phone layout.
        expect(await page.evaluate(() => document.body.getAttribute('data-mobile-layout')),
            'expected the desktop layout on a tablet-width touch screen').toBe('false');
        await expect(page.locator('#page-navigation')).toBeVisible();

        const tooSmall = await page.locator('.page-nav-btn').evaluateAll((els) => els
            .map((el) => {
                const r = el.getBoundingClientRect();
                return { label: el.getAttribute('aria-label') || el.textContent?.trim() || '?',
                    w: Math.round(r.width), h: Math.round(r.height) };
            })
            .filter((b) => b.w > 0 && (b.w < 44 || b.h < 44)));

        expect(tooSmall, 'page tabs under the 44px touch target').toEqual([]);
    });
});

test.describe('dashboard on a phone', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

    test('switches to the phone layout and drops the page strip', async ({ page }) => {
        await openDashboard(page);

        // The phone layout hides the page navigation rather than shrinking it,
        // so the tab-size rule above deliberately does not apply here.
        expect(await page.evaluate(() => document.body.getAttribute('data-mobile-layout'))).toBe('true');
        await expect(page.locator('#page-navigation')).toBeHidden();
    });

    test('the grid fits the screen without sideways scrolling', async ({ page }) => {
        await openDashboard(page);

        const overflow = await page.evaluate(() => {
            const doc = document.documentElement;
            return { scrollW: doc.scrollWidth, clientW: doc.clientWidth };
        });
        expect(overflow.scrollW, `page scrolls sideways: ${JSON.stringify(overflow)}`)
            .toBeLessThanOrEqual(overflow.clientW + 1);
    });
});

test.describe('page tabs name themselves', () => {
    test('a tab shows its page name to a screen reader even when it shows a number', async ({ page }) => {
        await openDashboard(page);

        // Numbers, which is the setting that leaves the tab reading "1".
        await page.evaluate(() => {
            const d = window.dashboardInstance;
            d.settings.showPageNamesInTabs = false;
            d.pageNav.renderPageNavigation();
        });

        const first = page.locator('#page-navigation .page-nav-btn').first();
        await expect(first).toHaveText('1');

        // The visible label is a bare number; the accessible name is not.
        const label = await first.getAttribute('aria-label');
        expect(label, 'tab has no accessible name').toBeTruthy();
        expect(label).not.toBe('1');
        // It names the page, so the announcement is useful rather than positional.
        const pageName = await page.evaluate(() => window.dashboardInstance.pages[0]?.name || '');
        if (pageName) {
            expect(label).toContain(pageName);
        }
    });
});
