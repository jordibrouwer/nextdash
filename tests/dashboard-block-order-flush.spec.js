// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/*
 * A category moved with Alt+→ is saved a second later. Leaving the page in
 * that second lost the move: the timer read the page it fired on, not the one
 * the move was made on, and nothing flushed it on the way out.
 */
async function openDashboard(page) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
}

test('a block move is kept when the page is left within the debounce', async ({ page }) => {
    await openDashboard(page);
    await page.evaluate(async () => {
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        const list = await (await api('/api/pages')).json();
        if (list.some((p) => p.name === 'block-order-target')) return;
        const next = [...list, { id: Math.max(...list.filter((p) => p.id < 999999).map((p) => p.id)) + 1, name: 'block-order-target' }];
        await api('/api/pages', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(next) });
    });
    await openDashboard(page);
    const { pageId, other } = await page.evaluate(() => {
        const d = window.dashboardInstance;
        const pageId = Number(d.currentPageId);
        return { pageId, other: d.pages.map((p) => Number(p.id)).find((id) => id !== pageId && id !== 999999) };
    });
    // In the order the page arranges them, which the grid's columns do not
    // show in DOM order.
    const ids = await page.evaluate(() => {
        const d = window.dashboardInstance;
        const cats = new Set((d.categories || []).map((c) => String(c.id)));
        const order = (d.blockOrder || []).filter((id) => cats.has(String(id)));
        return order.length ? order : [...cats];
    });
    expect(ids.length, 'needs two categories').toBeGreaterThanOrEqual(2);

    const title = page.locator(`.category[data-category-id="${ids[0]}"] .category-title`).first();
    await title.focus();
    await page.keyboard.press('Alt+ArrowRight');
    // Straight away, well inside the one-second debounce.
    await page.evaluate((id) => window.dashboardInstance.loadPageBookmarks(id), other);

    await expect.poll(async () => page.evaluate(async (pid) => {
        const res = await fetch(`/api/pages/${pid}/blocks`);
        const body = await res.json();
        return body.order || [];
    }, pageId), { timeout: 10_000 }).toEqual(expect.arrayContaining([ids[1], ids[0]]));
    const order = await page.evaluate(async (pid) => (await (await fetch(`/api/pages/${pid}/blocks`)).json()).order, pageId);
    expect(order.indexOf(ids[1])).toBeLessThan(order.indexOf(ids[0]));
});

// When the new page's blocks do not arrive, the old page's widgets stay on
// screen (see dashboard-page-switch-widgets) -- but they are not this page's,
// and an edit must not write them over this page's own.
test('a failed blocks fetch on a page switch does not let an edit overwrite the new page', async ({ page }) => {
    await openDashboard(page);
    await page.evaluate(async () => {
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        const list = await (await api('/api/pages')).json();
        if (!list.some((p) => p.name === 'block-order-target')) {
            const next = [...list, { id: Math.max(...list.filter((p) => p.id < 999999).map((p) => p.id)) + 1, name: 'block-order-target' }];
            await api('/api/pages', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(next) });
        }
        const d = window.dashboardInstance;
        await api(`/api/pages/${d.currentPageId}/blocks`, {
            method: 'PUT', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ widgets: [{ type: 'health', title: 'Carried?' }] }),
        });
    });
    await openDashboard(page);
    const other = await page.evaluate(() => {
        const d = window.dashboardInstance;
        return d.pages.map((p) => Number(p.id)).find((id) => id !== Number(d.currentPageId) && id !== 999999);
    });
    expect(await page.evaluate(() => window.dashboardInstance.widgets.length)).toBeGreaterThan(0);

    await page.route(`**/api/pages/${other}/blocks`, (route) => (route.request().method() === 'GET'
        ? route.fulfill({ status: 500, body: 'nope' })
        : route.continue()));
    await page.evaluate((id) => window.dashboardInstance.loadPageBookmarks(id, { forceFetch: true }), other);
    await expect.poll(() => page.evaluate(() => Number(window.dashboardInstance.currentPageId))).toBe(other);
    const saved = await page.evaluate(async () => {
        const d = window.dashboardInstance;
        return d.renderCore.saveWidgetPatch(d.widgets[0].id, { title: 'Renamed on the wrong page' });
    });
    expect(saved).toBe(false);
    await page.unroute(`**/api/pages/${other}/blocks`);
    const stored = await page.evaluate(async (id) => (await (await fetch(`/api/pages/${id}/blocks`)).json()).widgets || [], other);
    expect(stored).toHaveLength(0);
});

// A page with a widget and no bookmarks shows the widget, not "This page is empty".
test('a page with only widgets draws them', async ({ page }) => {
    await openDashboard(page);
    const target = await page.evaluate(async () => {
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        const list = await (await api('/api/pages')).json();
        let p = list.find((x) => x.name === 'widgets-only');
        if (!p) {
            p = { id: Math.max(...list.filter((x) => x.id < 999999).map((x) => x.id)) + 1, name: 'widgets-only' };
            await api('/api/pages', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify([...list, p]) });
        }
        await api(`/api/pages/${p.id}/blocks`, {
            method: 'PUT', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ widgets: [{ type: 'health', title: 'Only widget' }] }),
        });
        return p.id;
    });
    await openDashboard(page);
    await page.evaluate((id) => window.dashboardInstance.loadPageBookmarks(id, { forceFetch: true }), target);
    await expect(page.locator('#dashboard-layout .category[data-widget-id]')).toHaveCount(1);
    await expect(page.locator('#dashboard-layout .empty-state')).toHaveCount(0);
});


// Other (bookmarks without a category, or with one that no longer exists) is
// built last and stays last under a stored order; the smart collections stay
// first. Lumped together, Other jumped above every category the reader
// arranged -- where the manual says it sits at the end.
test('the block order keeps the virtual categories at the end', async ({ page }) => {
    await openDashboard(page);
    const ids = await page.evaluate(() => {
        const d = window.dashboardInstance;
        const saved = d.blockOrder;
        d.blockOrder = ['b', 'a'];
        const blocks = [
            { category: { id: '__smart_today', isSmartCollection: true } },
            { category: { id: 'a' } },
            { category: { id: 'b' } },
            { category: { id: '', isVirtualCategory: true } },
        ];
        const out = d.renderCore.applyBlockOrder(blocks).map((b) => b.category.id);
        d.blockOrder = saved;
        return out;
    });
    expect(ids).toEqual(['__smart_today', 'b', 'a', '']);
});
