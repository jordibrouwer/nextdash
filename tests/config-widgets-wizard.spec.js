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
    // Opens the module arrange() needs; it reopens the list once it is done.
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

/**
 * Leave the install with exactly `count` pages and no widgets on any of
 * them, whatever an earlier test (or an earlier run of this one) left behind.
 * Pages are trimmed through the route that removes one and grown through the
 * Config button that adds one, then waited for by asking.
 */
async function arrange(page, count) {
    await page.evaluate(async (want) => {
        const f = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        const headers = {
            'Content-Type': 'application/json',
            ...(typeof nextDashWriteHeaders === 'function' ? nextDashWriteHeaders() : {}),
        };
        const d = window.dashboardInstance;
        for (const p of d.pages.slice(want)) {
            await f(`/api/pages/${p.id}`, { method: 'DELETE', headers });
        }
        await d.loadData();
        const cfg = d.config._module;
        while (d.pages.length < want) {
            const had = d.pages.length;
            await cfg.addPage();
            const until = Date.now() + 10_000;
            while (d.pages.length <= had && Date.now() < until) await new Promise((r) => setTimeout(r, 50));
            if (d.pages.length <= had) throw new Error('a page was not added');
        }
    }, count);
    await expect.poll(() => page.evaluate(() => window.dashboardInstance.pages.length)).toBe(count);
    const ids = await clearWidgets(page);
    // Reload the list so it reads what is stored now, not what it held.
    await page.evaluate(async (first) => {
        const cfg = window.dashboardInstance.config._module;
        cfg._widgetBlocks = null;
        cfg._widgetLoadedFor = null;
        cfg._widgetPageId = first;
        await cfg.loadWidgetsEditor();
    }, ids[0]);
    await openList(page);
    return ids;
}

test.describe('the add picker names a page', () => {
    test('a one-page install shows no page select', async ({ page }) => {
        await openWidgets(page);
        const [only] = await arrange(page, 1);

        await page.locator('[data-widget-catalogue]').click();
        await page.locator('[data-widget-option="notes"]').click();
        await expect(page.locator('[data-widget-add="notes"]')).toBeVisible();
        await expect(page.locator('[data-widget-wizard-page]')).toHaveCount(0);
        await page.locator('[data-widget-add="notes"]').click();

        await expect.poll(() => widgetTypes(page, only)).toEqual(['notes']);
    });

    test('the picker names a page, and the widget lands on it', async ({ page }) => {
        await openWidgets(page);
        const [first, second] = await arrange(page, 2);

        await page.locator('[data-widget-catalogue]').click();
        await page.locator('[data-widget-option="notes"]').click();
        await page.locator('[data-widget-wizard-page]').selectOption(String(second));
        // Highlighting another kind redraws the preview; the choice stays.
        await page.locator('[data-widget-option="health"]').click();
        await page.locator('[data-widget-option="notes"]').click();
        await expect(page.locator('[data-widget-wizard-page]')).toHaveValue(String(second));
        await page.locator('[data-widget-add="notes"]').click();

        await expect.poll(() => widgetTypes(page, second)).toEqual(['notes']);
        expect(await widgetTypes(page, first)).toEqual([]);
    });

    test('from the all-pages view the widget lands on the page named, and the list follows', async ({ page }) => {
        await openWidgets(page);
        const [first, second] = await arrange(page, 2);

        // The way a reader gets there: the list's own page select.
        await page.locator('[data-widget-page]').selectOption('all');
        await expect.poll(() => page.evaluate(
            () => window.dashboardInstance.config._module.isAllPagesView())).toBe(true);

        await page.locator('[data-widget-catalogue]').click();
        await page.locator('[data-widget-option="notes"]').click();
        await page.locator('[data-widget-wizard-page]').selectOption(String(second));
        await page.locator('[data-widget-add="notes"]').click();

        await expect.poll(() => widgetTypes(page, second)).toEqual(['notes']);
        expect(await widgetTypes(page, first)).toEqual([]);
        // The list moved to the page it was added to, off the all-pages view.
        await expect.poll(() => page.evaluate(() => {
            const cfg = window.dashboardInstance.config._module;
            return [cfg.isAllPagesView(), cfg._widgetPageId];
        })).toEqual([false, second]);
    });
});
