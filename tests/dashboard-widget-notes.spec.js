// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissBlockingOverlays, dismissOnboardingIfPresent } = require('./e2e-helpers');

/**
 * The notes widget: text of your own, with tickable lines.
 */

async function open(page) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
}

/** Put one notes widget on the current page, through the API the dashboard uses. */
async function addNotes(page, text) {
    return page.evaluate(async (initial) => {
        const d = window.dashboardInstance;
        const pageId = Number(d.currentPageId);
        const before = Array.isArray(d.widgets) ? d.widgets : [];
        const widgets = [...before.filter((w) => w.type !== 'notes'),
            { id: 'w_notes_e2e', type: 'notes', title: 'Notes e2e', config: initial ? { text: initial } : {} }];
        const headers = { 'Content-Type': 'application/json' };
        if (typeof nextDashWriteHeaders === 'function') Object.assign(headers, nextDashWriteHeaders());
        const res = await fetch(`/api/pages/${pageId}/blocks`, { method: 'PUT', headers, body: JSON.stringify({ widgets }) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return pageId;
    }, text);
}

async function storedText(page, pageId) {
    return page.evaluate(async (id) => {
        const res = await fetch(`/api/pages/${id}/blocks`, { cache: 'no-store' });
        const body = await res.json();
        const w = (body.widgets || []).find((x) => x.type === 'notes');
        return w?.config?.text ?? null;
    }, pageId);
}

async function removeNotes(page, pageId) {
    await page.evaluate(async (id) => {
        const res = await fetch(`/api/pages/${id}/blocks`, { cache: 'no-store' });
        const body = await res.json();
        const widgets = (body.widgets || []).filter((x) => x.type !== 'notes');
        const headers = { 'Content-Type': 'application/json' };
        if (typeof nextDashWriteHeaders === 'function') Object.assign(headers, nextDashWriteHeaders());
        await fetch(`/api/pages/${id}/blocks`, { method: 'PUT', headers, body: JSON.stringify({ widgets }) });
    }, pageId);
}

test.describe('the notes widget', () => {
    test('it is offered and has a renderer', async ({ page }) => {
        await open(page);
        const state = await page.evaluate(async () => {
            await window.dashboardInstance.config?.load?.();
            const Config = window.DashboardConfig || window.dashboardInstance.config?.instance?.constructor;
            return { offered: [...(Config?.WIDGET_TYPES || [])], renderer: typeof window.DashboardWidgets?.notes };
        });
        expect(state.offered).toContain('notes');
        expect(state.renderer).toBe('function');
    });

    test('lines with [ ] and [x] are checkboxes, and ticking one saves that line', async ({ page }) => {
        await open(page);
        const pageId = await addNotes(page, '[ ] close port 8443\n[x] replace disk\nplain line');
        try {
            await page.reload();
            await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
            const tile = page.locator('.dashboard-widget[data-widget-id="w_notes_e2e"]');
            await expect(tile.locator('input[type="checkbox"]')).toHaveCount(2);
            await expect(tile.locator('input[type="checkbox"]').nth(0)).not.toBeChecked();
            await expect(tile.locator('input[type="checkbox"]').nth(1)).toBeChecked();
            await expect(tile.locator('.dashboard-widget-note-text')).toHaveText('plain line');

            await tile.locator('input[type="checkbox"]').nth(0).check();
            await expect.poll(() => storedText(page, pageId))
                .toBe('[x] close port 8443\n[x] replace disk\nplain line');
        } finally {
            await removeNotes(page, pageId);
        }
    });

    // The text can change under a drawn tile (another tab): ticking finds its
    // line by what it says, not by where it was.
    test('ticking after the text changed elsewhere ticks the same line', async ({ page }) => {
        await open(page);
        const pageId = await addNotes(page, '[ ] close port 8443\n[ ] replace disk');
        try {
            await page.reload();
            await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
            const tile = page.locator('.dashboard-widget[data-widget-id="w_notes_e2e"]');
            await expect(tile.locator('input[type="checkbox"]')).toHaveCount(2);
            await page.evaluate(() => {
                const w = window.dashboardInstance.widgets.find((x) => x.id === 'w_notes_e2e');
                w.config = { ...w.config, text: 'new first line\n[ ] close port 8443\n[ ] replace disk' };
            });
            await tile.locator('input[type="checkbox"]').nth(1).check();
            await expect.poll(() => storedText(page, pageId))
                .toBe('new first line\n[ ] close port 8443\n[x] replace disk');
        } finally {
            await removeNotes(page, pageId);
        }
    });

    test('Edit opens a textarea; Ctrl+Enter saves and Escape cancels', async ({ page }) => {
        await open(page);
        const pageId = await addNotes(page, '');
        try {
            await page.reload();
            await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
            const tile = page.locator('.dashboard-widget[data-widget-id="w_notes_e2e"]');
            await tile.locator('.dashboard-widget-note-edit').click();
            const area = tile.locator('textarea');
            await area.fill('[ ] first\nsecond');
            await area.press('Control+Enter');
            await expect.poll(() => storedText(page, pageId)).toBe('[ ] first\nsecond');
            await expect(tile.locator('input[type="checkbox"]')).toHaveCount(1);

            await tile.locator('.dashboard-widget-note-edit').click();
            await tile.locator('textarea').fill('thrown away');
            await tile.locator('textarea').press('Escape');
            await expect(tile.locator('textarea')).toHaveCount(0);
            expect(await storedText(page, pageId)).toBe('[ ] first\nsecond');
        } finally {
            await removeNotes(page, pageId);
        }
    });
});
