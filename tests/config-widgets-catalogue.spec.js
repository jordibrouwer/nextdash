// @ts-check
const { test, expect } = require('./fixtures');
const { dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * Adding a widget, and landing on the one you added.
 *
 * The catalogue used to sit open on the Widgets tab: measured at 900px on a
 * 900px viewport, which put the list of widgets you actually have at y=1312 —
 * 412px below the fold. Clicking a card added something you could not see, and
 * the only sign of it was a toast in the opposite corner. So the tab named
 * "Widgets" was three quarters catalogue, and the catalogue was the same
 * thirteen names and thirteen sentences the Types tab already carried.
 *
 * It is an overlay now, the way the theme browser answers the same question.
 * What this pins is the part that made it worth moving: after choosing, the
 * new row is on screen and holding the caret.
 */

async function openWidgets(page) {
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => !!window.dashboardInstance?.config, null, { timeout: 15_000 });
    // Quickstart's background favicon sweep reopens Overview when it finishes.
    await page.waitForTimeout(6000);
    await page.evaluate(async () => {
        const f = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        const headers = {
            'Content-Type': 'application/json',
            ...(typeof nextDashWriteHeaders === 'function' ? nextDashWriteHeaders() : {}),
        };
        await f('/api/pages/1/blocks', { method: 'PUT', headers, body: JSON.stringify({ widgets: [] }) });
    });
    await page.evaluate(async () => { await window.dashboardInstance.config.openConfigView('widgets'); });
    await expect(page.locator('[data-widget-catalogue]')).toBeVisible();
}

test.describe('the widget catalogue is a door, not the page', () => {
    test('the tab opens on the list, with no catalogue inlined', async ({ page }) => {
        await openWidgets(page);

        // Nothing yet, so the empty list is the invitation and carries the door.
        await expect(page.locator('.config-widget-empty')).toBeVisible();
        await expect(page.locator('.config-widget-empty [data-widget-catalogue]')).toBeVisible();
        // The cards live in the overlay only.
        await expect(page.locator('#config-widgets-body .config-widget-pick')).toHaveCount(0);
    });

    test('choosing a kind closes the overlay and leaves the new row in view', async ({ page }) => {
        await openWidgets(page);

        await page.locator('[data-widget-catalogue]').click();
        await expect(page.locator('.modal--widget-catalogue [data-widget-add]').first()).toBeVisible();

        await page.locator('.modal--widget-catalogue [data-widget-add="health"]').click();
        await expect(page.locator('.modal--widget-catalogue')).toHaveCount(0);
        await expect(page.locator('.config-widget-row')).toHaveCount(1);

        // In view, not merely present: the whole complaint was a row that
        // existed below the fold.
        const placement = await page.evaluate(() => {
            const row = document.querySelector('.config-widget-row');
            const box = row.getBoundingClientRect();
            return { top: box.top, bottom: box.bottom, viewport: window.innerHeight };
        });
        expect(placement.top).toBeGreaterThanOrEqual(0);
        expect(placement.bottom).toBeLessThanOrEqual(placement.viewport);

        // And holding the caret, because naming it is the next thing anyone does.
        await expect(page.locator('.config-widget-row [data-widget="title"]')).toBeFocused();
    });

    test('the Types tab adds too, and switches to the list to show it', async ({ page }) => {
        await openWidgets(page);
        await page.locator('[data-widgets-tab="types"]').click();

        await page.locator('.config-widget-type-row [data-widget-add="uptime"]').click();

        await expect(page.locator('[data-widgets-tab="widgets"]')).toHaveAttribute('aria-selected', 'true');
        await expect(page.locator('.config-widget-row')).toHaveCount(1);
        await expect(page.locator('.config-widget-row [data-widget="title"]')).toBeFocused();
    });

    test('every kind on Types is addable from where it is described', async ({ page }) => {
        await openWidgets(page);
        await page.locator('[data-widgets-tab="types"]').click();

        // Custom is explained at length rather than in a row, which is how it
        // came to be the one kind on this tab with nothing to press.
        const offered = await page.evaluate(() => {
            const Config = window.DashboardConfig || window.dashboardInstance.config?.constructor;
            return [...(Config?.WIDGET_TYPES || [])];
        });
        await expect(page.locator('[data-widget-add]')).toHaveCount(offered.length);
        await expect(page.locator('.config-widget-custom-ref [data-widget-add="custom"]')).toBeVisible();

        await page.locator('.config-widget-custom-ref [data-widget-add="custom"]').click();
        await expect(page.locator('[data-widgets-tab="widgets"]')).toHaveAttribute('aria-selected', 'true');
        await expect(page.locator('.config-widget-row')).toHaveCount(1);
    });

    test('the Custom widget is named, not spelled as its type', async ({ page }) => {
        await openWidgets(page);
        await page.locator('[data-widget-catalogue]').click();
        await expect(page.locator('.modal--widget-catalogue [data-widget-add]').first()).toBeVisible();

        // dashboard.widgetType.custom was missing from every locale, so the card
        // fell back to the raw type and read a lowercase "custom" among thirteen
        // proper names. Read with textContent: the card sits at the bottom of
        // the catalogue's own scroll area, and innerText answers '' for
        // anything not currently rendered.
        const name = (await page.locator('[data-widget-add="custom"] .config-widget-pick-name')
            .textContent() || '').trim();
        expect(name).not.toBe('custom');
        expect(name).not.toBe('');
    });
});
