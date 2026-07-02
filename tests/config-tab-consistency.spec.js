// @ts-check
const { test, expect } = require('@playwright/test');

/** @param {number} actual @param {number} expected @param {number} [tolerance=3] */
function expectWidthNear(actual, expected, tolerance = 3) {
    expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tolerance);
}

/** @param {import('@playwright/test').Page} page */
async function applyClassicLayout(page) {
    await page.evaluate(() => {
        document.documentElement.setAttribute('data-layout-version', 'classic');
        document.body.setAttribute('data-layout-version', 'classic');
    });
}

async function skipConfigTours(page) {
    await page.addInitScript(() => {
        try {
            localStorage.setItem('nextdash:config-general-tour-v1', '1');
            localStorage.setItem('nextdash:config-tags-tour-v1', '1');
            localStorage.setItem('nextdash:config-collections-tour-v1', '1');
        } catch {
            // ignore
        }
    });
}

async function waitForConfigReady(page) {
    await skipConfigTours(page);
    await page.goto('/config#general');
    await page.waitForFunction(() => typeof window.configManager?.persistence !== 'undefined');
    await page.waitForSelector('.general-layout', { timeout: 20_000 });
    await page.evaluate(() => {
        const cm = window.configManager;
        if (cm?.settingsData) {
            cm.settingsData.configGeneralTourCompleted = true;
            cm.settingsData.configTagsTourCompleted = true;
            cm.settingsData.configCollectionsTourCompleted = true;
        }
        window.ConfigGeneralTour?.teardownStaleDom?.();
        window.ConfigTagsTour?.teardownStaleDom?.();
        window.ConfigCollectionsTour?.teardownStaleDom?.();
        cm._configGeneralTourActive = false;
        cm._configTagsTourActive = false;
        cm._configCollectionsTourActive = false;
        cm.ui.switchToTab('general');
    });
    await page.waitForSelector('#columns-input', { timeout: 15_000 });
}

