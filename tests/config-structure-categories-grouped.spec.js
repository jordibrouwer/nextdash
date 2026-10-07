// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissBlockingOverlays, dismissOnboardingIfPresent, WRITE_TOKEN } = require('./e2e-helpers');

async function openCategories(page) {
    await page.setViewportSize({ width: 1280, height: 900 });
    await markWhatsNewSeen(page);
    await page.goto(`/?_=${Date.now()}#config/structure`);
    await dismissBlockingOverlays(page);
    await page.locator('[data-pt-tab="categories"]').click();
    await page.waitForSelector('#config-pt-body [data-cat-row]', { timeout: 15_000 });
}

const auth = { 'X-NextDash-Token': WRITE_TOKEN };

/**
 * A second page with three categories holding 0, 2 and 1 bookmarks: fixture
 * setup over the API, not the thing under test.
 */
async function seedSecondPage(page) {
    const pages = await (await page.request.get('/api/pages')).json();
    const maxId = Math.max(0, ...pages.filter((p) => Number(p.id) < 999999).map((p) => Number(p.id) || 0));
    const id = maxId + 1;
    await page.request.post('/api/pages', { data: [...pages, { id, name: 'Zulu side' }], headers: auth });
    await page.request.post(`/api/categories?page=${id}`, {
        data: [{ id: 'alpha', name: 'Alpha' }, { id: 'beta', name: 'Beta' }, { id: 'gamma', name: 'Gamma' }],
        headers: auth,
    });
    const stamp = Date.now();
    for (const [category, n] of [['beta', 1], ['beta', 2], ['gamma', 3]]) {
        await page.request.post('/api/bookmarks/add', {
            data: { page: id, bookmark: { name: `${category} ${n}`, url: `https://grouped-${stamp}-${n}.example/`, category } },
            headers: auth,
        });
    }
    return String(id);
}

