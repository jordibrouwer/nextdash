// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * Edit mode (static/js/dashboard/dashboard-edit-mode.js): an editing state for
 * the dashboard, switched with Shift + M when no bookmark row is selected.
 */

async function loadDashboard(page) {
    await page.setViewportSize({ width: 1500, height: 900 });
    await markWhatsNewSeen(page);
    // Opening a bookmark must not leave the test page: the outside world answers with nothing.
    await page.route((url) => !['localhost', '127.0.0.1'].includes(url.hostname), (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<html></html>' }));
    await page.goto('/');
    await page.waitForSelector('.bookmark-link', { timeout: 20_000 });
    await page.waitForFunction(() => window.dashboardInstance?.editMode, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
}

const modeOn = (page) => page.evaluate(() => document.body.getAttribute('data-edit-mode') === 'on');
const firstBookmark = (page) => page.locator('#dashboard-layout .category:not(.dashboard-widget) .bookmark-link').first();

/** True when clicking the bookmark logged an open, which is what opening it does. */
async function clickOpens(page) {
    let opened = false;
    const onRequest = (request) => { if (request.url().includes('/api/track-open')) opened = true; };
    page.on('request', onRequest);
    await firstBookmark(page).click({ noWaitAfter: true }).catch(() => {});
    // A check that something does NOT happen: the click must log no open, so the request gets time to show up if it were sent.
    await page.waitForTimeout(900);
    page.off('request', onRequest);
    return opened;
}

test.describe('edit mode: the state and its keys', () => {
    test('with a bookmark row selected, Shift + M still moves the bookmark', async ({ page }) => {
        await loadDashboard(page);
        await page.keyboard.press('ArrowDown');
        await expect.poll(() => page.evaluate(() => window.dashboardInstance.keyboardNavigation.currentIndex)).toBeGreaterThanOrEqual(0);
        await page.keyboard.press('Shift+M');
        await expect(page.locator('#move-popover')).toBeVisible();
        expect(await modeOn(page)).toBe(false);
    });

    test('with no row selected, Shift + M switches the mode on, shows its bar, and switches it off', async ({ page }) => {
        await loadDashboard(page);
        await page.keyboard.press('Shift+M');
        await expect.poll(() => modeOn(page)).toBe(true);
        await expect(page.locator('#edit-mode-bar')).toContainText('Editing');
        await expect(page.locator('#edit-mode-bar')).toContainText('Shift + M');
        await page.keyboard.press('Shift+M');
        await expect.poll(() => modeOn(page)).toBe(false);
        await expect(page.locator('#edit-mode-bar')).toHaveCount(0);
    });

    test('entering the mode clears the row cursor', async ({ page }) => {
        await loadDashboard(page);
        await page.keyboard.press('ArrowDown');
        await expect.poll(() => page.evaluate(() => window.dashboardInstance.keyboardNavigation.currentIndex)).toBeGreaterThanOrEqual(0);
        await page.evaluate(() => window.dashboardInstance.editMode.enter());
        expect(await page.evaluate(() => window.dashboardInstance.keyboardNavigation.currentIndex)).toBe(-1);
    });

    test('a bookmark cannot be opened while the mode is on, and can be the moment it is off', async ({ page }) => {
        await loadDashboard(page);
        await page.keyboard.press('Shift+M');
        await expect.poll(() => modeOn(page)).toBe(true);
        expect(await clickOpens(page)).toBe(false);
        await page.keyboard.press('Shift+M');
        await expect.poll(() => modeOn(page)).toBe(false);
        expect(await clickOpens(page)).toBe(true);
    });

    test('the mode ends when the layout turns mobile', async ({ page }) => {
        await loadDashboard(page);
        await page.keyboard.press('Shift+M');
        await expect.poll(() => modeOn(page)).toBe(true);
        await page.evaluate(() => {
            window.MobileExperience.isMobileLayout = () => true;
            window.dispatchEvent(new Event('resize'));
        });
        await expect.poll(() => modeOn(page)).toBe(false);
    });

    test('the mode is not remembered across a reload', async ({ page }) => {
        await loadDashboard(page);
        await page.keyboard.press('Shift+M');
        await expect.poll(() => modeOn(page)).toBe(true);
        await page.reload();
        await page.waitForFunction(() => window.dashboardInstance?.editMode, null, { timeout: 15_000 });
        expect(await modeOn(page)).toBe(false);
    });

    test('Shift + M in Config is left to Config: the mode does not switch on', async ({ page }) => {
        await loadDashboard(page);
        await page.evaluate(async () => { await window.dashboardInstance.config.openConfigView('overview'); });
        await page.waitForSelector('#config-view-body', { timeout: 15_000 });
        await page.keyboard.press('Shift+M');
        // A check that something does NOT happen: the key must not switch the mode on, so the switch gets time to show up if it were made.
        await page.waitForTimeout(400);
        expect(await modeOn(page)).toBe(false);
    });
});

test.describe('edit mode: the button, the setting and the command', () => {
    const { WRITE_TOKEN } = require('./e2e-helpers');
    const headers = { 'X-NextDash-Token': WRITE_TOKEN };

    test('the pencil button is there, switches the mode and shows it is pressed', async ({ page }) => {
        await loadDashboard(page);
        const button = page.locator('#edit-mode-button');
        await expect(button).toBeVisible();
        await expect(button).toHaveAttribute('aria-pressed', 'false');
        await button.click();
        await expect.poll(() => modeOn(page)).toBe(true);
        await expect(button).toHaveAttribute('aria-pressed', 'true');
        await button.click();
        await expect.poll(() => modeOn(page)).toBe(false);
        await expect(button).toHaveAttribute('aria-pressed', 'false');
    });

    test('with the button switched off in settings it is gone and Shift + M still works', async ({ page, request }) => {
        const off = await request.post('/api/settings', { data: { showEditModeButton: false }, headers });
        expect(off.ok()).toBeTruthy();
        try {
            await loadDashboard(page);
            await expect(page.locator('#edit-mode-button')).toBeHidden();
            await page.keyboard.press('Shift+M');
            await expect.poll(() => modeOn(page)).toBe(true);
        } finally {
            await request.post('/api/settings', { data: { showEditModeButton: true }, headers });
        }
    });

    test(':edit mode switches the mode, plain :edit still edits a bookmark', async ({ page }) => {
        await loadDashboard(page);
        await page.keyboard.press(':');
        await page.keyboard.type('edit mode');
        await page.keyboard.press('Enter');
        await expect.poll(() => modeOn(page)).toBe(true);
    });
});

test.describe('edit mode: the panel', () => {
    const { WRITE_TOKEN } = require('./e2e-helpers');
    const headers = { 'X-NextDash-Token': WRITE_TOKEN };
    let seeded = 0;

    /** A category with one bookmark in it, so nothing else on the page depends on it. */
    async function makeCategory(request, name) {
        seeded += 1;
        const id = `em-${Date.now()}-${seeded}`;
        const list = await (await request.get('/api/categories?page=1')).json();
        const saved = await request.post('/api/categories?page=1', { data: [...list, { id, name }], headers });
        expect(saved.ok()).toBeTruthy();
        const added = await request.post('/api/bookmarks/add', { data: { page: 1, bookmark: { name: `${name} link`, url: `https://${id}.example/`, category: id } }, headers });
        expect(added.ok()).toBeTruthy();
        return id;
    }

    const stored = async (request, id) => (await (await request.get('/api/categories?page=1')).json()).find((c) => c.id === id);
    const panel = (page) => page.locator('#edit-mode-panel');

    async function select(page, id) {
        await page.keyboard.press('Shift+M');
        await expect.poll(() => modeOn(page)).toBe(true);
        await page.locator(`.category[data-category-id="${id}"] .category-title`).first().click();
        await expect(panel(page).locator('[data-edit-section="category"]')).toBeVisible();
    }

    test('a click on a category title chooses the category and leaves it open', async ({ page, request }) => {
        const id = await makeCategory(request, 'EM Open');
        await loadDashboard(page);
        await select(page, id);
        await expect(page.locator(`.category[data-category-id="${id}"]`)).not.toHaveAttribute('data-collapsed', 'true');
    });

    test('a click on a category selects it and the panel shows its fields, saved as they change', async ({ page, request }) => {
        const id = await makeCategory(request, 'EM Alpha');
        await loadDashboard(page);
        await select(page, id);
        const name = panel(page).locator('[data-edit-field="name"]');
        await expect(name).toHaveValue('EM Alpha');

        await name.fill('EM Alpha renamed');
        await name.press('Enter');
        await expect.poll(async () => (await stored(request, id))?.name).toBe('EM Alpha renamed');

        await panel(page).locator('[data-edit-field="view"]').selectOption('tiles');
        await expect.poll(async () => (await stored(request, id))?.view).toBe('tiles');

        await panel(page).locator('[data-edit-field="sort"]').selectOption('az');
        await expect.poll(async () => (await stored(request, id))?.sortMode).toBe('az');
    });

    test('the panel takes width: the grid ends where the panel begins', async ({ page, request }) => {
        const id = await makeCategory(request, 'EM Beta');
        await loadDashboard(page);
        await select(page, id);
        await expect(page.locator('body')).toHaveAttribute('data-edit-panel', 'open');
        const edges = await page.evaluate(() => ({
            gridRight: document.querySelector('#dashboard-layout').getBoundingClientRect().right,
            panelLeft: document.querySelector('#edit-mode-panel').getBoundingClientRect().left,
        }));
        expect(edges.gridRight).toBeLessThanOrEqual(edges.panelLeft + 1);
        expect(await modeOn(page)).toBe(true);
    });

    test('with Lock layout on, width is disabled and view and sort are not', async ({ page, request }) => {
        const id = await makeCategory(request, 'EM Gamma');
        const lock = await request.post('/api/settings', { data: { lockLayout: true }, headers });
        expect(lock.ok()).toBeTruthy();
        try {
            await loadDashboard(page);
            await select(page, id);
            await expect(panel(page).locator('[data-edit-field="width"]').first()).toBeDisabled();
            await expect(panel(page).locator('[data-edit-field="view"]').first()).toBeEnabled();
            await expect(panel(page).locator('[data-edit-field="sort"]')).toBeEnabled();
        } finally {
            await request.post('/api/settings', { data: { lockLayout: false }, headers });
        }
    });

    test('a category removed behind the panel clears it and is not written back', async ({ page, request }) => {
        const id = await makeCategory(request, 'EM Delta');
        await loadDashboard(page);
        await select(page, id);
        // Another tab removed it.
        const list = await (await request.get('/api/categories?page=1')).json();
        const gone = await request.post('/api/categories?page=1', { data: list.filter((c) => c.id !== id), headers });
        expect(gone.ok()).toBeTruthy();
        const name = panel(page).locator('[data-edit-field="name"]');
        await name.fill('EM Delta again');
        await name.press('Enter');
        await expect(panel(page).locator('[data-edit-section="category"]')).toHaveCount(0);
        expect(await stored(request, id)).toBeUndefined();
    });

    test('a click on a page tab switches to it and the panel shows the page, saved as it changes', async ({ page, request }) => {
        // A second page, so there is a tab besides the first.
        const pages = await (await request.get('/api/pages')).json();
        if (pages.filter((p) => p.id < 999999).length < 2) {
            const next = Math.max(...pages.filter((p) => p.id < 999999).map((p) => p.id)) + 1;
            const made = await request.post('/api/pages', { data: [...pages, { id: next, name: 'EM second' }], headers });
            expect(made.ok()).toBeTruthy();
        }
        await loadDashboard(page);
        await page.keyboard.press('Shift+M');
        await expect.poll(() => modeOn(page)).toBe(true);
        const tabs = page.locator('#page-navigation .page-nav-btn');
        await expect.poll(() => tabs.count()).toBeGreaterThan(1);
        await tabs.nth(1).click();
        await expect(panel(page).locator('[data-edit-section="page"]')).toBeVisible();
        const name = panel(page).locator('[data-edit-field="page-name"]');
        const before = await name.inputValue();
        try {
            await name.fill(`${before} x`);
            await name.press('Enter');
            await expect.poll(async () => (await (await request.get('/api/pages')).json()).some((p) => p.name === `${before} x`)).toBe(true);
        } finally {
            await name.fill(before);
            await name.press('Enter');
            await expect.poll(async () => (await (await request.get('/api/pages')).json()).some((p) => p.name === before)).toBe(true);
        }
    });

    test('the panel closes with the mode', async ({ page, request }) => {
        const id = await makeCategory(request, 'EM Eps');
        await loadDashboard(page);
        await select(page, id);
        await page.keyboard.press('Escape');
        await page.locator('#dashboard-layout').click({ position: { x: 2, y: 2 }, force: true }).catch(() => {});
        await page.evaluate(() => window.dashboardInstance.editMode.exit());
        await expect(panel(page)).toHaveCount(0);
        await expect(page.locator('body')).not.toHaveAttribute('data-edit-panel', 'open');
    });
});

test.describe('edit mode: a widget in the panel', () => {
    const widgetBlock = (page) => page.locator('#dashboard-layout .category.dashboard-widget').first();
    const panel = (page) => page.locator('#edit-mode-panel');

    async function selectWidget(page) {
        await page.keyboard.press('Shift+M');
        await expect.poll(() => modeOn(page)).toBe(true);
        await widgetBlock(page).locator('.category-title').first().click();
        await expect(panel(page).locator('[data-edit-section="widget"]')).toBeVisible();
    }

    test('selecting a widget shows its name, width, how it is doing and a way to its settings', async ({ page }) => {
        await loadDashboard(page);
        await page.evaluate(() => {
            const first = document.querySelector('#dashboard-layout .category.dashboard-widget');
            window.WidgetState?.set(first.getAttribute('data-widget-id'), 'error', 'unreachable', { title: 'x', pageId: 1 });
        });
        await selectWidget(page);
        const section = panel(page).locator('[data-edit-section="widget"]');
        await expect(section.locator('[data-edit-field="widget-name"]')).toBeVisible();
        await expect(section.locator('[data-edit-field="widget-width"]').first()).toBeVisible();
        await expect(section).toContainText('unreachable');
        await expect(section.locator('[data-edit-action="widget-settings"]')).toBeVisible();
    });

    test('a widget renamed in the panel is saved', async ({ page }) => {
        await loadDashboard(page);
        await selectWidget(page);
        const id = await widgetBlock(page).getAttribute('data-widget-id');
        const name = panel(page).locator('[data-edit-field="widget-name"]');
        await name.fill('Edit mode widget');
        await name.press('Enter');
        await expect.poll(() => page.evaluate((wid) => (window.dashboardInstance.widgets || []).find((w) => w.id === wid)?.title, id)).toBe('Edit mode widget');
        await page.reload();
        await page.waitForFunction(() => window.dashboardInstance?.editMode && (window.dashboardInstance.widgets || []).length, null, { timeout: 15_000 });
        expect(await page.evaluate((wid) => (window.dashboardInstance.widgets || []).find((w) => w.id === wid)?.title, id)).toBe('Edit mode widget');
    });

    test('the sheet over the dashboard takes its text colour from the theme, not a grey literal', async ({ page }) => {
        await loadDashboard(page);
        await selectWidget(page);
        await panel(page).locator('[data-edit-action="widget-settings"]').click();
        const sheet = page.locator('#config-widget-overlay .config-widget-sheet');
        await expect(sheet).toBeVisible({ timeout: 15_000 });
        // var(--text-muted, #888) fell back to #888 when nothing defined --text-muted out here.
        expect(await sheet.evaluate((el) => getComputedStyle(el).getPropertyValue('--text-muted').trim())).not.toBe('');
        const note = sheet.locator('.config-widget-note, .config-widget-detail-about').first();
        await expect(note).toBeVisible();
        expect(await note.evaluate((el) => getComputedStyle(el).color)).not.toBe('rgb(136, 136, 136)');
    });

    test('Settings opens the same sheet Config → Widgets uses, over the dashboard, and the mode stays on', async ({ page }) => {
        await loadDashboard(page);
        await selectWidget(page);
        await panel(page).locator('[data-edit-action="widget-settings"]').click();
        const sheet = page.locator('#config-widget-overlay .config-widget-sheet');
        await expect(sheet).toBeVisible({ timeout: 15_000 });
        // Over the dashboard: not Config's view.
        expect(await page.evaluate(() => window.dashboardInstance.activeView)).toBe('bookmarks');
        expect(await page.locator('#config-widgets-body').count()).toBe(0);
        expect(await modeOn(page)).toBe(true);
        // Closed with its own ×, the grid and the panel are as they were.
        await sheet.locator('.config-widget-sheet-close').click();
        await expect(page.locator('#config-widget-overlay')).toHaveCount(0);
        expect(await modeOn(page)).toBe(true);
        await expect(panel(page).locator('[data-edit-section="widget"]')).toBeVisible();
    });

    test('a setting changed in the sheet is saved with its own Save, and the dashboard shows it', async ({ page, request }) => {
        const { WRITE_TOKEN } = require('./e2e-helpers');
        const headers = { 'X-NextDash-Token': WRITE_TOKEN };
        const cur = await (await request.get('/api/pages/1/blocks')).json();
        const id = `w_em_${Date.now()}`;
        const put = await request.put('/api/pages/1/blocks', {
            data: { widgets: [...(cur.widgets || []), { id, type: 'rss', title: 'EM feed', config: { feeds: ['https://no-such.example/rss.xml'] } }], order: [...(cur.order || []), id] },
            headers,
        });
        expect(put.ok()).toBeTruthy();
        await loadDashboard(page);
        await page.keyboard.press('Shift+M');
        await expect.poll(() => modeOn(page)).toBe(true);
        await page.locator(`.category.dashboard-widget[data-widget-id="${id}"] .category-title`).first().click();
        await panel(page).locator('[data-edit-action="widget-settings"]').click();
        const sheet = page.locator('#config-widget-overlay .config-widget-sheet');
        await expect(sheet).toBeVisible({ timeout: 15_000 });
        const rows = sheet.locator('input[type="number"]').first();
        await rows.fill('3');
        await rows.press('Tab');
        const save = sheet.locator('[data-widget-save]');
        await expect(save).toBeEnabled();
        await save.click();
        await expect.poll(async () => {
            const blocks = await (await request.get('/api/pages/1/blocks')).json();
            return (blocks.widgets || []).find((w) => w.id === id)?.config?.rows;
        }, { timeout: 15_000 }).toBe(3);
        await sheet.locator('.config-widget-sheet-close').click();
        await expect(page.locator('#config-widget-overlay')).toHaveCount(0);
        expect(await modeOn(page)).toBe(true);
    });

});

test.describe('edit mode: Escape goes from the inside out', () => {
    let seeded = 0;
    const { WRITE_TOKEN } = require('./e2e-helpers');
    const headers = { 'X-NextDash-Token': WRITE_TOKEN };

    async function makeCategory(request) {
        seeded += 1;
        const id = `emesc-${Date.now()}-${seeded}`;
        const list = await (await request.get('/api/categories?page=1')).json();
        await request.post('/api/categories?page=1', { data: [...list, { id, name: 'EM Esc' }], headers });
        await request.post('/api/bookmarks/add', { data: { page: 1, bookmark: { name: 'EM Esc link', url: `https://${id}.example/`, category: id } }, headers });
        return id;
    }

    test('a field in the panel gives the focus back first, then Escape leaves the mode', async ({ page, request }) => {
        const id = await makeCategory(request);
        await loadDashboard(page);
        await page.keyboard.press('Shift+M');
        await expect.poll(() => modeOn(page)).toBe(true);
        await page.locator(`.category[data-category-id="${id}"] .category-title`).first().click();
        const name = page.locator('#edit-mode-panel [data-edit-field="name"]');
        await name.focus();
        await page.keyboard.press('Escape');
        expect(await modeOn(page)).toBe(true);
        expect(await page.evaluate(() => Boolean(document.activeElement?.closest?.('#edit-mode-panel')))).toBe(false);
        await page.keyboard.press('Escape');
        await expect.poll(() => modeOn(page)).toBe(false);
        // The grid's own Escape (it opens the search) did not fire as well.
        expect(await page.evaluate(() => window.dashboardInstance.searchComponent?.isActive?.() === true)).toBe(false);
    });

    test('with a dialog open Escape closes the dialog and the mode stays', async ({ page, request }) => {
        const id = await makeCategory(request);
        await loadDashboard(page);
        await page.keyboard.press('Shift+M');
        await expect.poll(() => modeOn(page)).toBe(true);
        await page.locator(`.category[data-category-id="${id}"] .category-title`).first().click();
        await page.evaluate(() => window.AppModal.show({ title: 'A dialog', message: 'Open', confirmText: 'OK', showCancel: false }));
        await expect(page.locator('#app-modal')).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(page.locator('#app-modal')).toBeHidden();
        expect(await modeOn(page)).toBe(true);
    });

    test('Escape on the grid leaves the mode and does not open the search', async ({ page }) => {
        await loadDashboard(page);
        await page.keyboard.press('Shift+M');
        await expect.poll(() => modeOn(page)).toBe(true);
        await page.keyboard.press('Escape');
        await expect.poll(() => modeOn(page)).toBe(false);
        expect(await page.evaluate(() => window.dashboardInstance.searchComponent?.isActive?.() === true)).toBe(false);
    });
});

test.describe('edit mode: the bookmark preview is off while it is on', () => {
    const { WRITE_TOKEN } = require('./e2e-helpers');
    const headers = { 'X-NextDash-Token': WRITE_TOKEN };

    const card = (page) => page.locator('#bookmark-preview-card.is-visible, #bookmark-preview-card.show, #bookmark-preview-card[data-visible="true"]');
    const cardShown = (page) => page.evaluate(() => {
        const el = document.getElementById('bookmark-preview-card');
        if (!el) return false;
        const cs = getComputedStyle(el);
        return cs.display !== 'none' && cs.visibility !== 'hidden' && parseFloat(cs.opacity || '1') > 0.05 && el.getBoundingClientRect().width > 0 && !el.hidden;
    });

    async function hoverFirstBookmark(page) {
        const row = page.locator('#dashboard-layout .category:not(.dashboard-widget) .bookmark-link').first();
        await row.hover();
        await page.mouse.move(0, 0);
        await row.hover();
        // The preview card opens after its hover delay: the clock is what is under test.
        await page.waitForTimeout(900);
    }

    test('no card on hover in the mode, and the card is back the moment the mode ends', async ({ page, request }) => {
        const on = await request.post('/api/settings', { data: { linkPreviewMode: 'hover' }, headers });
        expect(on.ok()).toBeTruthy();
        await loadDashboard(page);
        expect(await page.evaluate(() => window.dashboardInstance.preview.previewMode())).toBe('hover');

        // Outside the mode the card opens.
        await hoverFirstBookmark(page);
        expect(await cardShown(page)).toBe(true);
        await page.mouse.move(0, 0);
        // The card closes after its own delay once the pointer leaves: nothing to poll until that has passed.
        await page.waitForTimeout(500);
        expect(await cardShown(page)).toBe(false);

        // In the mode it does not, and one that was open goes away.
        await page.keyboard.press('Shift+M');
        await expect.poll(() => modeOn(page)).toBe(true);
        await hoverFirstBookmark(page);
        expect(await cardShown(page)).toBe(false);

        // Out of the mode it is back, on the same rows, with no reload.
        await page.keyboard.press('Shift+M');
        await expect.poll(() => modeOn(page)).toBe(false);
        await hoverFirstBookmark(page);
        expect(await cardShown(page)).toBe(true);
    });

    test('with the preview off in Config it stays off in the mode and after it', async ({ page, request }) => {
        const off = await request.post('/api/settings', { data: { linkPreviewMode: 'off' }, headers });
        expect(off.ok()).toBeTruthy();
        try {
            await loadDashboard(page);
            await page.keyboard.press('Shift+M');
            await expect.poll(() => modeOn(page)).toBe(true);
            await page.keyboard.press('Shift+M');
            await expect.poll(() => modeOn(page)).toBe(false);
            await hoverFirstBookmark(page);
            expect(await cardShown(page)).toBe(false);
        } finally {
            await request.post('/api/settings', { data: { linkPreviewMode: 'hover' }, headers });
        }
    });

    test('a card that is open when the mode starts goes away', async ({ page, request }) => {
        await request.post('/api/settings', { data: { linkPreviewMode: 'hover' }, headers });
        await loadDashboard(page);
        await hoverFirstBookmark(page);
        expect(await cardShown(page)).toBe(true);
        await page.evaluate(() => window.dashboardInstance.editMode.enter());
        await expect.poll(() => cardShown(page)).toBe(false);
    });
});

test.describe('edit mode: what the review found', () => {
    const { WRITE_TOKEN } = require('./e2e-helpers');
    const headers = { 'X-NextDash-Token': WRITE_TOKEN };

    test('the pencil sits after the other action buttons, so it pushes none of them into the fold', async ({ page }) => {
        await loadDashboard(page);
        const orders = await page.evaluate(() => {
            const get = (id) => Number(getComputedStyle(document.getElementById(id)).order);
            return { pencil: get('edit-mode-button'), help: get('help-button'), add: get('quick-add-toolbar-btn') };
        });
        expect(orders.pencil).toBeGreaterThan(orders.help);
        expect(orders.add).toBeLessThan(orders.pencil);
    });

    test('with the default bar the first two action buttons are still add and search', async ({ page }) => {
        await loadDashboard(page);
        const shown = await page.evaluate(() => {
            const ids = ['quick-add-toolbar-btn', 'search-button', 'edit-mode-button'];
            return ids.map((id) => {
                const el = document.getElementById(id);
                return el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
            });
        });
        // The pencil may sit in the fold, the first two may not.
        expect(shown[0]).toBe(true);
        expect(shown[1]).toBe(true);
    });

    test('a bookmark cannot be opened with its shortcut letter in the mode', async ({ page, request }) => {
        const url = `https://shortcut-em-${Date.now()}.example/`;
        const added = await request.post('/api/bookmarks/add', { data: { page: 1, bookmark: { name: 'EM shortcut', url, shortcut: 'qz' } }, headers });
        expect(added.ok()).toBeTruthy();
        await loadDashboard(page);
        await page.keyboard.press('Shift+M');
        await expect.poll(() => modeOn(page)).toBe(true);
        // A click on the row focuses its link; its letters must not open it.
        await page.locator('#dashboard-layout .category:not(.dashboard-widget) .bookmark-link').first().click();
        let opened = false;
        const onRequest = (r) => { if (r.url().includes('/api/track-open')) opened = true; };
        page.on('request', onRequest);
        await page.keyboard.type('qz');
        // A check that something does NOT happen: typing must log no open, so the request gets time to show up if it were sent.
        await page.waitForTimeout(900);
        page.off('request', onRequest);
        expect(opened).toBe(false);
    });

    test('Escape closes an open category menu and leaves the mode on', async ({ page }) => {
        await loadDashboard(page);
        await page.keyboard.press('Shift+M');
        await expect.poll(() => modeOn(page)).toBe(true);
        const title = page.locator('#dashboard-layout .category:not(.dashboard-widget) .category-title').first();
        await title.click({ button: 'right' });
        await expect(page.locator('.bookmark-context-menu').first()).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(page.locator('.bookmark-context-menu')).toHaveCount(0);
        expect(await modeOn(page)).toBe(true);
    });

    test('opening Config ends the mode, and Shift + M there is Config\'s', async ({ page }) => {
        await loadDashboard(page);
        await page.keyboard.press('Shift+M');
        await expect.poll(() => modeOn(page)).toBe(true);
        await page.evaluate(async () => { await window.dashboardInstance.config.openConfigView('overview'); });
        await expect.poll(() => modeOn(page)).toBe(false);
        await expect(page.locator('#edit-mode-bar')).toHaveCount(0);
        await expect(page.locator('body')).not.toHaveAttribute('data-edit-panel', 'open');
    });

    test('a click on the inbox tab does not select page one in the panel', async ({ page }) => {
        await loadDashboard(page);
        await page.keyboard.press('Shift+M');
        await expect.poll(() => modeOn(page)).toBe(true);
        const inbox = page.locator('#page-nav-inbox-btn');
        if (await inbox.count() === 0) test.skip(true, 'no inbox tab on this install');
        await inbox.click();
        // A check that something does NOT happen: the inbox view must not choose a page, so the choice gets time to show up if it were made.
        await page.waitForTimeout(500);
        expect(await page.evaluate(() => window.dashboardInstance.editMode.selected?.kind === 'page')).toBe(false);
    });
});


test.describe('edit mode: from the category menu', () => {
    test('"Edit in panel…" turns the mode on with that category chosen', async ({ page }) => {
        await loadDashboard(page);
        const id = await page.evaluate(() => {
            const el = [...document.querySelectorAll('#dashboard-layout .category:not(.dashboard-widget)')][1]
                || document.querySelector('#dashboard-layout .category:not(.dashboard-widget)');
            return el.getAttribute('data-category-id');
        });
        const title = page.locator(`.category[data-category-id="${id}"] .category-title`).first();
        await title.scrollIntoViewIfNeeded();
        await title.click({ button: 'right' });
        await page.locator('#category-context-menu [role="menuitem"]', { hasText: 'Edit in panel' }).click();
        await expect.poll(() => modeOn(page)).toBe(true);
        await expect(page.locator('#edit-mode-panel [data-edit-section="category"]')).toBeVisible();
        expect(await page.evaluate(() => window.dashboardInstance.editMode.selected?.id)).toBe(id);
    });
});

test.describe('edit mode: review fixes', () => {
    test('closing the panel with its × gives the grid its room back', async ({ page, request }) => {
        const { WRITE_TOKEN } = require('./e2e-helpers');
        const id = `em-x-${Date.now()}`;
        const list = await (await request.get('/api/categories?page=1')).json();
        await request.post('/api/categories?page=1', { data: [...list, { id, name: 'Closer' }], headers: { 'X-NextDash-Token': WRITE_TOKEN } });
        await request.post('/api/bookmarks/add', { data: { page: 1, bookmark: { name: 'Closer link', url: `https://${id}.example/`, category: id } }, headers: { 'X-NextDash-Token': WRITE_TOKEN } });
        await loadDashboard(page);
        await page.keyboard.press('Shift+M');
        await expect.poll(() => modeOn(page)).toBe(true);
        await page.locator(`.category[data-category-id="${id}"] .category-title`).first().click();
        await expect(page.locator('#edit-mode-panel [data-edit-section="category"]')).toBeVisible();
        await page.locator('.lvs-drawer-close').first().click();
        await expect.poll(() => page.evaluate(() => document.body.hasAttribute('data-edit-panel'))).toBe(false);
    });

    test('a shortcut letter typed on a Tab-focused bookmark opens nothing', async ({ page }) => {
        await loadDashboard(page);
        await page.keyboard.press('Shift+M');
        await expect.poll(() => modeOn(page)).toBe(true);
        let swallowed = false;
        await page.evaluate(() => {
            window.__letterReached = false;
            document.addEventListener('keydown', (e) => { if (e.key === 'j') window.__letterReached = true; });
            document.querySelector('#dashboard-layout .bookmark-link').focus();
        });
        await page.keyboard.press('j');
        swallowed = !(await page.evaluate(() => window.__letterReached));
        expect(swallowed).toBe(true);
    });

    test('the widget sheet counts as a modal for the dashboard keys', async ({ page }) => {
        await loadDashboard(page);
        const open = await page.evaluate(() => {
            const o = document.createElement('div');
            o.id = 'config-widget-overlay';
            document.body.appendChild(o);
            const r = window.dashboardInstance.isModalOpen();
            o.remove();
            return r;
        });
        expect(open).toBe(true);
    });
});

test.describe('edit mode: the smaller review points', () => {
    const { WRITE_TOKEN } = require('./e2e-helpers');
    const headers = { 'X-NextDash-Token': WRITE_TOKEN };

    async function seeded(request, name) {
        const id = `em-s-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
        const list = await (await request.get('/api/categories?page=1')).json();
        await request.post('/api/categories?page=1', { data: [...list, { id, name }], headers });
        await request.post('/api/bookmarks/add', { data: { page: 1, bookmark: { name: `${name} link`, url: `https://${id}.example/`, category: id } }, headers });
        return id;
    }

    test(':maxactions offers 10, and the pencil carries its key for screen readers', async ({ page }) => {
        await loadDashboard(page);
        await expect.poll(() => page.locator('#edit-mode-button').getAttribute('aria-keyshortcuts')).toContain('Shift+M');
        await page.keyboard.press(':');
        await page.keyboard.type('maxactions 1');
        // Typing "1" matches the values 1 and 10, besides the command's own row.
        await expect(page.getByText('MAXACTIONS')).toHaveCount(3);
    });

    test('the ring goes back on the chosen block after the grid is redrawn', async ({ page, request }) => {
        const id = await seeded(request, 'Ringed');
        await loadDashboard(page);
        await page.keyboard.press('Shift+M');
        await expect.poll(() => modeOn(page)).toBe(true);
        await page.locator(`.category[data-category-id="${id}"] .category-title`).first().click();
        await expect(page.locator(`.category[data-category-id="${id}"].is-edit-selected`)).toHaveCount(1);
        await page.evaluate(() => window.dashboardInstance.renderDashboard({ animate: false, forceFull: true }));
        await expect(page.locator(`.category[data-category-id="${id}"].is-edit-selected`)).toHaveCount(1);
    });

    test('Esc in a name field gives the text back and saves nothing', async ({ page, request }) => {
        const id = await seeded(request, 'Keepname');
        await loadDashboard(page);
        await page.keyboard.press('Shift+M');
        await page.locator(`.category[data-category-id="${id}"] .category-title`).first().click();
        const field = page.locator('#edit-mode-panel [data-edit-field="name"]');
        await field.fill('Changed by mistake');
        await page.keyboard.press('Escape');
        await expect(field).toHaveValue('Keepname');
        // A check that something does NOT happen: the cancelled text must not be saved, so a save gets time to show up if it were sent.
        await page.waitForTimeout(400);
        const list = await (await request.get('/api/categories?page=1')).json();
        expect(list.find((c) => c.id === id).name).toBe('Keepname');
        expect(await modeOn(page)).toBe(true);
    });

    test('Esc after a saved rename gives back the new name, not the one from before', async ({ page, request }) => {
        const id = await seeded(request, 'Firstname');
        await loadDashboard(page);
        await page.keyboard.press('Shift+M');
        await page.locator(`.category[data-category-id="${id}"] .category-title`).first().click();
        const field = page.locator('#edit-mode-panel [data-edit-field="name"]');
        await field.fill('Secondname');
        await page.keyboard.press('Enter');
        await expect.poll(async () => (await (await request.get('/api/categories?page=1')).json()).find((c) => c.id === id).name).toBe('Secondname');
        await field.click();
        await field.fill('Thirdname');
        await page.keyboard.press('Escape');
        await expect(field).toHaveValue('Secondname');
        // A check that something does NOT happen: the cancelled text must not be saved, so a save gets time to show up if it were sent.
        await page.waitForTimeout(400);
        expect((await (await request.get('/api/categories?page=1')).json()).find((c) => c.id === id).name).toBe('Secondname');
    });

    test('any switch of page shows that page in the panel', async ({ page, request }) => {
        const pages = await (await request.get('/api/pages')).json();
        if (pages.filter((p) => p.id < 999999).length < 2) {
            const next = Math.max(...pages.filter((p) => p.id < 999999).map((p) => p.id)) + 1;
            await request.post('/api/pages', { data: [...pages, { id: next, name: 'EM second' }], headers });
        }
        await loadDashboard(page);
        await page.keyboard.press('Shift+M');
        await expect.poll(() => modeOn(page)).toBe(true);
        const other = await page.evaluate(() => window.dashboardInstance.pages.find((p) => String(p.id) !== String(window.dashboardInstance.currentPageId) && Number(p.id) < 999999)?.id);
        await page.evaluate((id) => window.dashboardInstance.loadPageBookmarks(id), other);
        await expect(panel2(page).locator('[data-edit-section="page"]')).toBeVisible();
        expect(await page.evaluate(() => String(window.dashboardInstance.editMode.selected.id))).toBe(String(other));
    });

    test('a widget sheet that cannot open leaves Config\'s choices alone', async ({ page }) => {
        await loadDashboard(page);
        const res = await page.evaluate(async () => {
            const d = window.dashboardInstance;
            await d.config.ensureSection('widgets');
            d.config.widgetQuery = 'keep me';
            const opened = await d.config.openWidgetSheetOverDashboard('no-such-widget');
            return { opened, query: d.config.widgetQuery, flag: d.config._sheetOverDashboard };
        });
        expect(res).toEqual({ opened: false, query: 'keep me', flag: false });
    });
});
const panel2 = (page) => page.locator('#edit-mode-panel');
