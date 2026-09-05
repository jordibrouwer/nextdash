// @ts-check
const { test, expect } = require('./fixtures');
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
 * c adds a category on the first press.
 *
 * It used to need a hold of about 300 ms so a tap could still fall through to
 * the shortcut search; that made it one of two bare letters with a rule of
 * their own, and the wait was paid on every use.
 */
async function pressC(page) {
    await page.keyboard.press('c');
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
        // What this guards against is a clipped bottom border: a gap of zero or
        // less. The exact figure lands on sub-pixel boundaries -- 0.9957 on the
        // shared spacing scale -- so it asks for daylight rather than for a
        // whole pixel of it.
        expect(gap).toBeGreaterThan(0);

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
    test('the grid shows a + in a category header', async ({ page }) => {
        await loadDashboard(page);
        await expect(page.locator('#category-add-placeholder-btn')).toBeVisible();
    });

    test('exactly one +, and it sits in the header that ends the grid', async ({ page }) => {
        await loadDashboard(page);
        // One button, not one per category: eight identical buttons doing the
        // same thing is the clutter the old full-width tile was replaced to fix.
        await expect(page.locator('.category-add-inline-btn')).toHaveCount(1);

        // "Ends the grid" is a layout fact, not a list-order one: with packed
        // columns the last block routinely renders in the middle of the screen.
        const ok = await page.evaluate(() => {
            const btn = document.querySelector('.category-add-inline-btn');
            const host = btn?.closest('.category');
            if (!host) return { ok: false, why: 'no host' };
            const hosts = [...document.querySelectorAll('.category')]
                .filter((el) => el.getAttribute('data-smart-collection') !== 'true');
            const hr = host.getBoundingClientRect();
            const lower = hosts.filter((el) => Math.round(el.getBoundingClientRect().bottom) > Math.round(hr.bottom));
            return { ok: lower.length === 0, why: `${lower.length} categories end lower` };
        });
        expect(ok.why).toBe('0 categories end lower');
        expect(ok.ok).toBe(true);
    });

    test('the + costs no row of its own', async ({ page }) => {
        await loadDashboard(page);
        // The old placeholder was `grid-column: 1 / -1`, so it took a full empty
        // row — measured at 110px on a five-column layout. Living in a header it
        // must not add height at all.
        const delta = await page.evaluate(() => {
            const grid = document.querySelector('.dashboard-grid');
            const before = grid.getBoundingClientRect().height;
            const btn = document.querySelector('.category-add-inline-btn');
            btn.style.display = 'none';
            const after = grid.getBoundingClientRect().height;
            btn.style.display = '';
            return Math.round(before - after);
        });
        expect(delta).toBe(0);
    });

    test('c opens the name row without a bookmark focused', async ({ page }) => {
        await loadDashboard(page);
        await pressC(page);

        await expect(gridRow(page)).toBeVisible();
        await expect(gridRow(page).locator('.bookmark-inline-create-input')).toBeFocused();
    });

    test('a quick c adds a category rather than reaching the shortcut search', async ({ page }) => {
        await loadDashboard(page);
        // The hold is gone: a tap is the shortcut now, and the search box must
        // not open behind it.
        await page.keyboard.press('c');

        await expect(gridRow(page)).toBeVisible();
        await expect(page.locator('#shortcut-search.show')).toHaveCount(0);
    });

    test('c still works a second time', async ({ page }) => {
        await loadDashboard(page);
        await pressC(page);
        await expect(gridRow(page)).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(gridRow(page)).toHaveCount(0);

        await pressC(page);
        await expect(gridRow(page)).toBeVisible();
    });

    test('c while typing in the name row types a c instead of reopening', async ({ page }) => {
        await loadDashboard(page);
        await pressC(page);
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
        await pressC(page);

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
            // The palette ships in the lazily fetched search bundle, so on a
            // cold load searchComponent is still null here -- which is what
            // "Cannot read properties of null (reading 'commandsComponent')"
            // was, three times over. Ask the loader instead of reading a field
            // that may not be filled yet.
            const search = dash.searchComponent || await window.SearchLoader?.ensureReady?.();
            const commands = search.commandsComponent;
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
