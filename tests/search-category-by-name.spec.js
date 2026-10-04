// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissBlockingOverlays, dismissOnboardingIfPresent } = require('./e2e-helpers');

/**
 * A bookmark holds its category's id ("cat_mrjjzqik_o2rt0"), never the name.
 * `category:` and `:open category` compared against it as if it were the name:
 * "category:vps" found nothing, and the completions read out the raw ids.
 */
test('category: and :open category go by the category\'s name', async ({ page }) => {
    const stamp = Date.now().toString(36);
    const catId = `cat_${stamp}_e2e`;
    const catName = `Vps ${stamp}`;
    const url = `https://vps-${stamp}.example.test`;
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('.bookmark-link', { timeout: 15_000 });
    const pageId = await page.evaluate(() => Number(window.dashboardInstance.currentPageId));
    await page.evaluate(async ({ pid, id, name, u }) => {
        const cats = await (await fetch(`/api/categories?page=${pid}`)).json();
        await nextDashFetch(`/api/categories?page=${pid}`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify([...cats, { id, name }]),
        });
        const res = await nextDashFetch('/api/bookmarks/add', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ page: pid, bookmark: { name: `Server ${name}`, url: u, category: id } }),
        });
        if (!res.ok) throw new Error(`seed ${res.status}`);
    }, { pid: pageId, id: catId, name: catName, u: url });
    try {
        await page.reload();
        await page.waitForSelector('.bookmark-link', { timeout: 15_000 });
        await dismissOnboardingIfPresent(page);
        await dismissBlockingOverlays(page);
        const names = () => page.evaluate(() => (window.dashboardInstance.searchComponent?.searchMatches || [])
            .map((m) => m.bookmark?.name || m.name));
        await page.keyboard.press('>');
        await expect.poll(() => page.evaluate(() => Boolean(window.dashboardInstance?.searchComponent?.isActive?.()))).toBe(true);
        await page.keyboard.type(`category:vps-${stamp}`);
        await expect.poll(names, { timeout: 10_000 }).toContain(`Server ${catName}`);
        // The rows `:open category <name>` offers.
        const rows = await page.evaluate((name) => {
            const d = window.dashboardInstance;
            return (d.searchComponent.commandsComponent._openCategoryRows(d, name) || []).map((r) => r.name);
        }, catName);
        expect(rows.join(' | ')).not.toMatch(/No bookmarks in/);
    } finally {
        await page.evaluate(async ({ pid, id, u }) => {
            await nextDashFetch('/api/bookmarks', {
                method: 'DELETE', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ page: pid, bookmark: { url: u } }),
            });
            const cats = await (await fetch(`/api/categories?page=${pid}`)).json();
            await nextDashFetch(`/api/categories?page=${pid}`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(cats.filter((c) => c.id !== id)),
            });
        }, { pid: pageId, id: catId, u: url });
    }
});
