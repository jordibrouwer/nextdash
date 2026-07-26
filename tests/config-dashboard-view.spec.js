// @ts-check
const { test, expect } = require('@playwright/test');
const { dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * Config as a dashboard view — Phase 1 scaffold.
 *
 * These pin the shell wiring (the view opens, owns the hash, sets the
 * config-layout class, and closes back to bookmarks) rather than the section
 * content, which arrives in later phases.
 */

/** Load the dashboard and wait until the instance is ready to be driven. */
async function loadDashboard(page) {
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
}

test.describe('config dashboard view (scaffold)', () => {
    test('opening #config activates the config view', async ({ page }) => {
        await loadDashboard(page);

        await page.evaluate(() => window.dashboardInstance.config.openConfigView());

        expect(await page.evaluate(() => window.dashboardInstance.activeView)).toBe('config');
        const container = page.locator('#dashboard-layout');
        await expect(container).toHaveClass(/config-layout/);
        await expect(page.locator('.config-view')).toBeVisible();
        expect(await page.evaluate(() => window.location.hash)).toBe('#config');
    });

    test('the header config link opens the view without a page reload', async ({ page }) => {
        await loadDashboard(page);

        await page.evaluate(() => { window.__noReload = true; });
        await page.locator('.config-link a').click();

        await expect
            .poll(() => page.evaluate(() => window.dashboardInstance.activeView))
            .toBe('config');
        // Same document instance — never navigated away.
        expect(await page.evaluate(() => window.__noReload)).toBe(true);
    });

    /**
     * The header config link is an icon, not the word "config", and carries the
     * same --icon treatment as health so the three destinations read as one set.
     */
    test('the config link is an icon styled like the health icon', async ({ page }) => {
        await loadDashboard(page);

        const anchor = page.locator('.config-link a.config-link-anchor');
        await expect(page.locator('.config-link .config-link-icon')).toBeVisible();
        // An icon, not a text label — but still named for screen readers.
        expect((await anchor.innerText()).trim()).toBe('');
        await expect(anchor).toHaveAttribute('aria-label', /.+/);

        // Same box metrics as the health icon, from the shared --icon rules.
        const boxes = await page.evaluate(() => {
            const pick = (sel) => {
                const el = document.querySelector(sel);
                if (!el) return null;
                const s = getComputedStyle(el);
                return { pad: s.padding, radius: s.borderTopLeftRadius, display: s.display };
            };
            return { health: pick('.health-link a'), config: pick('.config-link a') };
        });
        if (boxes.health) expect(boxes.config).toEqual(boxes.health);
    });

    /**
     * The page tabs, inbox, health and config are one row of destinations, so they
     * must share a baseline. This regressed once because updatePageTabsVisibility
     * forced an inline display:block onto #page-navigation, dropping its flex
     * layout and leaving the four on three different baselines.
     */
    test('page tabs and the header icons all sit on one line', async ({ page }) => {
        await loadDashboard(page);

        const rects = await page.evaluate(() => {
            const pick = (el) => {
                if (!el) return null;
                const r = el.getBoundingClientRect();
                return { top: +r.top.toFixed(1), bottom: +r.bottom.toFixed(1) };
            };
            return [
                pick(document.querySelector('.page-nav-btn:not([data-view-tab])')),
                pick(document.getElementById('page-nav-inbox-btn')),
                pick(document.querySelector('.health-link a')),
                pick(document.querySelector('.config-link a')),
            ].filter(Boolean);
        });
        expect(rects.length).toBeGreaterThanOrEqual(2);

        // Same top and bottom edge, within a sub-pixel rounding tolerance.
        const spread = (vals) => Math.max(...vals) - Math.min(...vals);
        expect(spread(rects.map((r) => r.top))).toBeLessThanOrEqual(1);
        expect(spread(rects.map((r) => r.bottom))).toBeLessThanOrEqual(1);

        // The tab strip must stay a flex row — an inline display:block breaks it.
        expect(await page.evaluate(() =>
            getComputedStyle(document.getElementById('page-navigation')).display)).toBe('flex');
    });

    test('hiding and re-showing page tabs keeps them a flex row', async ({ page }) => {
        await loadDashboard(page);
        const display = () => page.evaluate(() =>
            getComputedStyle(document.getElementById('page-navigation')).display);

        await page.evaluate(() => {
            window.dashboardInstance.settings.showPageTabs = false;
            window.dashboardInstance.visual.updatePageTabsVisibility();
        });
        expect(await display()).toBe('none');

        await page.evaluate(() => {
            window.dashboardInstance.settings.showPageTabs = true;
            window.dashboardInstance.visual.updatePageTabsVisibility();
        });
        expect(await display()).toBe('flex');
    });

    test('opening config marks its header icon active, like the health icon', async ({ page }) => {
        await loadDashboard(page);
        const anchor = page.locator('.config-link a.config-link-anchor');
        await expect(anchor).not.toHaveClass(/active/);

        await page.evaluate(() => window.dashboardInstance.config.openConfigView('overview'));
        await expect(anchor).toHaveClass(/active/);
        await expect(anchor).toHaveAttribute('aria-current', 'page');

        // The active look is the tab treatment, not just a class.
        const active = await page.evaluate(() => {
            const s = getComputedStyle(document.querySelector('.config-link a'));
            return { bg: s.backgroundColor, underline: s.borderBottomColor };
        });
        expect(active.bg).not.toBe('rgba(0, 0, 0, 0)');

        // Leaving the view clears it again.
        await page.locator('body').press('Escape');
        await expect(anchor).not.toHaveClass(/active/);
    });

    test('Escape returns from config to the bookmarks view', async ({ page }) => {
        await loadDashboard(page);

        await page.evaluate(() => window.dashboardInstance.config.openConfigView());
        expect(await page.evaluate(() => window.dashboardInstance.activeView)).toBe('config');

        await page.locator('body').press('Escape');

        await expect
            .poll(() => page.evaluate(() => window.dashboardInstance.activeView))
            .toBe('bookmarks');
        await expect(page.locator('#dashboard-layout')).not.toHaveClass(/config-layout/);
    });

    test('a config/appearance hash selects the appearance section', async ({ page }) => {
        await loadDashboard(page);

        await page.evaluate(() => window.dashboardInstance.config.openConfigView('appearance'));

        expect(await page.evaluate(() => window.dashboardInstance.config.section)).toBe('appearance');
        expect(await page.evaluate(() => window.location.hash)).toBe('#config/appearance');
    });

    test('the overview section renders status tiles', async ({ page }) => {
        await loadDashboard(page);

        await page.evaluate(() => window.dashboardInstance.config.openConfigView());

        await expect(page.locator('.config-tiles .config-tile').first()).toBeVisible();
        // The bookmarks tile always exists; broken/duplicate/pages/inbox join it.
        const labels = await page.locator('.config-tile-label').allTextContents();
        expect(labels.join(' ').toLowerCase()).toContain('bookmarks');
    });

    test('clicking a section nav item switches section and hash', async ({ page }) => {
        await loadDashboard(page);
        await page.evaluate(() => window.dashboardInstance.config.openConfigView());

        await page.locator('[data-config-section="appearance"]').click();

        expect(await page.evaluate(() => window.dashboardInstance.config.section)).toBe('appearance');
        expect(await page.evaluate(() => window.location.hash)).toBe('#config/appearance');
        await expect(page.locator('[data-config-section="appearance"]')).toHaveClass(/is-active/);
    });

    test('a broken-links action tile hands off to the health view', async ({ page }) => {
        // Mock the health report so a broken count exists; loadOverviewData refetches
        // this endpoint, so forcing the in-memory report alone would be clobbered.
        await page.route('**/api/bookmark-health**', async (route) => {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    generatedAt: Date.now(),
                    summary: { totalBookmarks: 3, brokenCount: 2, duplicateCount: 0, uncheckedCount: 0, healthyCount: 1 },
                    issues: [],
                }),
            });
        });
        await loadDashboard(page);
        await page.evaluate(() => window.dashboardInstance.config.openConfigView());

        const brokenTile = page.locator('.config-tile[data-tile-view="health"][data-tile-filter="broken"]');
        await expect(brokenTile).toBeVisible();
        await brokenTile.click();

        await expect
            .poll(() => page.evaluate(() => window.dashboardInstance.activeView))
            .toBe('health');
        expect(await page.evaluate(() => window.dashboardInstance.health.filter)).toBe('broken');
    });

    test('the data & backups section renders tiles and the stored list', async ({ page }) => {
        await page.route('**/api/auto-backups', async (route) => {
            if (route.request().method() !== 'GET') return route.fallback();
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    enabled: true,
                    backups: [
                        { name: 'auto-2026-07-24T10-00-00Z.zip', size: 42000, createdAt: new Date(Date.now() - 3600_000).toISOString() },
                        { name: 'auto-2026-07-23T10-00-00Z.zip', size: 41000, createdAt: new Date(Date.now() - 90000_000).toISOString() },
                    ],
                }),
            });
        });
        await loadDashboard(page);
        await page.evaluate(() => window.dashboardInstance.config.openConfigView('data-backups'));

        await expect(page.locator('.config-tile-label', { hasText: /last backup/i })).toBeVisible();
        await expect(page.locator('.config-backup-row')).toHaveCount(2);
        await expect(page.locator('[data-backup-action="download"]')).toBeVisible();
        await expect(page.locator('[data-backup-action="reset"]')).toBeVisible();
    });

    test('make-a-backup-now posts to the run endpoint and reloads the list', async ({ page }) => {
        let runCalls = 0;
        let listCalls = 0;
        await page.route('**/api/auto-backups/run', async (route) => {
            runCalls += 1;
            await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'success' }) });
        });
        await page.route('**/api/auto-backups', async (route) => {
            if (route.request().method() !== 'GET') return route.fallback();
            listCalls += 1;
            await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ enabled: true, backups: [] }) });
        });
        await loadDashboard(page);
        await page.evaluate(() => window.dashboardInstance.config.openConfigView('data-backups'));
        await expect(page.locator('[data-backup-action="run"]')).toBeVisible();

        await page.locator('[data-backup-action="run"]').click();

        await expect.poll(() => runCalls).toBe(1);
        // The list is refetched after a successful run (initial load + post-run).
        await expect.poll(() => listCalls).toBeGreaterThanOrEqual(2);
    });

    test('data & backups exposes CSV, browser import, settings and reset controls', async ({ page }) => {
        await page.route('**/api/auto-backups', async (route) => {
            if (route.request().method() !== 'GET') return route.fallback();
            await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ enabled: true, backups: [] }) });
        });
        await loadDashboard(page);
        await page.evaluate(() => window.dashboardInstance.config.openConfigView('data-backups'));

        for (const action of ['csv-export', 'browser-import', 'settings-export', 'settings-import', 'reset-onboarding']) {
            await expect(page.locator(`[data-backup-action="${action}"]`)).toBeVisible();
        }
        await expect(page.locator('[data-backup-toggle="autoBackupEnabled"]')).toBeVisible();
        await expect(page.locator('[data-backup-toggle="healthAutoRecheckEnabled"]')).toBeVisible();
    });

    test('CSV export fetches bookmarks and triggers a download', async ({ page }) => {
        await page.route('**/api/auto-backups', async (route) => {
            if (route.request().method() !== 'GET') return route.fallback();
            await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ enabled: false, backups: [] }) });
        });
        await page.route('**/api/bookmarks?all=true', async (route) => {
            await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ name: 'Example', url: 'https://example.com', category: 'tools', pageId: 1 }]) });
        });
        await loadDashboard(page);
        await page.evaluate(() => window.dashboardInstance.config.openConfigView('data-backups'));

        const [download] = await Promise.all([
            page.waitForEvent('download'),
            page.locator('[data-backup-action="csv-export"]').click(),
        ]);
        expect(download.suggestedFilename()).toMatch(/nextdash-bookmarks-.*\.csv/);
    });

    test('toggling auto-backup saves settings and reloads the list', async ({ page }) => {
        let saved = null;
        await page.route('**/api/settings', async (route) => {
            if (route.request().method() === 'POST') {
                saved = JSON.parse(route.request().postData() || '{}');
                return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
            }
            return route.fallback();
        });
        await page.route('**/api/auto-backups', async (route) => {
            if (route.request().method() !== 'GET') return route.fallback();
            await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ enabled: false, backups: [] }) });
        });
        await loadDashboard(page);
        await page.evaluate(() => {
            window.dashboardInstance.settings.autoBackupEnabled = false;
            window.dashboardInstance.config.openConfigView('data-backups');
        });

        await page.locator('[data-backup-toggle="autoBackupEnabled"]').check();

        await expect.poll(() => saved && saved.autoBackupEnabled).toBe(true);
    });

    test('the appearance section renders theme and font-size controls', async ({ page }) => {
        await loadDashboard(page);
        await page.evaluate(() => window.dashboardInstance.config.openConfigView('appearance'));

        await expect(page.locator('.config-tile-label', { hasText: /active theme/i })).toBeVisible();
        await expect(page.locator('[data-appearance-theme="light"]')).toBeVisible();
        await expect(page.locator('[data-appearance-theme="dark"]')).toBeVisible();
        await expect(page.locator('[data-appearance-font="m"]')).toBeVisible();
    });

    test('switching theme applies live, saves, and updates the tile', async ({ page }) => {
        let saved = null;
        await page.route('**/api/settings', async (route) => {
            if (route.request().method() === 'POST') {
                saved = JSON.parse(route.request().postData() || '{}');
                return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
            }
            return route.fallback();
        });
        await loadDashboard(page);
        await page.evaluate(() => {
            window.dashboardInstance.settings.theme = 'dark';
            window.dashboardInstance.config.openConfigView('appearance');
        });

        await page.locator('[data-appearance-theme="light"]').click();

        // Applied live to the document.
        await expect
            .poll(() => page.evaluate(() => document.documentElement.getAttribute('data-theme')))
            .toBe('light');
        // Persisted.
        await expect.poll(() => saved && saved.theme).toBe('light');
        // Tile reflects the new theme.
        await expect(page.locator('.config-tile-value', { hasText: /light/i })).toBeVisible();
        // The light button is now the active choice.
        await expect(page.locator('[data-appearance-theme="light"]')).toHaveClass(/is-active/);
    });

    test('appearance exposes the full control set', async ({ page }) => {
        await loadDashboard(page);
        await page.evaluate(() => window.dashboardInstance.config.openConfigView('appearance'));

        await expect(page.locator('[data-appearance-select="fontPreset"]')).toBeVisible();
        await expect(page.locator('[data-appearance-weight="bold"]')).toBeVisible();
        await expect(page.locator('[data-appearance-bg="gradient"]')).toBeVisible();
        await expect(page.locator('[data-appearance-range="backgroundOpacity"]')).toBeVisible();
        await expect(page.locator('[data-appearance-iconsize="large"]')).toBeVisible();
        await expect(page.locator('[data-appearance-toggle="showIcons"]')).toBeVisible();
        await expect(page.locator('[data-appearance-toggle="animationsEnabled"]')).toBeVisible();
        await expect(page.locator('[data-appearance-action="upload-font"]')).toBeVisible();
        await expect(page.locator('[data-appearance-action="upload-favicon"]')).toBeVisible();
        await expect(page.locator('[data-appearance-action="edit-colors"]')).toBeVisible();
    });

    test('choosing a font preset applies it and saves', async ({ page }) => {
        let saved = null;
        await page.route('**/api/settings', async (route) => {
            if (route.request().method() === 'POST') {
                saved = JSON.parse(route.request().postData() || '{}');
                return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
            }
            return route.fallback();
        });
        await loadDashboard(page);
        await page.evaluate(() => window.dashboardInstance.config.openConfigView('appearance'));

        await page.locator('[data-appearance-select="fontPreset"]').selectOption('jetbrains-mono');

        await expect
            .poll(() => page.evaluate(() => document.documentElement.getAttribute('data-font-preset')))
            .toBe('jetbrains-mono');
        await expect.poll(() => saved && saved.fontPreset).toBe('jetbrains-mono');
    });

    test('the theme picker lists built-in themes and applies a choice', async ({ page }) => {
        let saved = null;
        await page.route('**/api/colors/custom-themes', async (route) => {
            await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ 'ocean-dark': 'Ocean', 'forest-light': 'Forest' }) });
        });
        await page.route('**/api/settings', async (route) => {
            if (route.request().method() === 'POST') {
                saved = JSON.parse(route.request().postData() || '{}');
                return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
            }
            return route.fallback();
        });
        await loadDashboard(page);
        await page.evaluate(() => window.dashboardInstance.config.openConfigView('appearance'));

        const select = page.locator('[data-appearance-select="theme"]');
        await expect(select).toBeVisible();
        // The built-in themes from the endpoint appear as options.
        await expect(select.locator('option[value="ocean-dark"]')).toHaveCount(1);

        await select.selectOption('ocean-dark');

        await expect
            .poll(() => page.evaluate(() => document.documentElement.getAttribute('data-theme')))
            .toBe('ocean-dark');
        await expect.poll(() => saved && saved.theme).toBe('ocean-dark');
    });

    test('the theme-colours editor mounts on demand', async ({ page }) => {
        await loadDashboard(page);
        await page.evaluate(() => window.dashboardInstance.config.openConfigView('appearance'));

        await page.locator('[data-appearance-action="edit-colors"]').click();

        // The shell-hosted editor is revealed and moved into the appearance panel.
        await expect(page.locator('#config-theme-colors-panel #theme-colors-editor')).toBeVisible();
    });

    test('the behavior section renders grouped settings across sub-tabs', async ({ page }) => {
        await loadDashboard(page);
        await page.evaluate(() => window.dashboardInstance.config.openConfigView('behavior'));

        // General tab is active by default.
        await expect(page.locator('[data-behavior-field="openInNewTab"]')).toBeVisible();
        // Other groups live under their own sub-tabs.
        await page.locator('[data-behavior-tab="datetime"]').click();
        await expect(page.locator('[data-behavior-field="dateFormat"]')).toBeVisible();
        await page.locator('[data-behavior-tab="layout"]').click();
        await expect(page.locator('[data-behavior-field="columnsPerRow"]')).toBeVisible();
        await page.locator('[data-behavior-tab="display"]').click();
        await expect(page.locator('[data-behavior-field="showStatus"]')).toBeVisible();
        await page.locator('[data-behavior-tab="search"]').click();
        await expect(page.locator('[data-behavior-field="pasteDestination"]')).toBeVisible();
    });

    test('toggling a behavior setting saves it and re-renders', async ({ page }) => {
        let saved = null;
        await page.route('**/api/settings', async (route) => {
            if (route.request().method() === 'POST') {
                saved = JSON.parse(route.request().postData() || '{}');
                return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
            }
            return route.fallback();
        });
        await loadDashboard(page);
        await page.evaluate(() => {
            window.dashboardInstance.settings.openInNewTab = false;
            window.dashboardInstance.config.openConfigView('behavior');
        });

        await page.locator('[data-behavior-field="openInNewTab"]').check();

        await expect.poll(() => saved && saved.openInNewTab).toBe(true);
    });

    test('changing a behavior select (date format) saves the value', async ({ page }) => {
        let saved = null;
        await page.route('**/api/settings', async (route) => {
            if (route.request().method() === 'POST') {
                saved = JSON.parse(route.request().postData() || '{}');
                return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
            }
            return route.fallback();
        });
        await loadDashboard(page);
        await page.evaluate(() => window.dashboardInstance.config.openConfigView('behavior'));
        await page.locator('[data-behavior-tab="datetime"]').click();

        await page.locator('[data-behavior-field="dateFormat"]').selectOption('iso');

        await expect.poll(() => saved && saved.dateFormat).toBe('iso');
    });

    test('choosing a font size applies the body class and saves', async ({ page }) => {
        let saved = null;
        await page.route('**/api/settings', async (route) => {
            if (route.request().method() === 'POST') {
                saved = JSON.parse(route.request().postData() || '{}');
                return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
            }
            return route.fallback();
        });
        await loadDashboard(page);
        await page.evaluate(() => window.dashboardInstance.config.openConfigView('appearance'));

        await page.locator('[data-appearance-font="xl"]').click();

        await expect(page.locator('body')).toHaveClass(/font-size-xl/);
        await expect.poll(() => saved && saved.fontSize).toBe('xl');
    });
});