test.describe('Structure → Categories', () => {
    test('maintains categories and no longer orders them', async ({ page }) => {
        await openCategories(page);
        const body = page.locator('#config-pt-body');
        await expect(body.locator('[data-cat-move]')).toHaveCount(0);
        await expect(body.locator('.config-structure-grip')).toHaveCount(0);
        await expect(body.locator('.config-widget-category-name')).toHaveCount(0);
        await expect(body.locator('[data-pt-sort="categories"] option[value="manual"]')).toHaveCount(0);
        await expect(body).toContainText('drag // on the dashboard');
        await expect(body.locator('[data-cat-add]')).toHaveCount(1);
        await expect(body.locator('[data-cat-delete]').first()).toBeAttached();
    });

    test('every page in one table, grouped, filtered by chips', async ({ page }) => {
        await seedSecondPage(page);
        await openCategories(page);
        const body = page.locator('#config-pt-body');
        await expect(body.locator('[data-cat-page-select]')).toHaveCount(0);
        await expect(body.locator('select[data-cat-page]')).toHaveCount(0);
        const groups = body.locator('.structure-group-head');
        expect(await groups.count()).toBeGreaterThan(1);
        const chips = body.locator('[data-structure-chip="page"]');
        expect(await chips.count()).toBeGreaterThan(1);           // All + at least one page
        const second = chips.nth(1);
        const pageName = (await second.locator('.structure-chip-label').innerText()).trim();
        await second.click();
        await expect(body.locator('.structure-group-head')).toHaveCount(1);
        await expect(body.locator('.structure-group-head')).toContainText(pageName, { ignoreCase: true });
        await expect(body.locator('.structure-summary')).toContainText('categories');
    });

    test('a rename in a group saves to that page', async ({ page }) => {
        await seedSecondPage(page);
        await openCategories(page);
        const row = page.locator('#config-pt-body [data-cat-row]').last();
        const pageId = await row.getAttribute('data-cat-page');
        const input = row.locator('[data-cat="name"]');
        await input.fill('Renamed here');
        await input.press('Enter');
        await input.blur();
        await expect.poll(async () => page.evaluate(async (pid) => {
            const r = await fetch(`/api/categories?page=${pid}`);
            return (await r.json()).map((c) => c.name);
        }, pageId)).toContain('Renamed here');
    });

    test('Most bookmarks orders the rows within each group', async ({ page }) => {
        const pageId = await seedSecondPage(page);
        await openCategories(page);
        const body = page.locator('#config-pt-body');
        const names = () => body.locator(`[data-cat-row][data-cat-page="${pageId}"] [data-cat="name"]`)
            .evaluateAll((els) => els.map((el) => /** @type {HTMLInputElement} */ (el).value));
        await expect.poll(names).toEqual(['Alpha', 'Beta', 'Gamma']);
        await body.locator('[data-pt-sort="categories"]').selectOption('most');
        await expect.poll(names).toEqual(['Beta', 'Gamma', 'Alpha']);
    });

    test('a group head collapses and expands its page', async ({ page }) => {
        const pageId = await seedSecondPage(page);
        await openCategories(page);
        const body = page.locator('#config-pt-body');
        const head = body.locator(`[data-structure-group="${pageId}"] [data-structure-group-toggle]`);
        const rows = body.locator(`[data-cat-row][data-cat-page="${pageId}"]`);
        await expect(rows).toHaveCount(3);
        await expect(head).toHaveAttribute('aria-expanded', 'true');
        await head.click();
        await expect(rows).toHaveCount(0);
        await expect(body.locator(`[data-structure-group="${pageId}"] [data-structure-group-toggle]`)).toHaveAttribute('aria-expanded', 'false');
        await body.locator(`[data-structure-group="${pageId}"] [data-structure-group-toggle]`).press('Enter');
        await expect(rows).toHaveCount(3);
    });

    test('the Empty view keeps only categories without bookmarks', async ({ page }) => {
        const pageId = await seedSecondPage(page);
        await openCategories(page);
        const body = page.locator('#config-pt-body');
        await body.locator('[data-structure-chip="view"][data-value="empty"]').click();
        await expect(body.locator(`[data-cat-row][data-cat-page="${pageId}"] [data-cat="name"]`)).toHaveCount(1);
        await expect(body.locator(`[data-cat-row][data-cat-page="${pageId}"] [data-cat="name"]`)).toHaveValue('Alpha');
    });

    test('after toggling a group, ↓ then Enter edits the row, not the group', async ({ page }) => {
        const pageId = await seedSecondPage(page);
        await openCategories(page);
        const body = page.locator('#config-pt-body');
        const toggle = body.locator(`[data-structure-group-toggle="${pageId}"]`);
        await toggle.click();
        await expect(toggle).toHaveAttribute('aria-expanded', 'false');
        await expect(toggle).toBeFocused();
        await page.keyboard.press('ArrowDown');
        await page.keyboard.press('Enter');
        await expect(toggle).toHaveAttribute('aria-expanded', 'false');
        await expect.poll(() => page.evaluate(() => document.activeElement?.getAttribute('data-cat'))).toBe('name');
    });

    test('a page duplicated after the table loaded shows its own categories', async ({ page }) => {
        const pageId = await seedSecondPage(page);
        await openCategories(page);
        const body = page.locator('#config-pt-body');
        await expect(body.locator(`[data-cat-row][data-cat-page="${pageId}"]`)).toHaveCount(3);
        const before = await page.evaluate(() => window.dashboardInstance.pages.length);
        // The copy's categories are written after the copy is listed; held
        // back here so the Categories tab is opened in between every time.
        await page.route('**/api/categories?page=*', async (route) => {
            if (route.request().method() === 'POST') await new Promise((r) => setTimeout(r, 800));
            await route.continue();
        });
        await page.locator('[data-pt-tab="pages"]').click();
        await body.locator(`[data-page-duplicate="${pageId}"]`).click();
        // With its categories; then the bookmarks question, answered no.
        await page.locator('#config-confirm-modal [data-confirm="ok"]').click();
        await page.locator('#config-confirm-modal [data-confirm="cancel"]').click();
        await expect.poll(() => page.evaluate(() => window.dashboardInstance.pages.length)).toBe(before + 1);
        const copyId = await page.evaluate(() => String(window.dashboardInstance.pages.at(-1).id));
        await page.locator('[data-pt-tab="categories"]').click();
        const names = body.locator(`[data-cat-row][data-cat-page="${copyId}"] [data-cat="name"]`);
        await expect.poll(() => names.evaluateAll((els) => els.map((el) => /** @type {HTMLInputElement} */ (el).value)))
            .toEqual(['Alpha', 'Beta', 'Gamma']);
    });

    test('a category moved to another page on the dashboard shows there, and a rename there keeps it', async ({ page }) => {
        const pageId = await seedSecondPage(page);
        await openCategories(page);
        const body = page.locator('#config-pt-body');
        await expect(body.locator(`[data-cat-row][data-cat-page="${pageId}"]`)).toHaveCount(3);
        await page.evaluate(() => window.dashboardInstance.config.closeConfigView());
        const blockSel = '#dashboard-layout .category[data-category-id]:not([data-smart-collection="true"]):not([data-widget-id])';
        await page.waitForSelector(blockSel);
        await dismissOnboardingIfPresent(page);
        await dismissBlockingOverlays(page);
        const id = await page.locator(blockSel).first().getAttribute('data-category-id');
        // The dashboard's own path: the header menu's Move to page.
        await page.locator(`${blockSel}[data-category-id="${id}"] .category-title`).click({ button: 'right' });
        const menu = page.locator('#category-context-menu');
        await menu.locator('[data-action="move-page"]').click();
        await menu.locator(`[data-action="${pageId}"]`).click();
        await expect(page.locator('#app-notification.has-action')).toContainText('Zulu side');
        const onTarget = () => page.evaluate(async (pid) => (await (await fetch(`/api/categories?page=${pid}`)).json())
            .map((c) => c.id), pageId);
        await expect.poll(onTarget).toContain(id);

        await page.evaluate(() => window.dashboardInstance.config.openConfigView('structure'));
        await page.locator('[data-pt-tab="categories"]').click();
        await expect(body.locator(`[data-cat-row][data-cat-page="${pageId}"][data-cat-id="${id}"]`)).toHaveCount(1);
        const input = body.locator(`[data-cat-row][data-cat-page="${pageId}"] [data-cat="name"]`).first();
        await input.fill('Alpha renamed');
        await input.press('Enter');
        await input.blur();
        await expect.poll(async () => page.evaluate(async (pid) => (await (await fetch(`/api/categories?page=${pid}`)).json())
            .map((c) => c.name), pageId)).toContain('Alpha renamed');
        expect(await onTarget()).toContain(id);
    });

    test('a delete reached by keyboard removes the row from its own page', async ({ page }) => {
        const pageId = await seedSecondPage(page);
        await openCategories(page);
        const body = page.locator('#config-pt-body');
        // Focus the name, then Tab onto the row's buttons: no pointer involved.
        await body.locator(`[data-cat-row][data-cat-page="${pageId}"] [data-cat="name"]`).first().focus();
        const del = body.locator(`[data-cat-row][data-cat-page="${pageId}"] [data-cat-delete]`).first();
        await del.focus();
        await del.press('Enter');
        await page.locator('#config-confirm-modal [data-confirm="ok"]').click();
        await expect.poll(async () => page.evaluate(async (pid) => {
            const r = await fetch(`/api/categories?page=${pid}`);
            return (await r.json()).map((c) => c.name);
        }, pageId)).toEqual(['Beta', 'Gamma']);
        const first = await (await page.request.get('/api/categories?page=1')).json();
        expect(first.length).toBeGreaterThan(0);
    });
});
