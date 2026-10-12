// @ts-check
const { test, expect } = require('./fixtures');
const {
    markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays, waitForFaviconPrefetch,
    markWidgetsTutorialSeen,
} = require('./e2e-helpers');

/**
 * Widgets has three tabs, like the other sections: the ones you have, every
 * kind there is (drawn, so a reader can look before adding), and the Custom
 * widget at length. Each tab has its line under the strip.
 */
async function openWidgetsSection(page, { widgets = [] } = {}) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    // Quickstart's background favicon sweep reopens Overview when it finishes;
    // this returns the moment that sweep is done.
    await waitForFaviconPrefetch(page);
    await markWidgetsTutorialSeen(page);
    await page.evaluate(async (list) => {
        const f = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        const headers = { 'Content-Type': 'application/json',
            ...(typeof nextDashWriteHeaders === 'function' ? nextDashWriteHeaders() : {}) };
        const dash = window.dashboardInstance;
        await f(`/api/pages/${dash.pages[0].id}/blocks`, { method: 'PUT', headers, body: JSON.stringify({ widgets: list }) });
        await dash.config.openConfigView('widgets');
    }, widgets);
    await expect(page.locator('#config-widgets-body')).toBeVisible();
}

const tab = (page, name) => page.locator(`[data-widgets-tab="${name}"]`);

test.describe('the Widgets section has three tabs', () => {
    test('a strip of three, opening on your widgets, each with its own line', async ({ page }) => {
        await openWidgetsSection(page);
        await expect(page.locator('[data-widgets-tab]')).toHaveCount(3);
        await expect(tab(page, 'widgets')).toHaveAttribute('aria-selected', 'true');

        const notes = new Set();
        for (const name of ['widgets', 'catalogue', 'custom']) {
            await tab(page, name).click();
            await expect(tab(page, name)).toHaveAttribute('aria-selected', 'true');
            // The first tab is the section's own address; the others are named.
            await expect(page).toHaveURL(new RegExp(name === 'widgets'
                ? '#config/widgets$' : `#config/widgets/${name}$`));
            const note = page.locator('.config-tab-note');
            await expect(note).toHaveCount(1);
            notes.add((await note.textContent() || '').trim());
        }
        // A line per tab, not one line repeated.
        expect(notes.size).toBe(3);
    });

    test('an old link to the Types tab opens the Catalogue', async ({ page }) => {
        await markWhatsNewSeen(page);
        await page.goto('/#config/widgets/types');
        await page.waitForFunction(() => !!window.dashboardInstance?.config, null, { timeout: 15_000 });
        await expect(page.locator('.config-widget-kinds')).toBeVisible();
        await expect(tab(page, 'catalogue')).toHaveAttribute('aria-selected', 'true');
    });
});

test.describe('the Catalogue tab', () => {
    test('draws every kind, each with an example and its own Add', async ({ page }) => {
        await openWidgetsSection(page);
        await tab(page, 'catalogue').click();
        const grouped = await page.evaluate(() => window.DashboardConfig.WIDGET_TYPE_GROUPS
            .reduce((n, [, types]) => n + types.length, 0));
        // +1: the Custom widget, in a group of its own at the end. The New
        // strip on top repeats kinds that are also in their own group.
        const cards = page.locator('.config-widget-kind-group:not(.config-widget-kind-group--new) .config-widget-kind');
        await expect(cards).toHaveCount(grouped + 1);
        await expect(page.locator('.config-widget-kind:not(:has(.config-widget-kind-sample))')).toHaveCount(0);
        await expect(page.locator('.config-widget-kind:not(:has([data-widget-add]))')).toHaveCount(0);
    });

    test('says how many of a kind the page already has', async ({ page }) => {
        await openWidgetsSection(page, { widgets: [
            { type: 'cpu', title: 'One', config: {} },
            { type: 'cpu', title: 'Two', config: {} },
        ] });
        await tab(page, 'catalogue').click();
        await expect(page.locator('[data-widget-kind="cpu"] .config-widget-kind-have')).toContainText('2');
        await expect(page.locator('[data-widget-kind="memory"] .config-widget-kind-have')).toHaveCount(0);
    });

    test('a chip narrows it to one group, and All brings the rest back', async ({ page }) => {
        await openWidgetsSection(page);
        await tab(page, 'catalogue').click();
        const total = await page.locator('.config-widget-kind').count();
        await page.locator('[data-widget-kind-filter="system"]').click();
        const system = await page.evaluate(() => window.DashboardConfig.WIDGET_TYPE_GROUPS
            .find(([group]) => group === 'system')[1].length);
        await expect(page.locator('.config-widget-kind')).toHaveCount(system);
        await expect(page.locator('[data-widget-kind-filter="system"]')).toHaveAttribute('aria-pressed', 'true');
        await page.locator('[data-widget-kind-filter="all"]').click();
        await expect(page.locator('.config-widget-kind')).toHaveCount(total);
    });

    test('Add lands on Your widgets with the new one open', async ({ page }) => {
        await openWidgetsSection(page);
        await tab(page, 'catalogue').click();
        await page.locator('[data-widget-kind="memory"] [data-widget-add]').click();
        await expect(tab(page, 'widgets')).toHaveAttribute('aria-selected', 'true');
        await expect(page).toHaveURL(/#config\/widgets$/);
        await expect(page.locator('.config-widget-row')).toHaveCount(1);
        await expect(page.locator('.config-widget-row')).toHaveClass(/is-open/);
        await expect(page.locator('.config-widget-row [data-widget="title"]')).toBeFocused();
    });

    test('How it works on the Custom card opens the Custom widget tab', async ({ page }) => {
        await openWidgetsSection(page);
        await tab(page, 'catalogue').click();
        await page.locator('[data-widget-kind="custom"] [data-widgets-goto="custom"]').click();
        await expect(tab(page, 'custom')).toHaveAttribute('aria-selected', 'true');
    });
});

test.describe('the Custom widget tab', () => {
    test('shows where a figure comes from, what it can do, and adds one', async ({ page }) => {
        await openWidgetsSection(page);
        await tab(page, 'custom').click();
        // The picture: service, answer, tile.
        await expect(page.locator('.config-widget-custom-node')).toHaveCount(3);
        await expect(page.locator('.config-widget-custom-card')).toHaveCount(6);
        const presets = await page.evaluate(() => window.DashboardWidgetPresets?.serviceCount?.() || 0);
        if (presets) {
            await expect(page.locator('.config-widget-custom-preset').first()).toBeVisible();
        }
        await page.locator('.config-widget-custom-how [data-widget-add="custom"]').click();
        await expect(tab(page, 'widgets')).toHaveAttribute('aria-selected', 'true');
        await expect(page.locator('.config-widget-row')).toHaveCount(1);
    });
});
