// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * Nothing composites over an open inline form.
 *
 * WebKit paints a composited layer in an order that ignores the z-index of
 * unrelated elements, and then hit-tests it in front: a tall inline edit form
 * opened from Health had a blurred neighbour painted on top of it, eating
 * every click on its fields, and `pointer-events: none` did not help. The
 * blur that caused it was on the bookmark rows, and it was taken out.
 *
 * The glass depth step puts the same arrangement back one level up. On glass
 * every .category and every widget body carries a backdrop-filter, and with a
 * form open five of those cards overlapped it -- each its own layer, each at
 * full opacity. So the blur comes off the cards for as long as a form is up.
 *
 * Held here as a property of the stylesheet rather than by opening the editor:
 * the symptom is Safari-only and does not reproduce in headless WebKit, so an
 * end-to-end test would pass in every browser this suite can run and prove
 * nothing. What is testable is that the rule engages.
 */

async function dashboard(page) {
    await page.setViewportSize({ width: 1500, height: 1000 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('.bookmark-link', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.evaluate(() => {
        const d = window.dashboardInstance;
        d.settings.themeDepth = 'glass';
        d.settings.layoutPreset = 'cards';
        document.body.setAttribute('data-depth', 'glass');
        d.config?.applyChromeSettings?.();
        d.renderCore?.renderDashboard?.({ animate: false });
    });
    await page.waitForSelector('.dashboard-grid.layout-cards .category', { timeout: 20_000 });
}

/** How many surfaces in the grid carry a backdrop-filter. */
const blurred = (page) => page.evaluate(() =>
    [...document.querySelectorAll('#dashboard-layout .category, #dashboard-layout .dashboard-widget-body')]
        .filter((el) => {
            const value = window.getComputedStyle(el).backdropFilter
                || window.getComputedStyle(el).webkitBackdropFilter;
            return value && value !== 'none';
        }).length);

test.describe('an open inline form', () => {
    test('the glass step composites the cards while nothing is being edited', async ({ page }) => {
        await dashboard(page);

        // The guard: without this the test below passes on a dashboard that
        // never had a blur to take off.
        expect(await blurred(page), 'glass drew no blur, so the rule below proves nothing')
            .toBeGreaterThan(0);
    });

    test('and none of them composites once a form is open', async ({ page }) => {
        await dashboard(page);
        await page.evaluate(() => document.body.classList.add('bookmark-inline-edit-active'));

        expect(await blurred(page), 'a card still composites over the form').toBe(0);
    });

    test('the blur comes back when the form closes', async ({ page }) => {
        await dashboard(page);
        await page.evaluate(() => document.body.classList.add('bookmark-inline-edit-active'));
        await page.evaluate(() => document.body.classList.remove('bookmark-inline-edit-active'));

        expect(await blurred(page), 'the dashboard lost its glass for good').toBeGreaterThan(0);
    });
});
