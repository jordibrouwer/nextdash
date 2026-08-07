// @ts-check
const { test, expect } = require('@playwright/test');
const { dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

async function loadDashboard(page) {
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
}

async function deletePageByName(page, name) {
    await page.evaluate(async (targetName) => {
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        const res = await api('/api/pages');
        if (!res.ok) return;
        const list = await res.json();
        const keep = (list || []).filter((p) => String(p?.name || '') !== targetName);
        if (keep.length === (list || []).length) return;
        await api('/api/pages', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(keep),
        });
    }, name);
}

async function deleteCategoryByName(page, pageId, name) {
    await page.evaluate(async ({ targetPageId, targetName }) => {
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        const res = await api(`/api/categories?page=${targetPageId}`);
        if (!res.ok) return;
        const list = await res.json();
        const keep = (list || []).filter((c) => String(c?.name || '') !== targetName);
        if (keep.length === (list || []).length) return;
        await api(`/api/categories?page=${targetPageId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(keep),
        });
    }, { targetPageId: pageId, targetName: name });
}

/** Open the pages overlay the way the header button does. */
async function openPageOverview(page) {
    await page.locator('#page-overview-header-btn').click();
    await expect(page.locator('#app-modal .page-overview-modal-list')).toBeVisible();
}

const overlayRow = (page) => page.locator('#app-modal .page-overview-modal-actions .bookmark-inline-create');
const gridRow = (page) => page.locator('.bookmark-inline-create.category-add-create');

/**
 * Hold c past the 300 ms threshold. A plain press() is too quick and is treated
 * as a search keystroke, which is the behaviour the hold exists to protect.
 */
async function holdC(page) {
    await page.keyboard.down('c');
    await page.waitForTimeout(450);
    await page.keyboard.up('c');
}

test.describe('pages overlay — creating a page', () => {
    test('the overlay offers a New page row below the pages', async ({ page }) => {
        await loadDashboard(page);
        await openPageOverview(page);

        const trigger = page.locator('#page-overview-new-page');
        await expect(trigger).toBeVisible();
        // It is an action, not a page: it must sit outside the listbox so screen
        // readers do not announce it as one more page to choose.
        await expect(page.locator('#app-modal .page-overview-modal-list #page-overview-new-page')).toHaveCount(0);
        await expect(overlayRow(page)).toBeHidden();
    });

    test('the name input is not clipped by the scrolling modal body', async ({ page }) => {
        await loadDashboard(page);
        // Enough pages that the list fills the modal — with only one page the
        // body does not reach its max height and nothing is close to the edge.
        const extras = [];
        for (let i = 0; i < 3; i += 1) {
            extras.push(`E2E clip ${Date.now()}-${i}`);
        }
        await page.evaluate(async (names) => {
            const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
            const list = await (await fetch('/api/pages')).json();
            let nextId = list.reduce((max, p) => Math.max(max, Number(p.id) || 0), 0);
            const payload = [...list, ...names.map((name) => ({ id: ++nextId, name }))];
            await api('/api/pages', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
        }, extras);
        await page.reload();
        await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
        await dismissBlockingOverlays(page);

        await openPageOverview(page);
        await page.locator('#page-overview-new-page').click();
        await expect(overlayRow(page)).toBeVisible();

        // The row is the last child of a scroll box. Ending flush with it means
        // overflow clipping eats the input's bottom border row.
        const gap = await page.evaluate(() => {
            const input = document.querySelector(
                '#app-modal .page-overview-modal-actions .bookmark-inline-create-input'
            );
            const body = document.querySelector('#app-modal .modal-body');
            if (!input || !body) return null;
            return body.getBoundingClientRect().bottom - input.getBoundingClientRect().bottom;
        });
        expect(gap).not.toBeNull();
        expect(gap).toBeGreaterThanOrEqual(1);

        for (const name of extras) {
            await deletePageByName(page, name);
        }
    });

    test('clicking it swaps the button for the name row', async ({ page }) => {
        await loadDashboard(page);
        await openPageOverview(page);

        await page.locator('#page-overview-new-page').click();
        await expect(overlayRow(page)).toBeVisible();
        await expect(page.locator('#page-overview-new-page')).toBeHidden();
        await expect(overlayRow(page).locator('.bookmark-inline-create-input')).toBeFocused();
    });

    test('n opens the name row from the keyboard', async ({ page }) => {
        await loadDashboard(page);
        await openPageOverview(page);

        await page.keyboard.press('n');
        await expect(overlayRow(page)).toBeVisible();
        await expect(overlayRow(page).locator('.bookmark-inline-create-input')).toBeFocused();
    });

    test('cancel puts the button back and keeps the overlay open', async ({ page }) => {
        await loadDashboard(page);
        await openPageOverview(page);

        await page.locator('#page-overview-new-page').click();
        await overlayRow(page).locator('.bookmark-inline-create-cancel').click();

        await expect(overlayRow(page)).toBeHidden();
        await expect(page.locator('#page-overview-new-page')).toBeVisible();
        await expect(page.locator('#app-modal .page-overview-modal-list')).toBeVisible();
    });

    test('Escape closes the name row, not the whole overlay', async ({ page }) => {
        await loadDashboard(page);
        await openPageOverview(page);

        await page.locator('#page-overview-new-page').click();
        await expect(overlayRow(page)).toBeVisible();
        await page.keyboard.press('Escape');

        await expect(overlayRow(page)).toBeHidden();
        // The pages list survives: one Escape backs out of the row only.
        await expect(page.locator('#app-modal .page-overview-modal-list')).toBeVisible();
    });

    test('typing a digit in the name row does not switch page', async ({ page }) => {
        await loadDashboard(page);
        const startPage = await page.evaluate(() => Number(window.dashboardInstance.currentPageId));
        await openPageOverview(page);

        await page.locator('#page-overview-new-page').click();
        await overlayRow(page).locator('.bookmark-inline-create-input').fill('');
        await page.keyboard.type('2nd quarter');

        await expect(overlayRow(page).locator('.bookmark-inline-create-input')).toHaveValue('2nd quarter');
        const nowPage = await page.evaluate(() => Number(window.dashboardInstance.currentPageId));
        expect(nowPage).toBe(startPage);
    });

    test('creating a page persists it and navigates there', async ({ page }) => {
        await loadDashboard(page);
        const name = `E2E overlay ${Date.now()}`;
        await openPageOverview(page);

        await page.locator('#page-overview-new-page').click();
        await overlayRow(page).locator('.bookmark-inline-create-input').fill(name);
        await overlayRow(page).locator('.bookmark-inline-create-ok').click();

        // The overlay closes and the dashboard lands on the page just made.
        await expect(page.locator('#app-modal .page-overview-modal-list')).toBeHidden();
        await page.waitForFunction((wanted) => {
            const d = window.dashboardInstance;
            const current = (d.pages || []).find((p) => Number(p.id) === Number(d.currentPageId));
            return String(current?.name || '') === wanted;
        }, name, { timeout: 10_000 });

        const stored = await page.evaluate(async () => {
            const res = await fetch('/api/pages');
            return res.ok ? await res.json() : [];
        });
        expect(stored.some((p) => p.name === name)).toBe(true);

        await deletePageByName(page, name);
    });

    test('a duplicate name is refused with the conflict message', async ({ page }) => {
        await loadDashboard(page);
        const existing = await page.evaluate(() => String(window.dashboardInstance.pages[0].name || ''));
        await openPageOverview(page);

        await page.locator('#page-overview-new-page').click();
        await overlayRow(page).locator('.bookmark-inline-create-input').fill(existing);
        await overlayRow(page).locator('.bookmark-inline-create-ok').click();

        await expect(overlayRow(page).locator('.bookmark-inline-conflict')).toBeVisible();
        // Still open on the failure, so the name can be corrected in place.
        await expect(overlayRow(page)).toBeVisible();
        await expect(page.locator('#app-modal .page-overview-modal-list')).toBeVisible();
    });
});

test.describe('dashboard grid — adding a category', () => {
    test('the grid shows a + category placeholder', async ({ page }) => {
        await loadDashboard(page);
        await expect(page.locator('#category-add-placeholder-btn')).toBeVisible();
    });

    test('the placeholder is not a category, so it cannot be drag-reordered', async ({ page }) => {
        await loadDashboard(page);
        const tile = page.locator('.category-add-placeholder');
        await expect(tile).toHaveCount(1);
        // The reorder instances select `.category`; a placeholder matching that
        // would be draggable and droppable between real categories.
        await expect(page.locator('.category-add-placeholder.category')).toHaveCount(0);
        await expect(page.locator('.category-add-placeholder.category-reorder-item')).toHaveCount(0);
    });

    test('holding c opens the name row without a bookmark focused', async ({ page }) => {
        await loadDashboard(page);
        await holdC(page);

        await expect(gridRow(page)).toBeVisible();
        await expect(gridRow(page).locator('.bookmark-inline-create-input')).toBeFocused();
    });

    test('a quick c types into the shortcut search instead of adding a category', async ({ page }) => {
        await loadDashboard(page);
        // The whole point of the hold: c is a letter people search with, so a tap
        // must reach the search box and leave the grid alone.
        await page.keyboard.press('c');

        await expect.poll(async () => page.evaluate(() => {
            const search = document.getElementById('shortcut-search');
            if (!search?.classList.contains('show')) return null;
            return String(window.dashboardInstance?.searchComponent?.currentQuery || '');
        }), { timeout: 5000 }).toBe('C');
        await expect(gridRow(page)).toHaveCount(0);
    });

    test('the hold still works a second time', async ({ page }) => {
        await loadDashboard(page);
        await holdC(page);
        await expect(gridRow(page)).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(gridRow(page)).toHaveCount(0);

        // Opening the row moves focus into its input, and the keyup handler bails
        // on INPUT targets before it can clear the awaiting-release flag. Unless
        // the hold clears that itself, the flag stays set and every later hold is
        // skipped as "already awaiting" — the shortcut dies after one use.
        await holdC(page);
        await expect(gridRow(page)).toBeVisible();
    });

    test('c while typing in the name row types a c instead of reopening', async ({ page }) => {
        await loadDashboard(page);
        await holdC(page);
        await expect(gridRow(page)).toBeVisible();

        await page.keyboard.type('abc');
        await expect(gridRow(page).locator('.bookmark-inline-create-input')).toHaveValue('abc');
        await expect(gridRow(page)).toHaveCount(1);
    });

    test('clicking the placeholder opens the name row in its place', async ({ page }) => {
        await loadDashboard(page);
        await page.locator('#category-add-placeholder-btn').click();

        await expect(gridRow(page)).toBeVisible();
        await expect(page.locator('#category-add-placeholder-btn')).toBeHidden();
    });

    test('cancel restores the placeholder', async ({ page }) => {
        await loadDashboard(page);
        await page.locator('#category-add-placeholder-btn').click();
        await gridRow(page).locator('.bookmark-inline-create-cancel').click();

        await expect(gridRow(page)).toHaveCount(0);
        await expect(page.locator('#category-add-placeholder-btn')).toBeVisible();
    });

    test('creating a category persists it on the current page', async ({ page }) => {
        await loadDashboard(page);
        const name = `E2E grid ${Date.now()}`;
        const pageId = await page.evaluate(() => Number(window.dashboardInstance.currentPageId));

        await page.locator('#category-add-placeholder-btn').click();
        await gridRow(page).locator('.bookmark-inline-create-input').fill(name);
        await gridRow(page).locator('.bookmark-inline-create-ok').click();

        await expect(gridRow(page)).toHaveCount(0);
        const stored = await page.evaluate(async (pid) => {
            const res = await fetch(`/api/categories?page=${pid}`);
            return res.ok ? await res.json() : [];
        }, pageId);
        expect(stored.some((c) => c.name === name)).toBe(true);

        await deleteCategoryByName(page, pageId, name);
    });

    test('the new category shows even with hide-empty categories on', async ({ page }) => {
        await loadDashboard(page);
        const hideEmpty = await page.evaluate(() => window.dashboardInstance.settings?.hideEmptyCategories === true);
        test.skip(!hideEmpty, 'hide empty categories is off for this profile');

        const name = `E2E pinned ${Date.now()}`;
        const pageId = await page.evaluate(() => Number(window.dashboardInstance.currentPageId));

        await page.locator('#category-add-placeholder-btn').click();
        await gridRow(page).locator('.bookmark-inline-create-input').fill(name);
        await gridRow(page).locator('.bookmark-inline-create-ok').click();

        // Empty and the setting says hide empties — but it was just created, so
        // hiding it would make the create look like it did nothing.
        await expect(page.locator('.category-title', { hasText: name })).toBeVisible({ timeout: 10_000 });

        await deleteCategoryByName(page, pageId, name);
    });

    test('the pinned category goes back to hidden after leaving the page', async ({ page }) => {
        await loadDashboard(page);
        const hideEmpty = await page.evaluate(() => window.dashboardInstance.settings?.hideEmptyCategories === true);
        test.skip(!hideEmpty, 'hide empty categories is off for this profile');

        const name = `E2E unpin ${Date.now()}`;
        const otherPageName = `E2E away ${Date.now()}`;
        const pageId = await page.evaluate(() => Number(window.dashboardInstance.currentPageId));

        // Make the page to navigate away to rather than skipping: the default
        // profile has one page, so a skip here meant this never ran at all.
        await page.evaluate(async (pageName) => {
            await window.dashboardInstance.structureCreate.createPageFromForm(pageName);
        }, otherPageName);

        await page.locator('#category-add-placeholder-btn').click();
        await gridRow(page).locator('.bookmark-inline-create-input').fill(name);
        await gridRow(page).locator('.bookmark-inline-create-ok').click();
        await expect(page.locator('.category-title', { hasText: name })).toBeVisible({ timeout: 10_000 });

        // The pin is a courtesy for the page you made it on, not a permanent
        // override of the setting: going away and back applies hide-empty again.
        await page.evaluate(async () => {
            const d = window.dashboardInstance;
            const other = d.pages.find((p) => Number(p.id) !== Number(d.currentPageId));
            await d.requestPageNavigation(other.id);
        });
        await page.evaluate(async (target) => {
            await window.dashboardInstance.requestPageNavigation(target);
        }, pageId);

        await expect(page.locator('.category-title', { hasText: name })).toHaveCount(0);

        await deleteCategoryByName(page, pageId, name);
        await deletePageByName(page, otherPageName);
    });

    test('a duplicate category name is refused in place', async ({ page }) => {
        await loadDashboard(page);
        const existing = await page.evaluate(() => String(window.dashboardInstance.categories[0]?.name || ''));
        test.skip(!existing, 'page has no categories to collide with');

        await page.locator('#category-add-placeholder-btn').click();
        await gridRow(page).locator('.bookmark-inline-create-input').fill(existing);
        await gridRow(page).locator('.bookmark-inline-create-ok').click();

        await expect(gridRow(page).locator('.bookmark-inline-conflict')).toBeVisible();
        await expect(gridRow(page)).toBeVisible();
    });

    test('the name row is labelled for screen readers', async ({ page }) => {
        await loadDashboard(page);
        await holdC(page);

        // A placeholder is not a name: without aria-label the field is announced
        // as unlabelled, and the conflict message is never announced at all.
        const input = gridRow(page).locator('.bookmark-inline-create-input');
        await expect(input).toHaveAttribute('aria-label', /.+/);
        await expect(gridRow(page)).toHaveAttribute('role', 'group');
        await expect(gridRow(page)).toHaveAttribute('aria-label', /.+/);
        await expect(gridRow(page).locator('.bookmark-inline-conflict'))
            .toHaveAttribute('aria-live', 'polite');
    });
});

test.describe('category header — right-click menu', () => {
    const menu = (page) => page.locator('#category-context-menu');

    async function openCategoryMenu(page) {
        const title = page.locator('.category:not([data-smart-collection="true"]) .category-title').first();
        await title.click({ button: 'right' });
        await expect(menu(page)).toBeVisible();
        return title;
    }

    test('right-clicking a category header opens rename / add / delete', async ({ page }) => {
        await loadDashboard(page);
        await openCategoryMenu(page);

        await expect(menu(page).locator('[data-action="rename"]')).toBeVisible();
        await expect(menu(page).locator('[data-action="add"]')).toBeVisible();
        await expect(menu(page).locator('[data-action="delete"]')).toBeVisible();
    });

    test('smart collections get no menu — there is nothing to rename', async ({ page }) => {
        await loadDashboard(page);
        const smart = page.locator('.category[data-smart-collection="true"] .category-title').first();
        test.skip(await smart.count() === 0, 'no smart collection on this page');

        await smart.click({ button: 'right' });
        await expect(menu(page)).toHaveCount(0);
    });

    test('Escape closes the menu', async ({ page }) => {
        await loadDashboard(page);
        await openCategoryMenu(page);
        await page.keyboard.press('Escape');
        await expect(menu(page)).toHaveCount(0);
    });

    test('rename opens the inline editor on the header', async ({ page }) => {
        await loadDashboard(page);
        const title = await openCategoryMenu(page);
        await menu(page).locator('[data-action="rename"]').click();

        await expect(title.locator('.category-rename-input')).toBeVisible();
    });

    test('delete warns that the bookmarks keep existing without a category', async ({ page }) => {
        await loadDashboard(page);
        const name = `E2E delcat ${Date.now()}`;
        const pageId = await page.evaluate(() => Number(window.dashboardInstance.currentPageId));

        // Made through the real add flow rather than the API: that is what pins a
        // new empty category on screen, and without the pin "hide empty
        // categories" would swallow it before it could be right-clicked.
        await page.locator('#category-add-placeholder-btn').click();
        await gridRow(page).locator('.bookmark-inline-create-input').fill(name);
        await gridRow(page).locator('.bookmark-inline-create-ok').click();
        const title = page.locator('.category-title', { hasText: name }).first();
        await expect(title).toBeVisible({ timeout: 10_000 });

        await title.click({ button: 'right' });
        await menu(page).locator('[data-action="delete"]').click();
        await expect(page.locator('#app-modal.show')).toBeVisible();

        // Confirm is the first button in the actions row; cancel follows it.
        await page.locator('#app-modal #modal-actions .modal-button').first().click();
        await expect(page.locator('.category-title', { hasText: name })).toHaveCount(0, { timeout: 10_000 });

        const stored = await page.evaluate(async (pid) => {
            const res = await fetch(`/api/categories?page=${pid}`);
            return res.ok ? await res.json() : [];
        }, pageId);
        expect(stored.some((c) => c.name === name)).toBe(false);
    });
});

test.describe('commands — :page new and :category new', () => {
    async function runCommand(page, command) {
        return page.evaluate(async (cmd) => {
            const dash = window.dashboardInstance;
            const commands = dash.searchComponent.commandsComponent;
            const [name, ...args] = cmd.replace(/^:/, '').split(/\s+/);
            const rows = await commands.availableCommands[name](args, cmd);
            return (rows || []).map((r) => ({ name: r.name, type: r.type, completion: r.completion || null }));
        }, command);
    }

    test(':page lists an option that completes to :page new', async ({ page }) => {
        await loadDashboard(page);
        const rows = await runCommand(page, ':page');
        const newRow = rows.find((r) => r.completion === ':page new ');
        expect(newRow).toBeTruthy();
        expect(newRow.type).toBe('command-completion');
    });

    test(':page new without a name prompts rather than creating', async ({ page }) => {
        await loadDashboard(page);
        const before = await page.evaluate(async () => (await (await fetch('/api/pages')).json()).length);
        const rows = await runCommand(page, ':page new');

        expect(rows).toHaveLength(1);
        expect(rows[0].type).toBe('command');
        const after = await page.evaluate(async () => (await (await fetch('/api/pages')).json()).length);
        expect(after).toBe(before);
    });

    test(':category new offers a create row on a page with categories', async ({ page }) => {
        await loadDashboard(page);
        const rows = await runCommand(page, ':category new Roadmap');
        expect(rows).toHaveLength(1);
        expect(rows[0].type).toBe('command');
        expect(rows[0].name).toContain('Roadmap');
    });

    test(':category still jumps rather than creating for an ordinary query', async ({ page }) => {
        await loadDashboard(page);
        const rows = await runCommand(page, ':category');
        // The listing keeps its jump entries; create is the last option.
        expect(rows.length).toBeGreaterThan(1);
        expect(rows[rows.length - 1].completion).toBe(':category new ');
    });
});
