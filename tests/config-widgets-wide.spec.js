// @ts-check
const { test, expect } = require('./fixtures');
const {
    dismissOnboardingIfPresent, dismissBlockingOverlays, waitForFaviconPrefetch,
    markWidgetsTutorialSeen, markConfigSettingPromosSeen,
} = require('./e2e-helpers');

/*
 * On a wide screen the list and the opened widget sit side by side; on a narrow
 * one the same detail opens under its row. Behaviour only -- which widget is
 * open, and that a draft survives switching -- not pixels.
 *
 * The widths are viewport widths, chosen against the body they leave Config:
 * 820 gives the section about 400px, 1600 about 1170px, either side of
 * WIDGETS_WIDE_MIN with room to spare.
 */
async function openWithWidgets(page, width, { secondPage = false } = {}) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await waitForFaviconPrefetch(page);
    await markWidgetsTutorialSeen(page);
    await markConfigSettingPromosSeen(page);
    const second = await page.evaluate(async (wantSecond) => {
        const f = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        const headers = { 'Content-Type': 'application/json',
            ...(typeof nextDashWriteHeaders === 'function' ? nextDashWriteHeaders() : {}) };
        const put = (id, widgets) => f(`/api/pages/${id}/blocks`,
            { method: 'PUT', headers, body: JSON.stringify({ widgets }) });
        const dash = window.dashboardInstance;
        let secondId = null;
        if (wantSecond) {
            if ((dash.pages || []).length < 2) {
                await (await dash.config.load()).addPage();
                await new Promise((r) => setTimeout(r, 1500));
            }
            secondId = dash.pages[1]?.id ?? null;
            if (secondId != null) {
                await put(secondId, [{ type: 'health', title: 'Elsewhere', config: {} }]);
            }
        }
        await put(dash.pages[0].id, [
            { type: 'cpu', title: 'Processor', config: {} },
            { type: 'memory', title: 'Memory', config: {} },
            { type: 'notes', title: 'Notes', config: {} },
        ]);
        await dash.config.openConfigView('widgets');
        return secondId;
    }, secondPage);
    await expect(page.locator('.config-widget-row')).toHaveCount(3);
    return second;
}

// By the title field's value: the title is an input, so hasText cannot see it.
const row = (page, name) => page.locator(`.config-widget-row:has([data-widget="title"][value="${name}"])`);
const side = (page) => page.locator('.config-widgets-detailpanel');
const bodyWidth = (page) => page.evaluate(() => document.getElementById('config-widgets-body').clientWidth);

test.describe('wide: list and detail side by side', () => {
    test('the first widget is open in the side panel from the start', async ({ page }) => {
        await openWithWidgets(page, 1600);
        await expect(side(page)).toBeVisible();
        await expect(side(page).locator('.config-widget-detail-title')).toContainText('Processor');
        await expect(page.locator('.config-widget-row .config-widget-detail')).toHaveCount(0);
        await expect(row(page, 'Processor')).toHaveClass(/is-open/);
    });

    test('Settings on another row moves the side panel to it', async ({ page }) => {
        await openWithWidgets(page, 1600);
        await row(page, 'Notes').locator('[data-widget-settings]').click();
        await expect(side(page).locator('.config-widget-detail-title')).toContainText('Notes');
        await expect(row(page, 'Notes')).toHaveClass(/is-open/);
        // Selecting is not a toggle here: a second click keeps it open.
        await row(page, 'Notes').locator('[data-widget-settings]').click();
        await expect(side(page).locator('.config-widget-detail-title')).toContainText('Notes');
    });

    test('a search that hides the open widget falls back to the first one shown', async ({ page }) => {
        await openWithWidgets(page, 1600);
        await row(page, 'Notes').locator('[data-widget-settings]').click();
        await page.locator('#config-widget-search').fill('mem');
        await expect(side(page).locator('.config-widget-detail-title')).toContainText('Memory');
    });

    test('an unsaved draft survives selecting another widget and back', async ({ page }) => {
        await openWithWidgets(page, 1600);
        const field = side(page).locator('[data-widget-setting="refreshSeconds"]');
        await field.fill('45');
        await field.dispatchEvent('change');
        await expect(side(page).locator('[data-widget-save]')).toBeEnabled();
        await row(page, 'Notes').locator('[data-widget-settings]').click();
        await expect(side(page).locator('.config-widget-detail-title')).toContainText('Notes');
        await row(page, 'Processor').locator('[data-widget-settings]').click();
        await expect(side(page).locator('[data-widget-save]')).toBeEnabled();
        await expect(side(page).locator('[data-widget-setting="refreshSeconds"]')).toHaveValue('45');
    });

    test('deleting the open widget opens the next one', async ({ page }) => {
        await openWithWidgets(page, 1600);
        await side(page).locator('[data-widget-delete]').click();
        await page.locator('#config-confirm-modal [data-confirm="ok"]').click();
        await expect(page.locator('.config-widget-row')).toHaveCount(2);
        await expect(side(page).locator('.config-widget-detail-title')).toContainText('Memory');
    });

    test('moving the open widget to another page opens the first one left', async ({ page }) => {
        const second = await openWithWidgets(page, 1600, { secondPage: true });
        expect(second).not.toBeNull();
        await row(page, 'Notes').locator('[data-widget-settings]').click();
        await side(page).locator('[data-widget-move-page]').selectOption(String(second));
        await expect(page.locator('.config-widget-row')).toHaveCount(2);
        await expect(side(page).locator('.config-widget-detail-title')).toContainText('Processor');
    });

    test('All pages: the detail and its Delete act on the widget\'s own page', async ({ page }) => {
        const second = await openWithWidgets(page, 1600, { secondPage: true });
        expect(second).not.toBeNull();
        await page.locator('[data-widget-page]').selectOption('all');
        await expect(page.locator('.config-widget-row')).toHaveCount(4);
        // Open one on the first page first, so the second-page one is a real switch.
        await row(page, 'Memory').locator('[data-widget-settings]').click();
        await expect(side(page).locator('.config-widget-detail-title')).toContainText('Memory');
        await row(page, 'Elsewhere').locator('[data-widget-settings]').click();
        await expect(side(page).locator('.config-widget-detail-title')).toContainText('Elsewhere');
        await expect(side(page).locator('[data-widget-move-page]')).toHaveValue(String(second));

        await side(page).locator('[data-widget-delete]').click();
        await page.locator('#config-confirm-modal [data-confirm="ok"]').click();
        await expect(page.locator('.config-widget-row')).toHaveCount(3);
        await expect(side(page).locator('.config-widget-detail-title')).not.toContainText('Elsewhere');

        const left = await page.evaluate(async (ids) => {
            const read = async (id) => (await (await fetch(`/api/pages/${id}/blocks`)).json()).widgets || [];
            return { first: (await read(ids.first)).map((w) => w.title), second: (await read(ids.second)).map((w) => w.title) };
        }, { first: await page.evaluate(() => window.dashboardInstance.pages[0].id), second });
        expect(left.second).not.toContain('Elsewhere');
        expect(left.first.sort()).toEqual(['Memory', 'Notes', 'Processor']);
    });

    test('switching page opens the first widget of the new page', async ({ page }) => {
        const second = await openWithWidgets(page, 1600, { secondPage: true });
        expect(second).not.toBeNull();
        await row(page, 'Notes').locator('[data-widget-settings]').click();
        await page.locator('[data-widget-page]').selectOption(String(second));
        await expect(page.locator('.config-widget-row')).toHaveCount(1);
        await expect(side(page).locator('.config-widget-detail-title')).toContainText('Elsewhere');
    });
});

