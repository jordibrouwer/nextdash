// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * A widget on every page: the edit panel's "Show on pages" switch puts a copy of
 * the widget on each other page, and switching it off takes them away again.
 */
test.use({ viewport: { width: 1500, height: 950 }, hasTouch: false, isMobile: false });

async function load(page) {
    await markWhatsNewSeen(page);
    await page.route((url) => !['localhost', '127.0.0.1'].includes(url.hostname), (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<html></html>' }));
    await page.goto('/');
    await page.waitForSelector('.bookmark-link', { timeout: 20_000 });
    await page.waitForFunction(() => window.dashboardInstance?.editMode, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
}

/** What the server holds for each page: does it carry this widget, and as an everywhere copy? */
const holders = (page, widgetId) => page.evaluate(async (id) => {
    const pages = await (await fetch('/api/pages', { cache: 'no-store' })).json();
    const out = {};
    for (const p of pages.filter((x) => !x.hidden)) {
        const blocks = await (await fetch(`/api/pages/${p.id}/blocks`, { cache: 'no-store' })).json();
        const found = (blocks.widgets || []).find((w) => w.id === id);
        out[p.id] = found ? { everywhere: found.everywhere === true, ordered: (blocks.order || []).includes(id) } : null;
    }
    return out;
}, widgetId);

test('the switch puts a copy on every other page and off removes them', async ({ page }) => {
    await load(page);
    // Its own page and widget, so the shared data dir is left as it was.
    const made = await page.evaluate(async () => {
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        const headers = { 'Content-Type': 'application/json', ...(typeof nextDashWriteHeaders === 'function' ? nextDashWriteHeaders() : {}) };
        const list = await (await api('/api/pages')).json();
        const extra = Math.max(...list.filter((p) => p.id < 999999).map((p) => p.id)) + 1;
        await api('/api/pages', { method: 'POST', headers, body: JSON.stringify([...list, { id: extra, name: 'Everywhere spare' }]) });
        const home = window.dashboardInstance.currentPageId;
        const blocks = await (await api(`/api/pages/${home}/blocks`)).json();
        const saved = await (await api(`/api/pages/${home}/blocks`, {
            method: 'PUT', headers,
            body: JSON.stringify({ widgets: [...(blocks.widgets || []), { type: 'notes', title: 'Everywhere probe', config: { text: 'hello' } }] }),
        })).json();
        const widget = saved.widgets.find((w) => w.title === 'Everywhere probe');
        return { home: String(home), extra: String(extra), id: widget.id };
    });
    try {
        await page.reload();
        await page.waitForSelector('.bookmark-link', { timeout: 20_000 });
        await page.waitForFunction(() => window.dashboardInstance?.editMode, null, { timeout: 15_000 });
        await dismissBlockingOverlays(page);
        await page.keyboard.press('Shift+E');
        await expect(page.locator('body')).toHaveAttribute('data-edit-mode', 'on');
        await page.locator(`#dashboard-layout .category.dashboard-widget[data-widget-id="${made.id}"] .category-title`).first().click();

        await page.locator('[data-edit-everywhere="true"]').click();
        await expect(page.locator('[data-edit-everywhere="true"]')).toHaveAttribute('aria-pressed', 'true');
        const on = await holders(page, made.id);
        expect(on[made.home]).toEqual({ everywhere: true, ordered: true });
        expect(on[made.extra]).toEqual({ everywhere: true, ordered: true });

        await page.locator('[data-edit-everywhere="false"]').click();
        await expect(page.locator('[data-edit-everywhere="false"]')).toHaveAttribute('aria-pressed', 'true');
        const off = await holders(page, made.id);
        expect(off[made.home]).toEqual({ everywhere: false, ordered: true });
        expect(off[made.extra]).toBeNull();
    } finally {
        await page.evaluate(async ({ home, extra, id }) => {
            const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
            const headers = { 'Content-Type': 'application/json', ...(typeof nextDashWriteHeaders === 'function' ? nextDashWriteHeaders() : {}) };
            const blocks = await (await api(`/api/pages/${home}/blocks`)).json();
            await api(`/api/pages/${home}/blocks`, { method: 'PUT', headers, body: JSON.stringify({ widgets: (blocks.widgets || []).filter((w) => w.id !== id).map((w) => ({ ...w, everywhere: false })) }) });
            await api(`/api/pages/${extra}`, { method: 'DELETE', headers });
        }, made).catch(() => {});
    }
});
