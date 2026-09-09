// @ts-check
const { test, expect } = require('./fixtures');
const { dismissOnboardingIfPresent, dismissBlockingOverlays, waitForFaviconPrefetch } = require('./e2e-helpers');

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
    // Quickstart's background favicon sweep reopens Overview when it finishes,
    // so this waited six seconds for it. waitForFaviconPrefetch waits for the
    // same thing by asking -- the overlay gone and nextdashSetupFaviconsDone no
    // longer false -- and returns the moment it is true instead of always
    // spending the worst case. dismissBlockingOverlays above already called it
    // once; a second call costs nothing when the sweep is already done and
    // covers the case where it was still running.
    await waitForFaviconPrefetch(page);
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
        // existed below the fold. The row arrives with its settings open, so
        // what has to be on screen is the panel it opened rather than only the
        // head of the row.
        // Polled, because the reveal scrolls smoothly: reading the box in the
        // same tick measures where the row started rather than where it lands.
        await expect.poll(async () => page.evaluate(() => {
            const row = document.querySelector('.config-widget-row');
            const panel = row.querySelector('.config-widget-settings:not([hidden])');
            const box = (panel || row).getBoundingClientRect();
            return row.getBoundingClientRect().top >= 0 && box.bottom <= window.innerHeight;
        }), { timeout: 10_000 }).toBe(true);

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

    /*
     * Adding one is almost always followed by filling it in, and the fields sat
     * behind a Settings button. Only one panel is open at a time, so on a page
     * that already carries a widget of the same kind that second click closed
     * the panel the reader was reading -- which is what made a second RSS block
     * feel like it could not be given feeds of its own.
     */
    test('the new widget arrives with its settings already open', async ({ page }) => {
        await openWidgets(page);
        await page.locator('[data-widget-catalogue]').click();
        await page.locator('.modal--widget-catalogue [data-widget-add="rss"]').click();

        const row = page.locator('.config-widget-row').filter({ hasText: 'RSS' });
        await expect(row).toHaveCount(1);
        await expect(row.locator('[data-widget-settings]')).toHaveAttribute('aria-expanded', 'true');
        // The fields themselves, not just an expanded button.
        await expect(row.locator('textarea[data-widget-setting="feedUrls"]')).toBeVisible();

        // A second one of the same kind opens its own panel rather than
        // reopening the first, and each carries its own fields.
        await page.locator('[data-widget-catalogue]').click();
        await page.locator('.modal--widget-catalogue [data-widget-add="rss"]').click();
        await expect(page.locator('.config-widget-row').filter({ hasText: 'RSS' })).toHaveCount(2);

        const open = page.locator('.config-widget-row [data-widget-settings][aria-expanded="true"]');
        await expect(open).toHaveCount(1);
        const areas = page.locator('textarea[data-widget-setting="feedUrls"]');
        await expect(areas).toHaveCount(1);
        // And it is the second widget's panel, not the first one reopened.
        const openIndex = await open.getAttribute('data-widget-settings');
        await expect(areas).toHaveAttribute('data-widget-index', openIndex);
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
