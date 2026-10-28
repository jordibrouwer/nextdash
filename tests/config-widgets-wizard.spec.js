// @ts-check
const { test, expect } = require('./fixtures');
const { dismissOnboardingIfPresent, dismissBlockingOverlays, waitForFaviconPrefetch } = require('./e2e-helpers');

/**
 * The Add wizard: the picker names the page a widget lands on.
 *
 * Adding used to mean "the page the list happens to show", which on the
 * all-pages view was no page at all. The picker now carries the choice
 * itself, and only when there is a choice to make.
 */

async function openWidgets(page) {
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => !!window.dashboardInstance?.config, null, { timeout: 15_000 });
    await waitForFaviconPrefetch(page);
    await clearWidgets(page);
    await openList(page);
}

/** (Re)open Config → Widgets so the list loads what is stored now. */
async function openList(page) {
    await page.evaluate(async () => { await window.dashboardInstance.config.openConfigView('widgets'); });
    await expect(page.locator('[data-widget-catalogue]')).toBeVisible();
}

/** Empty every page's widgets, and return the ids of the pages. */
async function clearWidgets(page) {
    return page.evaluate(async () => {
        const f = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        const headers = {
            'Content-Type': 'application/json',
            ...(typeof nextDashWriteHeaders === 'function' ? nextDashWriteHeaders() : {}),
        };
        const pages = window.dashboardInstance.pages || [];
        for (const p of pages) {
            await f(`/api/pages/${p.id}/blocks`, { method: 'PUT', headers, body: JSON.stringify({ widgets: [] }) });
        }
        return pages.map((p) => p.id);
    });
}

async function widgetTypes(page, pageId) {
    return page.evaluate(async (id) => {
        const res = await fetch(`/api/pages/${id}/blocks`);
        const data = await res.json();
        return (data.widgets || []).map((w) => w.type);
    }, pageId);
}

test.describe('the add picker names a page', () => {
    test('a one-page install shows no page select', async ({ page }) => {
        await openWidgets(page);
        const pages = await page.evaluate(() => window.dashboardInstance.pages.length);
        // Specs in a file share one store and this runs first, before the
        // other test adds a page.
        expect(pages).toBe(1);
        const [only] = await clearWidgets(page);

        await page.locator('[data-widget-catalogue]').click();
        await page.locator('[data-widget-option="notes"]').click();
        await expect(page.locator('[data-widget-add="notes"]')).toBeVisible();
        await expect(page.locator('[data-widget-wizard-page]')).toHaveCount(0);
        await page.locator('[data-widget-add="notes"]').click();

        await expect.poll(() => widgetTypes(page, only)).toEqual(['notes']);
    });

    test('the picker names a page, and the widget lands on it', async ({ page }) => {
        await openWidgets(page);
        const second = await page.evaluate(async () => {
            const cfg = window.dashboardInstance.config._module;
            await cfg.addPage();
            await new Promise((r) => setTimeout(r, 1500));
            return (window.dashboardInstance.pages || [])[1]?.id;
        });
        expect(second).toBeTruthy();
        const ids = await clearWidgets(page);
        const first = ids.find((id) => id !== second);
        await openList(page);

        await page.locator('[data-widget-catalogue]').click();
        await page.locator('[data-widget-option="notes"]').click();
        await page.locator('[data-widget-wizard-page]').selectOption(String(second));
        await page.locator('[data-widget-add="notes"]').click();

        await expect.poll(() => widgetTypes(page, second)).toEqual(['notes']);
        expect(await widgetTypes(page, first)).toEqual([]);
    });
});