/** @param {import('@playwright/test').Page} page */
async function stripAllBookmarkTags(page) {
    await page.evaluate(async () => {
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        const pages = window.configManager?.pagesData || [{ id: 1 }];
        for (const p of pages) {
            const pageId = p.id;
            const response = await fetch(`/api/bookmarks?page=${pageId}`);
            if (!response.ok) {
                throw new Error(`fetch bookmarks failed for page ${pageId}: ${response.status}`);
            }
            const bookmarks = await response.json();
            const stripped = bookmarks.map((bookmark) => ({ ...bookmark, tags: [] }));
            const save = await api(`/api/bookmarks?page=${pageId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(stripped),
            });
            if (!save.ok) {
                throw new Error(`save bookmarks failed for page ${pageId}: ${save.status}`);
            }
        }
        await window.configManager?.tabs?.reloadTagsTabData?.();
    });
}

test.describe('config tab consistency (v2 empty states & v2b save UX)', () => {
    test.describe.configure({ mode: 'serial' });

    test.beforeEach(async ({ page }) => {
        await page.setViewportSize({ width: 1280, height: 800 });
        await waitForConfigReady(page);
    });

    test('tags empty state CTA switches to bookmarks tab', async ({ page }) => {
        await stripAllBookmarkTags(page);

        await page.evaluate(async () => {
            window.configManager.ui.switchToTab('tags');
            await window.configManager.reloadTagsTabData();
        });
        await page.waitForSelector('[data-tab-content="tags"].active', { timeout: 10_000 });

        await expect(page.locator('#tags-empty-state')).toBeVisible();
        await expect(page.locator('#tags-empty-cta')).toBeVisible();
        await expect(page.locator('#tags-body')).toBeHidden();

        await page.locator('#tags-empty-cta').click();

        await expect(page.locator('[data-tab-content="bookmarks"].active')).toBeVisible();
        await expect(page.locator('.tab-button[data-tab="bookmarks"]')).toHaveClass(/active/);
    });

    test('collections empty state CTA opens new collection editor', async ({ page }) => {
        await page.evaluate(() => {
            const cm = window.configManager;
            cm.settingsData.collections = [];
            cm.ui.switchToTab('collections');
            cm.collections.refresh(cm);
        });
        await page.waitForSelector('[data-tab-content="collections"].active', { timeout: 10_000 });

        await expect(page.locator('#collections-empty-state')).toBeVisible();
        await expect(page.locator('#collections-empty-cta')).toBeVisible();
        await expect(page.locator('#collections-list .collection-item')).toHaveCount(0);

        await page.locator('#collections-empty-cta').click();

        await expect(page.locator('#collections-edit-panel')).toBeVisible();
        await expect(page.locator('#col-edit-name')).toBeVisible();
        await expect(page.locator('#collections-empty-state')).toBeHidden();
    });

    test('save status line shows Saved then Unsaved; retires unsaved badge', async ({ page }) => {
        const status = page.locator('#save-status-indicator');
        const badge = page.locator('#unsaved-indicator');

        await expect(status).toBeVisible();
        await expect(status).toHaveText(/saved/i);
        await expect(status).not.toHaveClass(/is-unsaved/);
        await expect(badge).toBeHidden();

        const before = await page.evaluate(() => window.configManager.settingsData.columnsPerRow);
        const next = before >= 6 ? 2 : before + 1;

        await page.locator('#columns-input').fill(String(next));
        await page.locator('#columns-input').dispatchEvent('input');
        await page.locator('#columns-input').dispatchEvent('change');

        await expect.poll(() => page.evaluate(() => window.configManager.isDirty)).toBe(true);
        await expect(status).toHaveClass(/is-unsaved/);
        await expect(status).toHaveText(/unsaved/i);
        await expect(badge).toBeHidden();
    });

    test('sticky save bar syncs hint and body class when dirty and scrolled', async ({ page }) => {
        const before = await page.evaluate(() => window.configManager.settingsData.columnsPerRow);
        const next = before >= 6 ? 2 : before + 1;

        await page.locator('#columns-input').fill(String(next));
        await page.locator('#columns-input').dispatchEvent('input');
        await page.locator('#columns-input').dispatchEvent('change');
        await expect.poll(() => page.evaluate(() => window.configManager.isDirty)).toBe(true);

        await page.evaluate(() => window.scrollTo(0, 400));
        await expect.poll(() => page.evaluate(() => document.body.classList.contains('config-sticky-save-visible')))
            .toBe(true);
        await expect(page.locator('#config-save-sticky')).toHaveClass(/is-scroll-active/);
        await expect(page.locator('.config-save-sticky-hint')).toHaveText(/unsaved/i);
    });

    test('tab save mode pill reflects Requires Save, Auto-save, and Read-only', async ({ page }) => {
        const pill = page.locator('#config-tab-save-mode');

        await page.evaluate(() => window.configManager.ui.switchToTab('general'));
        await expect(pill).toBeVisible();
        await expect(pill).toHaveClass(/config-tab-save-mode--requires-save/);
        await expect(pill).toHaveText(/requires save/i);

        await page.evaluate(() => window.configManager.ui.switchToTab('tags'));
        await expect(pill).toHaveClass(/config-tab-save-mode--auto-save/);
        await expect(pill).toHaveText(/auto-save/i);

        await page.evaluate(() => window.configManager.ui.switchToTab('stats'));
        await expect(pill).toHaveClass(/config-tab-save-mode--read-only/);
        await expect(pill).toHaveText(/read-only/i);

        await page.evaluate(() => window.configManager.ui.switchToTab('colors'));
        await expect(pill).toHaveClass(/config-tab-save-mode--colors-save/);
        await expect(pill).toHaveText(/save colors/i);
    });
});

test.describe('config tab consistency v3 navigation', () => {
    test.beforeEach(async ({ page }) => {
        await page.setViewportSize({ width: 1280, height: 800 });
        await waitForConfigReady(page);
    });

    test('bookmarks breadcrumb includes page and category context', async ({ page }) => {
        await page.evaluate(async () => {
            const cm = window.configManager;
            await cm.ui.switchToTab('bookmarks');
            await cm.loadPageBookmarks(cm.currentPageId);
            cm.currentBookmarksCategoryFilter = 'development';
            const filter = document.getElementById('bookmarks-category-filter');
            if (filter) filter.value = 'development';
            cm.ui.refreshTabBreadcrumb('bookmarks');
        });

        const crumb = page.locator('#config-breadcrumb');
        await expect(crumb).toContainText(/bookmarks/i);
        await expect(crumb).toContainText(/main/i);
        await expect(crumb).toContainText(/development/i);
    });

    test('empty states toggle via hidden property not inline display (B11)', async ({ page }) => {
        const ok = await page.evaluate(() => {
            const tagsEmpty = document.getElementById('tags-empty-state');
            const collectionsEmpty = document.getElementById('collections-empty-state');
            if (!tagsEmpty || !collectionsEmpty) return false;
            tagsEmpty.hidden = true;
            tagsEmpty.hidden = false;
            collectionsEmpty.hidden = true;
            collectionsEmpty.hidden = false;
            return !tagsEmpty.style.display && !collectionsEmpty.style.display;
        });
        expect(ok).toBe(true);
    });

    test('categories breadcrumb includes selected page name', async ({ page }) => {
        await page.evaluate(async () => {
            const cm = window.configManager;
            await cm.ui.switchToTab('categories');
            const pageId = cm.currentCategoriesPageId || cm.currentPageId || 1;
            await cm.loadPageCategories(pageId);
            cm.ui.refreshTabBreadcrumb('categories');
        });

        const crumb = page.locator('#config-breadcrumb');
        await expect(crumb).toContainText(/categories/i);
        await expect(crumb).toContainText(/main/i);
    });

    test('tags breadcrumb includes active filter (B14)', async ({ page }) => {
        await page.evaluate(async () => {
            const cm = window.configManager;
            await cm.ui.switchToTab('tags');
            await cm.reloadTagsTabData?.();
            const input = document.getElementById('tags-filter-input');
            if (input) {
                input.value = 'design';
                input.dispatchEvent(new Event('input', { bubbles: true }));
            }
        });

        const crumb = page.locator('#config-breadcrumb');
        await expect(crumb).toContainText(/tags/i);
        await expect(crumb).toContainText(/design/i);
    });

    test('stats breadcrumb includes section and period (B14)', async ({ page }) => {
        await page.evaluate(async () => {
            const cm = window.configManager;
            await cm.ui.switchToTab('stats');
            cm.stats._activeSectionId = 'stats-activity';
            cm.stats.sectionPeriods.activity = 30;
            cm.ui.refreshTabBreadcrumb('stats');
        });

        const crumb = page.locator('#config-breadcrumb');
        await expect(crumb).toContainText(/stats/i);
        await expect(crumb).toContainText(/activity/i);
        await expect(crumb).toContainText(/month/i);
    });

    test('collections breadcrumb includes editor selection (B14)', async ({ page }) => {
        await page.evaluate(() => {
            const cm = window.configManager;
            cm.settingsData.collections = [{
                id: 'work-focus',
                name: 'Work focus',
                icon: '▤',
                logic: 'and',
                rules: [{ field: 'tag', operator: 'includes', value: 'work' }],
            }];
            cm.ui.switchToTab('collections');
            cm.collections.refresh(cm);
            cm.collections._openEdit(cm.settingsData.collections[0], cm);
        });

        const crumb = page.locator('#config-breadcrumb');
        await expect(crumb).toContainText(/collections/i);
        await expect(crumb).toContainText(/work focus/i);
    });
});

test.describe('config tab consistency v3 phone block', () => {
    test('bookmarks hash on phone shows blocking card and keeps hash', async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        await skipConfigTours(page);
        await page.goto('/config#bookmarks');
        await page.waitForFunction(() => typeof window.configManager?.ui !== 'undefined');
        await page.waitForSelector('[data-tab-content="bookmarks"].active', { timeout: 20_000 });

        await expect(page).toHaveURL(/#bookmarks/);
        await expect(page.locator('#bookmarks-phone-block')).toBeVisible();
        await expect(page.locator('#bookmarks-tab-workspace')).toBeHidden();
        await expect(page.locator('.bookmarks-splitview')).toBeHidden();
    });

    test('unsupported phone hash still redirects to general', async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        await skipConfigTours(page);
        await page.goto('/config#pages');
        await page.waitForFunction(() => typeof window.configManager?.ui !== 'undefined');
        await page.waitForSelector('[data-tab-content="general"].active', { timeout: 20_000 });

        await expect(page).toHaveURL(/#general/);
    });
});

test.describe('config tab consistency v4 classic surfaces', () => {
    test.beforeEach(async ({ page }) => {
        await page.setViewportSize({ width: 1280, height: 800 });
        await waitForConfigReady(page);
        await applyClassicLayout(page);
    });

    test('pages tab wraps toolbar and list in config-tab-surface', async ({ page }) => {
        await page.evaluate(() => window.configManager.ui.switchToTab('pages'));
        const surface = page.locator('[data-tab-content="pages"] .config-tab-surface');
        await expect(surface).toBeVisible();
        await expect(surface.locator('.config-tab-toolbar--in-surface')).toBeVisible();
        await expect(surface.locator('#pages-list.simple-list')).toBeVisible();
    });

    test('classic layout applies surface shadow on pages card', async ({ page }) => {
        await page.evaluate(() => window.configManager.ui.switchToTab('pages'));
        const shadow = await page.locator('[data-tab-content="pages"] .config-tab-surface').evaluate((el) => {
            return window.getComputedStyle(el).boxShadow;
        });
        expect(shadow).not.toBe('none');
    });

    test('classic layout keeps config header separate from save row and tabs (C10 reverted)', async ({ page }) => {
        const chrome = await page.evaluate(() => {
            const header = document.querySelector('.config-page-shell > .config-section.section-header');
            const controls = document.querySelector('.config-page-shell > .config-section.section-controls');
            const actions = document.querySelector('.config-section.section-controls .config-actions-top');
            const tabsWrapper = document.querySelector('.config-section.section-controls .tabs-scroll-wrapper');
            if (!header || !controls || !actions || !tabsWrapper) return null;
            const hs = getComputedStyle(header);
            const as = getComputedStyle(actions);
            const ts = getComputedStyle(tabsWrapper);
            const headerRect = header.getBoundingClientRect();
            const controlsRect = controls.getBoundingClientRect();
            return {
                seamGap: controlsRect.top - headerRect.bottom,
                headerBoxShadow: hs.boxShadow,
                headerBorderWidth: hs.borderTopWidth,
                actionsBoxShadow: as.boxShadow,
                actionsBorderWidth: as.borderTopWidth,
                tabsBoxShadow: ts.boxShadow,
                tabsMarginTop: ts.marginTop,
            };
        });
        expect(chrome).not.toBeNull();
        expect(chrome.seamGap).toBeGreaterThan(4);
        expect(chrome.headerBoxShadow).toBe('none');
        expect(parseFloat(chrome.headerBorderWidth)).toBe(0);
        expect(chrome.actionsBoxShadow).not.toBe('none');
        expect(parseFloat(chrome.actionsBorderWidth)).toBeGreaterThan(0);
        expect(chrome.tabsBoxShadow).not.toBe('none');
        expect(parseFloat(chrome.tabsMarginTop)).toBeGreaterThan(0);
    });

    test('structure pages list items stay within column width', async ({ page }) => {
        await page.evaluate(async () => {
            const cm = window.configManager;
            await cm.ui.switchToTab('bookmarks');
            const card = document.getElementById('structure-workspace-card');
            card?.classList.remove('is-collapsed');
            document.getElementById('structure-workspace-toggle')?.setAttribute('aria-expanded', 'true');
            await cm.loadPageBookmarks(cm.currentPageId);
        });

        const item = page.locator('#structure-pages-list .structure-list-item').first();
        await expect(item).toBeVisible();
        const fits = await item.evaluate((el) => {
            const list = el.parentElement;
            return Boolean(list && el.offsetWidth <= list.clientWidth);
        });
        expect(fits).toBe(true);
    });

    test('context panel links open Pages and Categories tabs', async ({ page }) => {
        await page.evaluate(async () => {
            const cm = window.configManager;
            await cm.ui.switchToTab('bookmarks');
            document.getElementById('structure-workspace-card')?.classList.remove('is-collapsed');
        });

        await page.evaluate(() => {
            document.querySelector('[data-structure-goto-tab="pages"]')?.click();
        });
        await expect(page.locator('[data-tab-content="pages"].active')).toBeVisible();

        await page.evaluate(() => {
            window.configManager.ui.switchToTab('bookmarks');
            document.querySelector('[data-structure-goto-tab="categories"]')?.click();
        });
        await expect(page.locator('[data-tab-content="categories"].active')).toBeVisible();
    });

    test('context panel persists open state across reloads', async ({ page }) => {
        await page.evaluate(async () => {
            const cm = window.configManager;
            await cm.ui.switchToTab('bookmarks');
            localStorage.setItem('nextdash-config-structure-workspace-v1', '0');
            cm.applyStructureWorkspacePersistedState?.();
        });
        await expect(page.locator('#structure-workspace-card')).toHaveClass(/is-collapsed/);

        await page.evaluate(() => {
            document.getElementById('structure-workspace-toggle')?.click();
        });
        await expect(page.locator('#structure-workspace-card')).not.toHaveClass(/is-collapsed/);

        const stored = await page.evaluate(() => localStorage.getItem('nextdash-config-structure-workspace-v1'));
        expect(stored).toBe('1');

        await page.reload();
        await page.waitForFunction(() => typeof window.configManager?.applyStructureWorkspacePersistedState === 'function');
        await page.evaluate(() => window.configManager.ui.switchToTab('bookmarks'));
        await expect(page.locator('#structure-workspace-card')).not.toHaveClass(/is-collapsed/);
    });
});

test.describe('config tab surface box model', () => {
    test.beforeEach(async ({ page }) => {
        await page.setViewportSize({ width: 1280, height: 800 });
        await waitForConfigReady(page);
    });

  /** @param {import('@playwright/test').Page} page @param {string} tab */
    async function expectSurfaceToolbarFits(page, tab) {
        const fits = await page.evaluate((tabId) => {
            const surface = document.querySelector(`[data-tab-content="${tabId}"] .config-tab-surface`);
            const toolbar = surface?.querySelector('.config-tab-toolbar');
            if (!surface || !toolbar) return false;
            const surfaceRect = surface.getBoundingClientRect();
            const toolbarRect = toolbar.getBoundingClientRect();
            const buttons = [...toolbar.querySelectorAll('button, .btn')];
            const buttonsFit = buttons.every((btn) => btn.getBoundingClientRect().right <= surfaceRect.right + 0.5);
            return toolbar.offsetWidth <= surface.clientWidth + 0.5 && buttonsFit;
        }, tab);
        expect(fits).toBe(true);
    }

    test('pages tab toolbar fits inside surface card', async ({ page }) => {
        await page.evaluate(() => window.configManager.ui.switchToTab('pages'));
        await expectSurfaceToolbarFits(page, 'pages');
    });

    test('categories tab toolbar fits inside surface card', async ({ page }) => {
        await page.evaluate(async () => {
            const cm = window.configManager;
            await cm.ui.switchToTab('categories');
            await cm.loadPageCategories(cm.currentCategoriesPageId || cm.currentPageId || 1);
        });
        await expectSurfaceToolbarFits(page, 'categories');
    });

    test('collections tab toolbar fits inside surface card', async ({ page }) => {
        await page.evaluate(() => window.configManager.ui.switchToTab('collections'));
        await expectSurfaceToolbarFits(page, 'collections');
    });

    test('collections editor lives inside fused surface (B8)', async ({ page }) => {
        await page.evaluate(() => window.configManager.ui.switchToTab('collections'));
        const surface = page.locator('.collections-tab-surface');
        await expect(surface).toBeVisible();
        await expect(surface.locator('#collections-edit-panel')).toBeAttached();

        await page.locator('#add-collection-btn').click();
        await expect(surface.locator('#collections-edit-panel')).toBeVisible();
        await expect(surface.locator('#collections-list')).toBeHidden();

        const nestedSurfaces = await page.evaluate(() => (
            document.querySelectorAll('[data-tab-content="collections"] .config-tab-surface').length
        ));
        expect(nestedSurfaces).toBe(1);
    });

    test('finders tab toolbar fits inside surface card', async ({ page }) => {
        await page.evaluate(() => window.configManager.ui.switchToTab('finders'));
        await expectSurfaceToolbarFits(page, 'finders');
    });

    test('keyboard tab toolbar fits inside surface card', async ({ page }) => {
        await page.evaluate(() => window.configManager.ui.switchToTab('keyboard'));
        await expectSurfaceToolbarFits(page, 'keyboard');
    });

    test('keyboard tab uses list-shell surface', async ({ page }) => {
        await page.evaluate(() => window.configManager.ui.switchToTab('keyboard'));
        const shell = await page.evaluate(() => {
            const surface = document.querySelector('[data-tab-content="keyboard"] .config-tab-surface');
            const toolbar = surface?.querySelector('#keyboard-toolbar.config-tab-toolbar--in-surface');
            const body = surface?.querySelector('#keyboard-bindings-container.keyboard-body');
            const firstRow = body?.querySelector('.keyboard-binding-row');
            if (!surface || !toolbar || !body || !firstRow) return null;
            const rowStyle = getComputedStyle(firstRow);
            return {
                hasSurface: true,
                rowBackground: rowStyle.backgroundColor,
                rowBorderRadius: rowStyle.borderRadius,
            };
        });
        expect(shell).not.toBeNull();
        expect(shell?.hasSurface).toBe(true);
        expect(shell?.rowBorderRadius).toBe('0px');
    });

    test('tags tab toolbar fits inside surface card', async ({ page }) => {
        await page.evaluate(() => window.configManager.ui.switchToTab('tags'));
        await expectSurfaceToolbarFits(page, 'tags');
    });

    test('categories list action buttons fit inside surface card', async ({ page }) => {
        await page.evaluate(async () => {
            const cm = window.configManager;
            await cm.ui.switchToTab('categories');
            await cm.loadPageCategories(cm.currentCategoriesPageId || cm.currentPageId || 1);
        });
        const fits = await page.evaluate(() => {
            const surface = document.querySelector('[data-tab-content="categories"] .config-tab-surface');
            if (!surface) return false;
            const surfaceRect = surface.getBoundingClientRect();
            const actions = [...surface.querySelectorAll('.category-item-actions button')];
            if (actions.length === 0) return true;
            return actions.every((btn) => btn.getBoundingClientRect().right <= surfaceRect.right + 0.5);
        });
        expect(fits).toBe(true);
    });

    test('intro spacing matches between list tabs and bookmarks', async ({ page }) => {
        const measureGap = (tab) => page.evaluate((tabId) => {
            const root = document.querySelector(`[data-tab-content="${tabId}"] .config-tab-page`);
            const intro = root?.querySelector('.config-tab-intro');
            const body = tabId === 'bookmarks'
                ? root?.querySelector('.bookmarks-tab-workspace, .config-tab-surface')
                : root?.querySelector('.config-tab-surface');
            if (!intro || !body) return null;
            return body.getBoundingClientRect().top - intro.getBoundingClientRect().bottom;
        }, tab);

        await page.evaluate(() => window.configManager.ui.switchToTab('categories'));
        const categoriesGap = await measureGap('categories');

        await page.evaluate(() => window.configManager.ui.switchToTab('bookmarks'));
        const bookmarksGap = await measureGap('bookmarks');

        expect(categoriesGap).not.toBeNull();
        expect(bookmarksGap).not.toBeNull();
        expect(bookmarksGap).toBeGreaterThan(8);
        expect(bookmarksGap).toBeCloseTo(categoriesGap, 0);
    });

    test('general tab intro has spacing before config chrome', async ({ page }) => {
        await page.evaluate(() => window.configManager.ui.switchToTab('general'));
        const gap = await page.evaluate(() => {
            const intro = document.querySelector('[data-tab-content="general"] .general-tab-intro');
            const chrome = document.getElementById('general-config-chrome');
            if (!intro || !chrome) return null;
            return chrome.getBoundingClientRect().top - intro.getBoundingClientRect().bottom;
        });
        expect(gap).not.toBeNull();
        expect(gap).toBeGreaterThan(8);
    });
});

test.describe('config list shell polish (A2/A6/A10/B6)', () => {
    test.beforeEach(async ({ page }) => {
        await page.setViewportSize({ width: 1280, height: 800 });
        await waitForConfigReady(page);
    });

    test('list tabs expose canonical config-list-tab class (A2)', async ({ page }) => {
        for (const tab of ['pages', 'categories', 'tags', 'finders', 'collections']) {
            await page.evaluate((tabId) => window.configManager.ui.switchToTab(tabId), tab);
            await expect(page.locator(`[data-tab-content="${tab}"] .config-list-tab`)).toBeVisible();
        }
    });

    test('finders filter lives in toolbar with shared filter field (A6)', async ({ page }) => {
        await page.evaluate(() => window.configManager.ui.switchToTab('finders'));
        const toolbar = page.locator('[data-tab-content="finders"] .config-tab-toolbar--with-filter');
        await expect(toolbar).toBeVisible();
        await expect(toolbar.locator('#finders-filter-input.config-filter-input')).toBeVisible();
        await expect(toolbar.locator('#finders-filter-clear.config-filter-clear')).toBeAttached();
        await expect(page.locator('[data-tab-content="finders"] .finders-filter-wrap')).toHaveCount(1);
    });

    test('general layout uses config-tab-gap vertical rhythm (B6)', async ({ page }) => {
        await page.evaluate(() => window.configManager.ui.switchToTab('general'));
        const gaps = await page.evaluate(() => {
            const layout = document.querySelector('.general-layout');
            if (!layout) return null;
            const layoutGap = parseFloat(getComputedStyle(layout).rowGap);
            const probe = document.createElement('div');
            probe.style.gap = 'var(--config-tab-gap, 0.85rem)';
            document.body.appendChild(probe);
            const tokenGap = parseFloat(getComputedStyle(probe).rowGap);
            document.body.removeChild(probe);
            return { layoutGap, tokenGap };
        });
        expect(gaps).not.toBeNull();
        expect(gaps.layoutGap).toBeCloseTo(gaps.tokenGap, 0);
        expect(gaps.layoutGap).toBeGreaterThan(12);
    });

    test('general action list rows match list-tab row rhythm (A10)', async ({ page }) => {
        const metrics = await page.evaluate(() => {
            const cm = window.configManager;
            cm.ui.switchToTab('general');
            cm.generalLayers?.switchLayer?.('advanced');
            const details = document.querySelector('.tour-resets-details');
            if (details) details.open = true;
            const actionRow = document.querySelector('.config-action-list .config-advanced-action-row');
            if (!actionRow) return null;
            const actionStyle = getComputedStyle(actionRow);

            cm.ui.switchToTab('pages');
            const listRow = document.querySelector('#pages-list .page-item-row');
            if (!listRow) return null;
            const listStyle = getComputedStyle(listRow);
            return {
                actionMinHeight: parseFloat(actionStyle.minHeight),
                listMinHeight: parseFloat(listStyle.minHeight),
                actionPaddingTop: parseFloat(actionStyle.paddingTop),
                listPaddingTop: parseFloat(listStyle.paddingTop),
            };
        });
        expect(metrics).not.toBeNull();
        expect(metrics.actionMinHeight).toBeCloseTo(metrics.listMinHeight, 0);
        expect(metrics.actionPaddingTop).toBeCloseTo(metrics.listPaddingTop, 1);
    });
});

test.describe('config tab groups (v5)', () => {
    test.beforeEach(async ({ page }) => {
        await page.setViewportSize({ width: 1280, height: 800 });
        await waitForConfigReady(page);
    });

    test('renders System, Dashboard, Extras, and Help groups with expected tabs', async ({ page }) => {
        await expect(page.locator('.config-tab-group[data-tab-group="system"] .tab-button')).toHaveCount(5);
        await expect(page.locator('.config-tab-group[data-tab-group="dashboard"] .tab-button')).toHaveCount(3);
        await expect(page.locator('.config-tab-group[data-tab-group="extras"] .tab-button')).toHaveCount(3);
        await expect(page.locator('.config-tab-group[data-tab-group="help"] .tab-button')).toHaveCount(1);

        await expect(page.locator('.config-tab-group-label[data-i18n="config.tabGroupSystem"]')).toBeVisible();
        await expect(page.locator('.config-tab-group-label[data-i18n="config.tabGroupDashboard"]')).toBeVisible();
        await expect(page.locator('.config-tab-group-label[data-i18n="config.tabGroupExtras"]')).toBeVisible();
        await expect(page.locator('.config-tab-group-label[data-i18n="config.tabGroupHelp"]')).toBeVisible();
    });

    test('highlights active group when switching tabs', async ({ page }) => {
        await page.evaluate(() => window.configManager.ui.switchToTab('pages'));
        await expect(page.locator('.config-tab-group[data-tab-group="dashboard"]')).toHaveClass(/config-tab-group--active/);

        await page.evaluate(() => window.configManager.ui.switchToTab('finders'));
        await expect(page.locator('.config-tab-group[data-tab-group="extras"]')).toHaveClass(/config-tab-group--active/);

        await page.evaluate(() => window.configManager.ui.switchToTab('general'));
        await expect(page.locator('.config-tab-group[data-tab-group="system"]')).toHaveClass(/config-tab-group--active/);

        await page.evaluate(() => window.configManager.ui.switchToTab('help'));
        await expect(page.locator('.config-tab-group[data-tab-group="help"]')).toHaveClass(/config-tab-group--active/);

        await page.evaluate(() => window.configManager.ui.switchToTab('keyboard'));
        await expect(page.locator('.config-tab-group[data-tab-group="system"]')).toHaveClass(/config-tab-group--active/);
        await expect(page.locator('.tab-button[data-tab="keyboard"]')).toHaveClass(/active/);
    });

    test('shows unsaved dot on System group when General is dirty (C14)', async ({ page }) => {
        await page.evaluate(() => window.configManager.ui.switchToTab('general'));
        await page.evaluate(() => {
            const cb = document.getElementById('show-background-dots-checkbox');
            if (!cb) throw new Error('show-background-dots-checkbox missing');
            cb.checked = !cb.checked;
            cb.dispatchEvent(new Event('change', { bubbles: true }));
        });

        await expect.poll(() => page.evaluate(() => (
            document.querySelector('.config-tab-group[data-tab-group="system"]')
                ?.classList.contains('config-tab-group--unsaved') === true
        ))).toBe(true);
        await expect(page.locator('.tab-button[data-tab="general"]')).toHaveClass(/tab-has-unsaved/);
        await expect(page.locator('.config-tab-group[data-tab-group="dashboard"]')).not.toHaveClass(/config-tab-group--unsaved/);
    });

    test('shows unsaved dot on Extras group when only Collections change (C14)', async ({ page }) => {
        await page.evaluate(() => window.configManager.ui.switchToTab('collections'));

        await page.evaluate(() => {
            const mgr = window.configManager;
            const cols = JSON.parse(JSON.stringify(mgr.settingsData.collections || []));
            cols.push({
                id: 'playwright-test-col',
                name: 'Playwright test',
                icon: '▤',
                logic: 'and',
                rules: [{ field: 'tag', operator: 'includes', value: 'work' }],
            });
            mgr.settingsData.collections = cols;
            mgr.persistence.recomputeDirtyState();
            window.ConfigTabGroups.syncUnsavedIndicators(mgr);
        });

        await expect.poll(() => page.evaluate(() => (
            document.querySelector('.config-tab-group[data-tab-group="extras"]')
                ?.classList.contains('config-tab-group--unsaved') === true
        ))).toBe(true);
        await expect(page.locator('.tab-button[data-tab="collections"]')).toHaveClass(/tab-has-unsaved/);
        await expect(page.locator('.config-tab-group[data-tab-group="system"]')).not.toHaveClass(/config-tab-group--unsaved/);
    });

    test('respects prefers-reduced-motion for config tab chrome (C15)', async ({ page }) => {
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await page.evaluate(() => window.configManager.ui.switchToTab('pages'));

        const tabAnim = await page.evaluate(() => {
            const panel = document.querySelector('.tab-content[data-tab-content="pages"]');
            return panel ? getComputedStyle(panel).animationName : '';
        });
        expect(tabAnim === 'none' || tabAnim === '').toBeTruthy();

        await page.evaluate(() => window.configManager.markDirty());
        const saveAnim = await page.evaluate(() => {
            const btn = document.getElementById('save-btn');
            return btn ? getComputedStyle(btn).animationName : '';
        });
        expect(saveAnim === 'none' || saveAnim === '').toBeTruthy();
    });

    test('respects prefers-reduced-motion for config animations beyond chrome (C15)', async ({ page }) => {
        await page.emulateMedia({ reducedMotion: 'reduce' });

        await page.evaluate(() => window.configManager.ui.switchToTab('keyboard'));
        await page.evaluate(() => {
            const btn = document.querySelector('.binding-edit-btn');
            if (btn) btn.classList.add('listening');
        });
        const keyboardAnim = await page.evaluate(() => {
            const btn = document.querySelector('.binding-edit-btn.listening');
            return btn ? getComputedStyle(btn).animationName : '';
        });
        expect(keyboardAnim === 'none' || keyboardAnim === '').toBeTruthy();

        await page.evaluate(() => window.configManager.ui.switchToTab('general'));
        const healthAnim = await page.evaluate(() => {
            const link = document.querySelector('.config-header-top .health-link a');
            return link ? getComputedStyle(link).animationName : '';
        });
        expect(healthAnim === 'none' || healthAnim === '').toBeTruthy();

        await page.evaluate(() => window.configManager.ui.switchToTab('tags'));
        await page.evaluate(() => {
            const cloud = document.querySelector('.tags-cloud');
            if (cloud) {
                cloud.classList.add('tags-cloud--live');
                const word = document.createElement('span');
                word.className = 'tag-cloud-word';
                word.style.setProperty('--tag-index', '0');
                cloud.appendChild(word);
            }
        });
        const tagAnim = await page.evaluate(() => {
            const word = document.querySelector('.tags-cloud--live .tag-cloud-word');
            return word ? getComputedStyle(word).animationName : '';
        });
        expect(tagAnim === 'none' || tagAnim === '').toBeTruthy();
    });

    test('phone layout hides Dashboard and Extras groups but keeps Help', async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        await page.reload();
        await page.waitForFunction(() => typeof window.configManager?.ui !== 'undefined');
        await page.waitForSelector('[data-tab-content="general"].active', { timeout: 20_000 });

        await expect(page.locator('.config-tab-group[data-tab-group="system"]')).toBeVisible();
        await expect(page.locator('.config-tab-group[data-tab-group="dashboard"]')).toBeHidden();
        await expect(page.locator('.config-tab-group[data-tab-group="extras"]')).toBeHidden();
        await expect(page.locator('.config-tab-group[data-tab-group="help"]')).toBeVisible();
    });

    test('tab groups use proportional width by visible tab count', async ({ page }) => {
        const data = await page.evaluate(() => {
            const groupWidth = (id) => (
                document.querySelector(`.config-tab-group[data-tab-group="${id}"]`)?.getBoundingClientRect().width || 0
            );
            const weight = (id) => (
                document.querySelector(`.config-tab-group[data-tab-group="${id}"]`)
                    ?.style.getPropertyValue('--config-tab-group-weight') || ''
            );
            return {
                system: groupWidth('system'),
                dashboard: groupWidth('dashboard'),
                extras: groupWidth('extras'),
                help: groupWidth('help'),
                weights: {
                    system: weight('system'),
                    dashboard: weight('dashboard'),
                    extras: weight('extras'),
                    help: weight('help'),
                },
            };
        });

        expect(data.weights.system).toBe('5');
        expect(data.weights.dashboard).toBe('3');
        expect(data.weights.extras).toBe('3');
        expect(data.weights.help).toBe('1');
        expect(data.system).toBeGreaterThan(data.dashboard * 1.05);
        expect(data.dashboard).toBeGreaterThan(data.help * 1.5);
    });

    test('chrome rows match general panel content width', async ({ page }) => {
        await page.evaluate(() => window.configManager.ui.switchToTab('general'));
        await page.evaluate(() => window.configManager.generalLayers?.applyLayer?.('advanced', { updateHash: false }));

        const widths = await page.evaluate(() => {
            const w = (sel) => Math.round(document.querySelector(sel)?.getBoundingClientRect().width || 0);
            return {
                column: w('.config-page-shell > .config-page-column'),
                save: w('.config-actions-top'),
                tabs: w('.tabs-scroll-wrapper'),
                toolbar: w('.general-layer-toolbar'),
                card: w('.general-card:not([hidden])'),
            };
        });

        expect(widths.column).toBeGreaterThan(0);
        expectWidthNear(widths.save, widths.column);
        expectWidthNear(widths.tabs, widths.column);
        expectWidthNear(widths.toolbar, widths.column);
        expectWidthNear(widths.card, widths.column);
    });
});

test.describe('config bookmarks surface (v5)', () => {
    test.beforeEach(async ({ page }) => {
        await page.setViewportSize({ width: 1280, height: 800 });
        await waitForConfigReady(page);
        await page.evaluate(() => window.configManager.ui.switchToTab('bookmarks'));
    });

    test('wraps split view in bookmarks-tab-surface', async ({ page }) => {
        const surface = page.locator('.bookmarks-tab-surface');
        await expect(surface).toBeVisible();
        await expect(surface.locator('.bookmarks-splitview')).toBeVisible();
        await expect(surface.locator('.config-tab-toolbar--in-surface')).toBeVisible();
    });

    test('integrates context panel inside bookmarks surface (B4)', async ({ page }) => {
        const surface = page.locator('.bookmarks-tab-surface');
        await expect(surface.locator('#structure-workspace-card.structure-workspace-in-surface')).toBeVisible();
        await expect(surface.locator('#structure-workspace-panel.structure-workspace-context-body')).toBeAttached();
        await expect(surface.locator('.bookmarks-splitview')).toBeVisible();

        const cardCount = await page.evaluate(() => {
            const workspace = document.getElementById('bookmarks-tab-workspace');
            if (!workspace) return -1;
            return workspace.querySelectorAll(':scope > .config-tab-surface').length;
        });
        expect(cardCount).toBe(1);
    });

    test('bookmarks search uses shared config-filter-field (B2)', async ({ page }) => {
        const filter = page.locator('.bookmarks-filter-wrap.config-filter-field');
        await expect(filter).toBeVisible();
        await expect(filter.locator('#bookmarks-search.config-filter-input')).toBeVisible();
        await expect(filter.locator('#bookmarks-search-clear.config-filter-clear')).toBeAttached();
        await expect(page.locator('.bookmarks-search-wrap')).toHaveCount(0);
    });
});

test.describe('config stats & backups surface (B9)', () => {
    test.beforeEach(async ({ page }) => {
        await page.setViewportSize({ width: 1280, height: 800 });
        await waitForConfigReady(page);
    });

    test('stats tab fuses filter toolbar and layout in one surface', async ({ page }) => {
        await page.evaluate(() => window.configManager.ui.switchToTab('stats'));
        const surface = page.locator('.stats-tab-surface');
        await expect(surface).toBeVisible();
        await expect(surface.locator('.stats-filter-bar.config-tab-toolbar--in-surface')).toBeVisible();
        await expect(surface.locator('#stats-filter-input.config-filter-input')).toBeVisible();
        await expect(surface.locator('#stats-refresh-btn')).toBeVisible();
        await expect(surface.locator('.stats-layout')).toBeVisible();

        const nestedCards = await page.evaluate(() => {
            const blocks = [...document.querySelectorAll('.stats-tab-surface .stats-block')];
            return blocks.every((el) => getComputedStyle(el).boxShadow === 'none');
        });
        expect(nestedCards).toBe(true);
    });

    test('backups tab wraps sections in one surface', async ({ page }) => {
        await page.evaluate(() => window.configManager.ui.switchToTab('backups'));
        const surface = page.locator('.backups-tab-surface');
        await expect(surface).toBeVisible();
        await expect(surface.locator('.backups-section')).toHaveCount(3);

        const sectionCount = await page.evaluate(() => {
            const tab = document.querySelector('[data-tab-content="backups"] .backups-tab');
            return tab?.querySelectorAll(':scope > .config-tab-surface').length ?? 0;
        });
        expect(sectionCount).toBe(1);
    });
});

test.describe('config help surface (B5)', () => {
    test.beforeEach(async ({ page }) => {
        await page.setViewportSize({ width: 1280, height: 800 });
        await waitForConfigReady(page);
        await page.evaluate(() => window.configManager.ui.switchToTab('help'));
    });

    test('help tab uses shared intro and fused surface shell', async ({ page }) => {
        await expect(page.locator('.help-tab.config-tab-page')).toBeVisible();
        await expect(page.locator('.help-tab-intro .config-tab-intro-lead')).toBeVisible();
        const surface = page.locator('.help-tab-surface');
        await expect(surface).toBeVisible();
        await expect(surface.locator('.help-filter-bar.config-tab-toolbar--in-surface')).toBeVisible();
        await expect(surface.locator('#help-search-filter.config-filter-input')).toBeVisible();
        await expect(surface.locator('#help-search-clear.config-filter-clear')).toBeAttached();
        await expect(surface.locator('.help-layout')).toBeVisible();
        await expect(surface.locator('.help-index')).toBeVisible();
        await expect(surface.locator('.help-content .help-block').first()).toBeVisible();

        const surfaceCount = await page.evaluate(() => {
            const tab = document.querySelector('[data-tab-content="help"] .help-tab');
            return tab?.querySelectorAll(':scope > .config-tab-surface').length ?? 0;
        });
        expect(surfaceCount).toBe(1);

        const nestedCards = await page.evaluate(() => {
            const blocks = [...document.querySelectorAll('.help-tab-surface .help-block')];
            return blocks.every((el) => getComputedStyle(el).boxShadow === 'none');
        });
        expect(nestedCards).toBe(true);
    });
});

test.describe('config general & theme surface (C16/B10)', () => {
    test.beforeEach(async ({ page }) => {
        await page.setViewportSize({ width: 1280, height: 800 });
        await waitForConfigReady(page);
    });

    test('general tab uses shared intro and fused surface shell', async ({ page }) => {
        await page.evaluate(() => window.configManager.ui.switchToTab('general'));
        await expect(page.locator('.general-tab.config-tab-page')).toBeVisible();
        await expect(page.locator('[data-tab-content="general"] .config-tab-intro-lead')).toBeVisible();

        const surface = page.locator('.general-tab-surface');
        await expect(surface).toBeVisible();
        await expect(surface.locator('#general-layer-toolbar.config-tab-toolbar--in-surface')).toBeVisible();
        await expect(surface.locator('.general-layout')).toBeVisible();
        await expect(surface.locator('.general-card').first()).toBeVisible();

        const surfaceCount = await page.evaluate(() => {
            const tab = document.querySelector('[data-tab-content="general"] .general-tab');
            return tab?.querySelectorAll(':scope > .config-tab-surface').length ?? 0;
        });
        expect(surfaceCount).toBe(1);
    });

    test('advanced layer keeps layer toolbar flush to fused surface top', async ({ page }) => {
        await page.evaluate(() => window.configManager.ui.switchToTab('general'));
        await page.evaluate(() => window.configManager.generalLayers?.applyLayer?.('advanced', { updateHash: false }));

        const layout = await page.evaluate(() => {
            const surface = document.querySelector('.general-tab-surface');
            const toolbar = document.getElementById('general-layer-toolbar');
            const bulk = document.getElementById('general-panels-bulk-actions');
            if (!surface || !toolbar || !bulk) return null;
            const surfaceRect = surface.getBoundingClientRect();
            const toolbarRect = toolbar.getBoundingClientRect();
            const bulkRect = bulk.getBoundingClientRect();
            const bulkStyle = getComputedStyle(bulk);
            return {
                gap: Math.round(toolbarRect.top - surfaceRect.top),
                bulkHidden: bulk.hidden,
                bulkDisplay: bulkStyle.display,
                bulkHeight: Math.round(bulkRect.height),
                toolbarPosition: getComputedStyle(toolbar).position,
            };
        });

        expect(layout).not.toBeNull();
        expect(layout.gap).toBeLessThan(2);
        expect(layout.bulkHidden).toBe(true);
        expect(layout.bulkDisplay).toBe('none');
        expect(layout.bulkHeight).toBe(0);
        expect(layout.toolbarPosition).toBe('static');
    });

    test('advanced layer omits section jump nav row', async ({ page }) => {
        await page.evaluate(() => window.configManager.ui.switchToTab('general'));
        await page.evaluate(() => window.configManager.generalLayers?.applyLayer?.('advanced', { updateHash: false }));

        await expect(page.locator('#general-advanced-nav-wrap')).toHaveCount(0);
        await expect(page.locator('#general-advanced-nav')).toHaveCount(0);
    });

    test('essentials and advanced layers share toolbar inset', async ({ page }) => {
        await page.evaluate(() => window.configManager.ui.switchToTab('general'));

        const essentialsPad = await page.evaluate(() => {
            window.configManager.generalLayers?.applyLayer?.('essentials', { updateHash: false });
            const toolbar = document.getElementById('general-layer-toolbar');
            if (!toolbar) return null;
            const style = getComputedStyle(toolbar);
            return {
                paddingLeft: parseFloat(style.paddingLeft),
                paddingRight: parseFloat(style.paddingRight),
            };
        });
        expect(essentialsPad).not.toBeNull();

        const advancedPad = await page.evaluate(() => {
            window.configManager.generalLayers?.applyLayer?.('advanced', { updateHash: false });
            const toolbar = document.getElementById('general-layer-toolbar');
            if (!toolbar) return null;
            const style = getComputedStyle(toolbar);
            return {
                paddingLeft: parseFloat(style.paddingLeft),
                paddingRight: parseFloat(style.paddingRight),
            };
        });
        expect(advancedPad).not.toBeNull();
        expect(advancedPad.paddingLeft).toBeCloseTo(essentialsPad.paddingLeft, 1);
        expect(advancedPad.paddingRight).toBeCloseTo(essentialsPad.paddingRight, 1);
    });

    test('essentials and advanced toggle keep toolbar viewport position', async ({ page }) => {
        await page.evaluate(() => window.configManager.ui.switchToTab('general'));

        const drift = await page.evaluate(() => {
            window.configManager.generalLayers?.applyLayer?.('essentials', { updateHash: false });
            window.scrollTo(0, 520);
            const toolbar = document.getElementById('general-layer-toolbar');
            if (!toolbar) return null;

            const measure = () => toolbar.getBoundingClientRect().top;
            const start = measure();

            window.configManager.generalLayers?.applyLayer?.('advanced', { updateHash: false });
            const afterAdvanced = measure();

            window.configManager.generalLayers?.applyLayer?.('essentials', { updateHash: false });
            const afterEssentials = measure();

            window.configManager.generalLayers?.applyLayer?.('advanced', { updateHash: false });
            const afterAdvancedAgain = measure();

            return {
                start,
                afterAdvanced,
                afterEssentials,
                afterAdvancedAgain,
            };
        });

        expect(drift).not.toBeNull();
        expect(Math.abs(drift.afterAdvanced - drift.start)).toBeLessThan(2);
        expect(Math.abs(drift.afterEssentials - drift.start)).toBeLessThan(2);
        expect(Math.abs(drift.afterAdvancedAgain - drift.start)).toBeLessThan(2);
    });

    test('advanced general panels collapse and expand via section title', async ({ page }) => {
        await page.evaluate(() => {
            window.configManager.ui.switchToTab('general');
            window.configManager.generalLayers?.applyLayer?.('advanced', { updateHash: false });
        });

        const panel = page.locator('[data-general-panel="appearance-advanced"]');
        await expect(panel).toBeVisible();
        await expect(panel).toHaveClass(/is-collapsible/);

        await page.evaluate(() => {
            const card = document.querySelector('[data-general-panel="appearance-advanced"]');
            card?.classList.remove('is-collapsed');
        });
        await expect(panel).not.toHaveClass(/is-collapsed/);

        await panel.locator('.section-title').click();
        await expect(panel).toHaveClass(/is-collapsed/);

        await panel.locator('.section-title').click();
        await expect(panel).not.toHaveClass(/is-collapsed/);
    });

    test('theme tab uses fused surface without local unsaved badge (B10)', async ({ page }) => {
        await page.evaluate(() => window.configManager.ui.switchToTab('colors'));
        await expect(page.locator('#theme-colors-editor.config-tab-page')).toBeVisible();
        await expect(page.locator('.theme-colors-intro .config-tab-intro-lead')).toBeVisible();

        const surface = page.locator('.theme-colors-tab-surface');
        await expect(surface).toBeVisible();
        await expect(surface.locator('.theme-colors-toolbar.config-tab-toolbar--in-surface')).toBeVisible();
        await expect(surface.locator('.theme-colors-body .colors-tab-panel.active')).toBeVisible();
        await expect(page.locator('#colors-unsaved-indicator')).toHaveCount(0);

        const surfaceCount = await page.evaluate(() => {
            const editor = document.getElementById('theme-colors-editor');
            return editor?.querySelectorAll(':scope > .config-tab-surface').length ?? 0;
        });
        expect(surfaceCount).toBe(1);

        await page.evaluate(() => window.configManager.colorsEditor?.markDirty?.());
        await expect(page.locator('body')).toHaveClass(/colors-is-dirty/);
        await expect(page.locator('#config-tab-save-mode')).toHaveClass(/config-tab-save-mode--colors-save/);
        await expect(page.locator('.tab-button[data-tab="colors"]')).toHaveClass(/tab-has-unsaved/);
    });
});
