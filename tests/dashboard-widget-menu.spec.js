// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * A widget answers its header, the way the categories beside it do.
 *
 * Renaming one, making it two columns wide and putting it away were three trips
 * through Config → Widgets — for a block sitting under the pointer with a header
 * that already folds it. The menu writes the same fields that panel writes, so
 * the change has to be there when the reader opens it: that is what these tests
 * assert, not merely that the grid redrew.
 */

async function dashboardWithAWidget(page) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.evaluate(async () => {
        const f = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        const h = {
            'Content-Type': 'application/json',
            ...(typeof nextDashWriteHeaders === 'function' ? nextDashWriteHeaders() : {}),
        };
        await f('/api/pages/1/blocks', { method: 'PUT', headers: h, body: JSON.stringify({
            widgets: [{ type: 'health', title: 'Status' }] }) });
    });
    await page.reload({ waitUntil: 'networkidle' });
    await expect(page.locator('.dashboard-widget[data-widget-type="health"]')).toBeVisible({ timeout: 15_000 });
}

/** The stored widget, as Config → Widgets will read it when it next loads. */
async function storedWidget(page) {
    return page.evaluate(async () => {
        const res = await fetch('/api/pages/1/blocks');
        const data = await res.json();
        return (data.widgets || [])[0] || null;
    });
}

/** Whether the config panel is still holding a copy from before the change. */
async function configCacheCleared(page) {
    return page.evaluate(() => {
        const config = window.dashboardInstance.config?.instance || window.dashboardInstance.config;
        return config._widgetBlocks == null && config._widgetLoadedFor == null;
    });
}

const header = (page) => page.locator('.dashboard-widget[data-widget-type="health"] .category-title');

async function openMenu(page) {
    await header(page).click({ button: 'right' });
    const menu = page.locator('#widget-context-menu');
    await expect(menu).toBeVisible({ timeout: 10_000 });
    return menu;
}

test.describe('the widget header carries its own actions', () => {
    test('renaming from the menu reaches Config → Widgets', async ({ page }) => {
        await dashboardWithAWidget(page);
        const menu = await openMenu(page);
        await menu.locator('[data-action="rename"]').click();

        const input = page.locator('.dashboard-widget .category-rename-input');
        await expect(input).toBeVisible({ timeout: 10_000 });
        await input.fill('Uptime board');
        await input.press('Enter');

        await expect.poll(async () => (await storedWidget(page))?.title, { timeout: 15_000 })
            .toBe('Uptime board');
        await expect(header(page)).toContainText('uptime board');
    });

    test('an emptied title falls back to the type name rather than an empty header', async ({ page }) => {
        await dashboardWithAWidget(page);
        await header(page).press('F2');
        const input = page.locator('.dashboard-widget .category-rename-input');
        await expect(input).toBeVisible({ timeout: 10_000 });
        await input.fill('');
        await input.press('Enter');

        // Empty is a valid title for a widget — Config → Widgets has always said
        // so with its placeholder — and the header shows the type instead.
        await expect.poll(async () => (await storedWidget(page))?.title ?? '', { timeout: 15_000 }).toBe('');
        await expect(header(page)).not.toHaveText(/^\s*\/\/\s*$/);
    });

    test('the width entry writes the same columns setting the panel writes', async ({ page }) => {
        await dashboardWithAWidget(page);
        const menu = await openMenu(page);
        await menu.locator('[data-action="width"]').click();

        await expect.poll(async () => (await storedWidget(page))?.config?.columns, { timeout: 15_000 })
            .toBe(2);
        const block = page.locator('.dashboard-widget[data-widget-type="health"]');
        await expect(block).toHaveClass(/category--wide/);

        // And back, from the keyboard this time.
        await header(page).press('Shift+W');
        await expect.poll(async () => (await storedWidget(page))?.config?.columns, { timeout: 15_000 })
            .toBe(undefined);
        await expect(block).not.toHaveClass(/category--wide/);
    });

    test('closing takes it off the page and switches Shown off', async ({ page }) => {
        await dashboardWithAWidget(page);
        const menu = await openMenu(page);
        await menu.locator('[data-action="close"]').click();

        await expect(page.locator('.dashboard-widget[data-widget-type="health"]')).toHaveCount(0, { timeout: 15_000 });
        // Closed, not deleted: the widget is still there with its settings, with
        // the flag the Shown switch reads turned off.
        const stored = await storedWidget(page);
        expect(stored).not.toBe(null);
        expect(stored.config.enabled).toBe(false);
        // And the panel is not left holding the rows as they were, which is what
        // would otherwise show Shown still ticked when config is next opened.
        expect(await configCacheCleared(page)).toBe(true);
    });

    test('undo puts it back', async ({ page }) => {
        await dashboardWithAWidget(page);
        const menu = await openMenu(page);
        await menu.locator('[data-action="close"]').click();
        await expect(page.locator('.dashboard-widget[data-widget-type="health"]')).toHaveCount(0, { timeout: 15_000 });

        await page.locator('.app-notification-action').click();

        await expect(page.locator('.dashboard-widget[data-widget-type="health"]')).toBeVisible({ timeout: 15_000 });
        await expect.poll(async () => (await storedWidget(page))?.config?.enabled, { timeout: 15_000 })
            .toBe(undefined);
    });
});

/*
The panel itself, opened the way a reader opens it.

The assertions above read the server, which is where the change has to land;
this one reads the three controls in Config → Widgets, which is where the reader
looks — and it is the case a stale panel cache would fail while every other test
here passed.
*/
test('Config → Widgets shows the title, the width and the switch the header set', async ({ page }) => {
    await dashboardWithAWidget(page);

    await header(page).press('F2');
    const input = page.locator('.dashboard-widget .category-rename-input');
    await expect(input).toBeVisible({ timeout: 10_000 });
    await input.fill('Board');
    await input.press('Enter');
    await expect.poll(async () => (await storedWidget(page))?.title, { timeout: 15_000 }).toBe('Board');

    await header(page).press('Shift+W');
    await expect.poll(async () => (await storedWidget(page))?.config?.columns, { timeout: 15_000 }).toBe(2);

    await header(page).press('Delete');
    await expect(page.locator('.dashboard-widget[data-widget-type="health"]')).toHaveCount(0, { timeout: 15_000 });

    await page.evaluate(async () => {
        await window.dashboardInstance.config.openConfigView('widgets');
    });
    const row = page.locator('.config-widget-row').first();
    await expect(row).toBeVisible({ timeout: 15_000 });
    await expect(row.locator('.config-widget-row-title')).toHaveValue('Board');
    await expect(row.locator('[data-widget-enabled]')).not.toBeChecked();

    await row.locator('[data-widget-settings]').click();
    await expect(row.locator('[data-widget-setting="columns"]')).toHaveValue('2', { timeout: 10_000 });
});
