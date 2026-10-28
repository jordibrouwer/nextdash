// @ts-check
const { test, expect } = require('./fixtures');
const {
    dismissOnboardingIfPresent, dismissBlockingOverlays, waitForFaviconPrefetch,
    markWidgetsTutorialSeen, markConfigSettingPromosSeen,
} = require('./e2e-helpers');

/*
 * Each widget is a card that opens inline, one at a time, at every width.
 * Behaviour only -- which card is open and what it survives -- not pixels.
 * (The side panel the wide layout used to have is gone; the card layout itself
 * is in config-widget-cards.spec.js.)
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
const sheet = (page) => page.locator('#config-widget-overlay');
const title = (page) => sheet(page).locator('.config-widget-detail-title');

for (const width of [820, 1600]) {
    test.describe(`which widget is open, at ${width}px`, () => {
        test('nothing is open at first', async ({ page }) => {
            await openWithWidgets(page, width);
            await expect(page.locator('.config-widget-row.is-open')).toHaveCount(0);
            await expect(sheet(page)).toHaveCount(0);
        });

        test('deleting the open widget closes its sheet rather than opening a neighbour', async ({ page }) => {
            await openWithWidgets(page, width);
            await row(page, 'Processor').locator('[data-widget-settings]').click();
            await sheet(page).locator('[data-widget-delete]').click();
            await page.locator('#config-confirm-modal [data-confirm="ok"]').click();
            await expect(page.locator('.config-widget-row')).toHaveCount(2);
            await expect(sheet(page)).toHaveCount(0);
        });

        test('the sheet is about the widget chosen, whatever the list shows', async ({ page }) => {
            await openWithWidgets(page, width);
            await row(page, 'Notes').locator('[data-widget-settings]').click();
            await expect(title(page)).toContainText('Notes');
            // The sheet stays modal: the list behind it is not reachable until it closes.
            await sheet(page).locator('.config-widget-sheet-close').click();
            await page.locator('#config-widget-search').fill('mem');
            await expect(page.locator('.config-widget-row')).toHaveCount(1);
            await page.locator('#config-widget-search').fill('');
            await expect(page.locator('.config-widget-row')).toHaveCount(3);
        });

        test('a title half typed keeps its focus and text across a repaint', async ({ page }) => {
            await openWithWidgets(page, width);
            const field = row(page, 'Notes').locator('[data-widget="title"]');
            await field.click();
            // End scrolls on macOS rather than moving the caret; put it at the end.
            await field.evaluate((el) => el.setSelectionRange(el.value.length, el.value.length));
            await page.keyboard.type(' list');
            await page.evaluate(() => window.dashboardInstance.config.repaintWidgetsKeepingFocus());
            await expect(page.locator('[data-widget="title"]:focus')).toHaveValue('Notes list');
        });
    });
}

test.describe('sheets over several pages', () => {
    test('moving the open widget to another page closes its sheet', async ({ page }) => {
        const second = await openWithWidgets(page, 1600, { secondPage: true });
        expect(second).not.toBeNull();
        await row(page, 'Notes').locator('[data-widget-settings]').click();
        await sheet(page).locator('[data-widget-move-page]').selectOption(String(second));
        await expect(page.locator('.config-widget-row')).toHaveCount(2);
        await expect(sheet(page)).toHaveCount(0);
    });

    test('All pages: the sheet and its Delete act on the widget\'s own page', async ({ page }) => {
        const second = await openWithWidgets(page, 1600, { secondPage: true });
        expect(second).not.toBeNull();
        await page.locator('[data-widget-page]').selectOption('all');
        await expect(page.locator('.config-widget-row')).toHaveCount(4);
        await row(page, 'Memory').locator('[data-widget-settings]').click();
        await expect(title(page)).toContainText('Memory');
        await sheet(page).locator('.config-widget-sheet-close').click();
        await row(page, 'Elsewhere').locator('[data-widget-settings]').click();
        await expect(title(page)).toContainText('Elsewhere');
        await expect(sheet(page).locator('[data-widget-move-page]')).toHaveValue(String(second));

        await sheet(page).locator('[data-widget-delete]').click();
        await page.locator('#config-confirm-modal [data-confirm="ok"]').click();
        await expect(page.locator('.config-widget-row')).toHaveCount(3);
        await expect(sheet(page)).toHaveCount(0);

        const left = await page.evaluate(async (ids) => {
            const read = async (id) => (await (await fetch(`/api/pages/${id}/blocks`)).json()).widgets || [];
            return { first: (await read(ids.first)).map((w) => w.title), second: (await read(ids.second)).map((w) => w.title) };
        }, { first: await page.evaluate(() => window.dashboardInstance.pages[0].id), second });
        expect(left.second).not.toContain('Elsewhere');
        expect(left.first.sort()).toEqual(['Memory', 'Notes', 'Processor']);
    });

    test('switching page shows the new page with nothing open', async ({ page }) => {
        const second = await openWithWidgets(page, 1600, { secondPage: true });
        expect(second).not.toBeNull();
        await page.locator('[data-widget-page]').selectOption(String(second));
        await expect(page.locator('.config-widget-row')).toHaveCount(1);
        await expect(sheet(page)).toHaveCount(0);
    });
});

test.describe('the controls on a card say what they are', () => {
    test('select and shown are named after the widget, and shown says so in words', async ({ page }) => {
        await openWithWidgets(page, 820);
        const r = row(page, 'Memory');
        await expect(r.locator('[data-widget-pick]')).toHaveAttribute('aria-label', /Memory/);
        await expect(r.locator('[data-widget-enabled]')).toHaveAttribute('aria-label', /Memory/);
        const pick = await r.locator('[data-widget-pick]').getAttribute('aria-label');
        const shown = await r.locator('[data-widget-enabled]').getAttribute('aria-label');
        expect(pick).not.toBe(shown);
        await expect(r.locator('.config-widget-row-shown')).toContainText(/\S/);
    });

    test('Settings says it opens a dialog', async ({ page }) => {
        await openWithWidgets(page, 1600);
        const settings = row(page, 'Memory').locator('[data-widget-settings]');
        await expect(settings).toHaveAttribute('aria-haspopup', 'dialog');
        await expect(settings).toHaveAttribute('aria-expanded', 'false');
        await settings.click();
        await expect(settings).toHaveAttribute('aria-expanded', 'true');
        await expect(sheet(page)).toHaveAttribute('class', /config-widget-overlay/);
    });
});