test.describe('narrow: the detail opens under its row', () => {
    test('no side panel, and Settings opens inline', async ({ page }) => {
        await openWithWidgets(page, 820);
        await expect(side(page)).toHaveCount(0);
        await row(page, 'Memory').locator('[data-widget-settings]').click();
        await expect(row(page, 'Memory').locator('.config-widget-detail')).toBeVisible();
        // Still a toggle here.
        await row(page, 'Memory').locator('[data-widget-settings]').click();
        await expect(page.locator('.config-widget-detail')).toHaveCount(0);
    });

    test('growing the window past the breakpoint keeps the open widget', async ({ page }) => {
        await openWithWidgets(page, 820);
        await row(page, 'Memory').locator('[data-widget-settings]').click();
        await page.setViewportSize({ width: 1600, height: 900 });
        await expect(side(page).locator('.config-widget-detail-title')).toContainText('Memory');
    });

    test('a field being typed in keeps its focus and value across the breakpoint', async ({ page }) => {
        await openWithWidgets(page, 820);
        await row(page, 'Processor').locator('[data-widget-settings]').click();
        const inline = row(page, 'Processor').locator('[data-widget-setting="refreshSeconds"]');
        await inline.fill('45');
        await expect(inline).toBeFocused();
        await page.setViewportSize({ width: 1600, height: 900 });
        const wide = side(page).locator('[data-widget-setting="refreshSeconds"]');
        await expect(wide).toBeFocused();
        await expect(wide).toHaveValue('45');
        await page.setViewportSize({ width: 820, height: 900 });
        await expect(side(page)).toHaveCount(0);
        await expect(row(page, 'Processor').locator('[data-widget-setting="refreshSeconds"]')).toBeFocused();
    });

    test('a width just under the line does not flip a wide layout back', async ({ page }) => {
        await openWithWidgets(page, 1600);
        await expect(side(page)).toBeVisible();
        const min = await page.evaluate(() => window.DashboardConfig.WIDGETS_WIDE_MIN);
        // Find a window whose body sits in the slack band under the line.
        let inBand = null;
        for (let w = 1380; w >= 1240 && inBand == null; w -= 4) {
            await page.setViewportSize({ width: w, height: 900 });
            const bw = await bodyWidth(page);
            if (bw < min - 4 && bw > min - 36) inBand = w;
        }
        expect(inBand).not.toBeNull();
        await page.waitForTimeout(150);
        await expect(side(page)).toBeVisible();
        // Arriving at the same width from narrow stays narrow: it is slack, not a new line.
        await page.setViewportSize({ width: 820, height: 900 });
        await expect(side(page)).toHaveCount(0);
        await page.setViewportSize({ width: /** @type {number} */ (inBand), height: 900 });
        await page.waitForTimeout(150);
        await expect(side(page)).toHaveCount(0);
    });
});
