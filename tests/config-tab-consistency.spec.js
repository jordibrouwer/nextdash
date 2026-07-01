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

    test('classic layout fuses header save and tabs into one chrome card (C10)', async ({ page }) => {
        const chrome = await page.evaluate(() => {
            const header = document.querySelector('.config-page-shell > .config-section.section-header');
            const controls = document.querySelector('.config-page-shell > .config-section.section-controls');
            const actions = document.querySelector('.config-section.section-controls .config-actions-top');
            if (!header || !controls || !actions) return null;
            const hs = getComputedStyle(header);
            const cs = getComputedStyle(controls);
            const as = getComputedStyle(actions);
            const headerRect = header.getBoundingClientRect();
            const controlsRect = controls.getBoundingClientRect();
            return {
                headerRadiusBottom: hs.borderBottomLeftRadius,
                controlsRadiusBottom: cs.borderBottomLeftRadius,
                controlsBoxShadow: cs.boxShadow,
                seamGap: controlsRect.top - headerRect.bottom,
                actionsBackground: as.backgroundColor,
            };
        });
        expect(chrome).not.toBeNull();
        expect(chrome.seamGap).toBeLessThanOrEqual(1);
        expect(chrome.headerRadiusBottom).toBe('0px');
        expect(parseFloat(chrome.controlsRadiusBottom)).toBeGreaterThan(0);
        expect(chrome.controlsBoxShadow).not.toBe('none');
        expect(chrome.actionsBackground).toBe('rgba(0, 0, 0, 0)');
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