test.describe('Shift+S opens config', () => {
    test('opens the view from the bookmark grid and Escape returns', async ({ page }) => {
        await loadDashboard(page);
        await page.keyboard.press('Shift+S');
        await expect.poll(() => page.evaluate(() => window.dashboardInstance?.activeView)).toBe('config');
        await expect.poll(() => page.evaluate(() => window.location.hash)).toBe('#config');
        await page.keyboard.press('Escape');
        await expect.poll(() => page.evaluate(() => window.dashboardInstance?.activeView)).toBe('bookmarks');
    });

    test('stays inside the dashboard shell rather than loading /config', async ({ page }) => {
        await loadDashboard(page);
        // The older '<' shortcut navigates to the standalone page; this one must
        // not, so a full document load would be a regression.
        let navigated = false;
        page.on('framenavigated', (f) => {
            if (f === page.mainFrame() && new URL(f.url()).pathname === '/config') navigated = true;
        });
        await page.keyboard.press('Shift+S');
        await expect.poll(() => page.evaluate(() => window.dashboardInstance?.activeView)).toBe('config');
        expect(navigated).toBe(false);
        expect(new URL(page.url()).pathname).toBe('/');
    });

    test('does not fire while typing into a field', async ({ page }) => {
        await loadDashboard(page);
        await page.evaluate(() => window.dashboardInstance.config.openConfigView('bookmarks'));
        await page.locator('#config-bm-add').click();
        await page.waitForSelector('#new-bookmark-name');
        await page.locator('#new-bookmark-name').click();
        // Two capital S characters: a shortcut that ignored input focus would
        // swallow them and navigate instead.
        await page.locator('#new-bookmark-name').type('Shift Stress');
        await expect(page.locator('#new-bookmark-name')).toHaveValue('Shift Stress');
        await expect(page.locator('#new-bookmark-modal')).toHaveClass(/show/);
    });

    test('the cheat sheet documents the shortcut', async ({ page }) => {
        await loadDashboard(page);
        const found = await page.evaluate(() =>
            (window.dashboardInstance.getKeyboardCheatSheetItems() || [])
                .flatMap((s) => s.items)
                .filter((i) => /Shift \+ S/.test(i.keys))
                .map((i) => i.description));
        expect(found).toHaveLength(1);
        expect(found[0]).toMatch(/config/i);
        // And it is rendered, not just present in the data. keysToHtml splits
        // the combo into separate <kbd> elements, so match the row by its
        // description and assert the keys cell mentions both Shift and S.
        await page.keyboard.press('!');
        const row = page.locator('.keyboard-cheat-sheet-table tr')
            .filter({ hasText: found[0] }).first();
        await expect(row).toBeVisible();
        const keysText = await row.locator('.keyboard-cheat-sheet-keys').innerText();
        expect(keysText).toMatch(/Shift/i);
        expect(keysText).toMatch(/\bS\b/);
    });
});
