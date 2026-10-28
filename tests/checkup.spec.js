// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays, WRITE_TOKEN } = require('./e2e-helpers');

/**
 * The checkup (static/js/checkup.js): one round through what is worth tidying
 * on the dashboard, opened with :checkup or from the Bookmarks view.
 */

const headers = { 'X-NextDash-Token': WRITE_TOKEN };
const WIN = '.checkup-window';
let seeded = 0;

async function loadDashboard(page) {
    await page.setViewportSize({ width: 1500, height: 900 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('.bookmark-link', { timeout: 20_000 });
    await page.waitForFunction(() => window.Checkup && window.dashboardInstance?.settings, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
}

async function addEmptyCategory(request, name) {
    const res = await request.get('/api/categories?page=1');
    const list = await res.json();
    const id = `${name.toLowerCase().replace(/\W+/g, '-')}-${Date.now()}-${(seeded += 1)}`;
    const save = await request.post('/api/categories?page=1', { data: [...list, { id, name }], headers });
    expect(save.ok()).toBeTruthy();
    return id;
}

async function addBroken(request) {
    seeded += 1;
    const res = await request.post('/api/bookmarks/add', {
        data: { page: 1, bookmark: { name: `Checkup Gone ${seeded}`, url: `https://checkup-gone-${Date.now()}-${seeded}.example/`, checkStatus: true, lastError: 'timeout', brokenSince: Date.now() - 60_000, lastChecked: Date.now() } },
        headers,
    });
    expect(res.ok()).toBeTruthy();
}

test.describe('the checkup', () => {
    test(':checkup opens a window with a step for what there is to tidy', async ({ page, request }) => {
        await addBroken(request);
        await addEmptyCategory(request, 'Checkup Empty A');
        await loadDashboard(page);
        await page.keyboard.press(':');
        await page.keyboard.type('checkup');
        await page.keyboard.press('Enter');
        const win = page.locator(WIN);
        await expect(win).toBeVisible();
        await expect(win.locator('[data-checkup-step="broken"]')).toBeVisible();
        await expect(win.locator('[data-checkup-step="structure"]')).toContainText('Checkup Empty A');
        // Every step says what it is and why it is there.
        await expect(win.locator('[data-checkup-step="broken"] .checkup-step-intro')).not.toBeEmpty();
    });

    test('with nothing to tidy it says so', async ({ page }) => {
        await page.route('**/api/bookmark-health', (route) => route.fulfill({ json: { issues: [], summary: {} } }));
        await page.route('**/api/checkup/structure', (route) => route.fulfill({ json: { items: [] } }));
        await loadDashboard(page);
        await page.evaluate(() => { for (const e of window.WidgetState.snapshot()) window.WidgetState.clear(e.widgetId); });
        await page.evaluate(() => window.Checkup.open());
        await expect(page.locator(WIN)).toContainText('Nothing to tidy up');
    });

    test('a bookmark step leads to the Bookmarks view on its filter', async ({ page, request }) => {
        await addBroken(request);
        await loadDashboard(page);
        await page.evaluate(() => window.Checkup.open());
        await page.locator(`${WIN} [data-checkup-step="broken"] [data-checkup-go]`).click();
        await expect(page.locator(WIN)).toBeHidden();
        await expect.poll(() => page.evaluate(() => window.location.hash)).toBe('#bookmarks?health=broken');
    });

    test('an empty category is deleted from its row, after asking', async ({ page, request }) => {
        const id = await addEmptyCategory(request, 'Checkup Empty B');
        await loadDashboard(page);
        await page.evaluate(() => window.Checkup.open());
        const row = page.locator(`${WIN} [data-checkup-category="${id}"]`);
        await expect(row).toBeVisible();
        await row.getByRole('button', { name: 'Delete' }).click();
        await expect(page.locator('#app-modal')).toContainText('Checkup Empty B');
        await page.locator('#app-modal').getByRole('button', { name: 'Delete' }).click();
        // The question replaced the window; the answer brings it back without the row.
        await expect.poll(async () => (await (await request.get('/api/categories?page=1')).json()).some((c) => c.id === id), { timeout: 10_000 }).toBe(false);
        await expect(page.locator(WIN)).toBeVisible();
        await expect(page.locator(`${WIN} [data-checkup-category="${id}"]`)).toHaveCount(0);
    });

    test('Keep leaves the empty category where it is', async ({ page, request }) => {
        const id = await addEmptyCategory(request, 'Checkup Empty C');
        await loadDashboard(page);
        await page.evaluate(() => window.Checkup.open());
        await page.locator(`${WIN} [data-checkup-category="${id}"]`).getByRole('button', { name: 'Delete' }).click();
        await page.locator('#app-modal').getByRole('button', { name: 'Cancel' }).click();
        await expect(page.locator(`${WIN} [data-checkup-category="${id}"]`)).toBeVisible();
        const list = await (await request.get('/api/categories?page=1')).json();
        expect(list.some((c) => c.id === id)).toBe(true);
    });

    test('widgets that are not fine are listed by name, with what is wrong; ones that no longer exist are not', async ({ page, request }) => {
        await loadDashboard(page);
        // The fresh install's own widget stands for a real one; the others only ever reported.
        const known = await request.get('/api/checkup/structure').then((r) => r.json());
        const existing = (known.widgetIds || [])[0];
        expect(existing, 'the seed has a widget').toBeTruthy();
        await page.evaluate((id) => {
            window.WidgetState.set(id, 'error', 'unreachable', { title: 'Living room', pageId: 1 });
            window.WidgetState.set('w_checkup_gone', 'error', 'unreachable', { title: 'Deleted one', pageId: 1 });
            window.WidgetState.set('w_checkup_gone2', 'empty', '', { title: 'Deleted two', pageId: 1 });
        }, existing);
        await page.evaluate(() => window.Checkup.open());
        const step = page.locator(`${WIN} [data-checkup-step="widgets"]`);
        await expect(step).toContainText('Living room');
        await expect(step).toContainText('unreachable');
        await expect(step).not.toContainText('Deleted one');
        await expect(step).not.toContainText('w_');
        await expect(step.locator('[data-checkup-widget]')).toHaveCount(1);
        // Only what was loaded in this session: the step says so.
        await expect(step).toContainText('this session');
    });

    test('the Bookmarks view has a Checkup entry in its Collection menu', async ({ page }) => {
        await loadDashboard(page);
        await page.evaluate(() => window.dashboardInstance.config.openLibraryView());
        await page.locator('[data-bm-header-more]').click();
        await page.locator('[data-bm-header-menu] [data-bm-checkup]').click();
        await expect(page.locator(WIN)).toBeVisible();
    });

    test('a deleted category leaves the grid at once and can be undone', async ({ page, request }) => {
        const id = await addEmptyCategory(request, 'Checkup Empty D');
        // Empty categories are drawn unless the reader hides them.
        await request.post('/api/settings', { data: { hideEmptyCategories: false }, headers });
        await loadDashboard(page);
        await expect(page.locator(`.category[data-category-id="${id}"]`)).toHaveCount(1);
        await page.evaluate(() => window.Checkup.open());
        await page.locator(`${WIN} [data-checkup-category="${id}"]`).getByRole('button', { name: 'Delete' }).click();
        await page.locator('#app-modal').getByRole('button', { name: 'Delete' }).click();
        await expect(page.getByText('Category deleted.')).toBeVisible({ timeout: 10_000 });
        await expect(page.locator(`.category[data-category-id="${id}"]`)).toHaveCount(0);
        await page.getByRole('button', { name: /undo/i }).click();
        await expect(page.locator(`.category[data-category-id="${id}"]`)).toHaveCount(1, { timeout: 10_000 });
    });

    test('a delete that fails says so and keeps the row', async ({ page, request }) => {
        const id = await addEmptyCategory(request, 'Checkup Empty E');
        await loadDashboard(page);
        await page.route('**/api/categories?page=1', (route) => (route.request().method() === 'POST'
            ? route.fulfill({ status: 500, body: 'no' })
            : route.continue()));
        await page.evaluate(() => window.Checkup.open());
        await page.locator(`${WIN} [data-checkup-category="${id}"]`).getByRole('button', { name: 'Delete' }).click();
        await page.locator('#app-modal').getByRole('button', { name: 'Delete' }).click();
        await expect(page.getByText('Could not save categories.')).toBeVisible({ timeout: 10_000 });
        await expect(page.locator(`${WIN} [data-checkup-category="${id}"]`)).toBeVisible();
    });

    test('when the reads fail it says it could not check, not that all is well', async ({ page }) => {
        await loadDashboard(page);
        await page.route('**/api/bookmark-health', (route) => route.abort());
        await page.route('**/api/checkup/structure', (route) => route.abort());
        await page.evaluate(() => window.Checkup.open());
        await expect(page.locator(WIN)).toContainText('could not check');
        await expect(page.locator(WIN)).not.toContainText('Nothing to tidy up');
    });
});
