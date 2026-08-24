// @ts-check
const { test, expect } = require('./fixtures');
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

    /**
     * The status tile row is gone — every count it showed was already in At a
     * glance or in Needs attention. The headline numbers still have to be there.
     */
    test('the overview section leads with the headline counts', async ({ page }) => {
        await loadDashboard(page);

        await page.evaluate(() => window.dashboardInstance.config.openConfigView());

        await expect(page.locator('.config-tiles--overview')).toHaveCount(0);
        const glance = page.locator('.config-mini-list');
        await expect(glance.first()).toBeVisible();
        expect((await glance.first().innerText()).toLowerCase()).toContain('bookmarks');
    });

    test('the bookmarks section shows five summary tiles on one row', async ({ page }) => {
        await loadDashboard(page);
        await page.evaluate(() => window.dashboardInstance.config.openConfigView('bookmarks'));

        const tiles = page.locator('.config-tiles--bookmarks .config-tile');
        await expect(tiles).toHaveCount(5);
        const row = await page.evaluate(() => {
            const els = [...document.querySelectorAll('.config-tiles--bookmarks .config-tile')];
            const ys = els.map((el) => Math.round(el.getBoundingClientRect().y));
            return { count: els.length, sameRow: Math.max(...ys) - Math.min(...ys) < 8 };
        });
        expect(row.count).toBe(5);
        expect(row.sameRow).toBe(true);
    });

    /*
     * The carousel this used to describe is gone (v1.3.3). It showed one of
     * forty-nine spotlights at a time — 498px of a 1451px page for a single
     * item, needing forty-eight clicks to show what it had — and the overview
     * answers "what is new" as one dated stream instead. What replaced it is
     * pinned in config-overview-news.spec.js; what matters here is that the
     * stepper and its counter are not on the page for anyone to click.
     */
    test('the overview has no feature carousel to step through', async ({ page }) => {
        await loadDashboard(page);
        await page.evaluate(() => window.dashboardInstance.config.openConfigView('overview'));

        await expect(page.locator('.config-news-panel')).toBeVisible();
        for (const gone of ['.config-feature-spotlight', '.config-new-features-nav',
            '.config-new-features-counter', '[data-overview-feature]']) {
            await expect(page.locator(gone)).toHaveCount(0);
        }
    });

    test('clicking a section nav item switches section and hash', async ({ page }) => {
        await loadDashboard(page);
        await page.evaluate(() => window.dashboardInstance.config.openConfigView());

        await page.locator('[data-config-section="appearance"]').click();

        expect(await page.evaluate(() => window.dashboardInstance.config.section)).toBe('appearance');
        expect(await page.evaluate(() => window.location.hash)).toBe('#config/appearance');
        await expect(page.locator('[data-config-section="appearance"]')).toHaveClass(/is-active/);
    });

    test('a broken-links row hands off to the health view', async ({ page }) => {
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

        // Broken links is an attention row now, not a status tile.
        const brokenRow = page.locator('.config-attention-row', { hasText: /broken/i });
        await expect(brokenRow).toBeVisible();
        await brokenRow.locator('[data-overview-go]').click();

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
        // Reset moved to its own sub-tab — see config-data-reset.spec.js.
        await expect(page.locator('[data-db-tab="reset"]')).toBeVisible();
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

        for (const action of ['csv-export', 'browser-import', 'settings-export', 'settings-import']) {
            await expect(page.locator(`[data-backup-action="${action}"]`)).toBeVisible();
        }
        // reset-onboarding moved to Behavior → General, beside the tips toggle:
        // sitting in the danger panel next to "Delete ALL data" made replaying
        // the quick-start card read as destructive.
        await expect(page.locator('[data-backup-action="reset-onboarding"]')).toHaveCount(0);
        await expect(page.locator('[data-backup-toggle="autoBackupEnabled"]')).toBeVisible();
        // How often that runs belongs here; how often links are re-checked does
        // not, and was a second copy of a control on Behavior → Status & health.
        await expect(page.locator('[data-backup-select="autoBackupIntervalDays"]')).toBeVisible();
        await expect(page.locator('[data-backup-toggle="healthAutoRecheckEnabled"]')).toHaveCount(0);
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

    /**
     * Favicon harmonization was in the old config and the dashboard still reads
     * it, so leaving it out made a working feature unreachable. It is stored per
     * theme under the *resolved* theme (<html data-theme>), not settings.theme —
     * with auto dark mode on those differ, and writing the wrong key would save
     * to an entry nothing reads.
     */
    test('favicon harmonization is configurable and stored per theme', async ({ page }) => {
        await loadDashboard(page);
        await page.evaluate(() => window.dashboardInstance.config.openConfigView('appearance'));

        await expect(page.locator('[data-appearance-toggle-icons="on"]')).toBeVisible();

        // Off hides the sub-controls; on brings back style, intensity, preview.
        await page.locator('[data-appearance-toggle-icons="off"]').click();
        await expect(page.locator('[data-appearance-iconstyle]')).toHaveCount(0);
        await page.locator('[data-appearance-toggle-icons="on"]').click();
        await expect(page.locator('[data-appearance-iconstyle]')).toHaveCount(3);
        await expect(page.locator('[data-appearance-icon-intensity]')).toBeVisible();

        await page.locator('[data-appearance-iconstyle="tinted"]').click();
        await expect.poll(() => page.evaluate(() => {
            const key = document.documentElement.getAttribute('data-theme');
            const e = window.dashboardInstance.settings.themeIconStyling?.[key];
            return e ? `${e.enabled}:${e.style}` : 'missing';
        })).toBe('true:tinted');

        // Survives a round trip rather than only living in memory.
        await page.reload();
        await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
        expect(await page.evaluate(() => {
            const key = document.documentElement.getAttribute('data-theme');
            return window.dashboardInstance.settings.themeIconStyling?.[key]?.style;
        })).toBe('tinted');
    });

    test('favicon harmonization stays enabled after leaving config', async ({ page }) => {
        await loadDashboard(page);
        await page.evaluate(() => window.dashboardInstance.config.openConfigView('appearance'));

        await page.locator('[data-appearance-toggle-icons="on"]').click();
        await expect(page.locator('[data-appearance-toggle-icons="on"]')).toHaveAttribute('aria-pressed', 'true');

        await page.keyboard.press('Escape');
        await expect(page.locator('#dashboard-layout.config-layout')).toHaveCount(0);

        await page.evaluate(() => window.dashboardInstance.config.openConfigView('appearance'));
        await expect(page.locator('[data-appearance-toggle-icons="on"]')).toHaveAttribute('aria-pressed', 'true');
    });

    test('favicon harmonization applies to the dashboard without reload', async ({ page }) => {
        await loadDashboard(page);
        const hasIcon = await page.evaluate(() => {
            const slot = document.querySelector('#dashboard-layout .bookmark-icon-slot img.bookmark-icon');
            return !!slot;
        });
        test.skip(!hasIcon, 'needs at least one bookmark with a favicon');

        await page.evaluate(() => window.dashboardInstance.config.openConfigView('appearance'));

        await page.locator('[data-appearance-toggle-icons="on"]').click();
        await page.locator('[data-appearance-iconstyle="muted"]').click();

        await page.keyboard.press('Escape');
        await expect(page.locator('#dashboard-layout.config-layout')).toHaveCount(0);

        await expect.poll(() => page.evaluate(() => {
            const img = document.querySelector('#dashboard-layout .bookmark-icon-slot img.bookmark-icon');
            return img ? getComputedStyle(img).filter : '';
        }), { timeout: 5000 }).toMatch(/grayscale/);
    });

    /**
     * Random theme mode rotates the displayed theme on every view change, and
     * each theme keeps its own harmonisation entry — so a toggle set while one
     * random theme was showing looked disabled again the moment the pool
     * rotated to a different one. While random mode is on, harmonisation must
     * be one shared setting instead of following whichever theme is current.
     */
    test('favicon harmonization stays enabled while random theme mode rotates themes', async ({ page }) => {
        await loadDashboard(page);
        await page.evaluate(() => window.dashboardInstance.config.openConfigView('appearance'));

        await page.evaluate(() => window.dashboardInstance.config.setRandomThemeMode('view'));
        await expect.poll(() => page.evaluate(() =>
            window.dashboardInstance.settings.randomThemeMode)).toBe('view');

        await page.locator('[data-appearance-toggle-icons="on"]').click();
        await expect(page.locator('[data-appearance-toggle-icons="on"]')).toHaveAttribute('aria-pressed', 'true');

        // Force the pool to a different theme, as a view change during "on view
        // change" mode would — the toggle must not depend on which one shows.
        await page.evaluate(() => {
            window.ThemeLoader?.clearSessionRandomTheme?.();
            document.documentElement.setAttribute('data-theme', 'light');
        });
        await page.evaluate(() => window.dashboardInstance.config.render());
        await expect(page.locator('[data-appearance-toggle-icons="on"]')).toHaveAttribute('aria-pressed', 'true');

        // And it must survive a reload, which is where "not saved" was reported.
        await page.reload();
        await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
        await dismissOnboardingIfPresent(page);
        await dismissBlockingOverlays(page);
        await page.evaluate(() => window.dashboardInstance.config.openConfigView('appearance'));
        await expect(page.locator('[data-appearance-toggle-icons="on"]')).toHaveAttribute('aria-pressed', 'true');
    });

    test('the icon-styling preview is driven by the real theme CSS', async ({ page }) => {
        await loadDashboard(page);
        await page.evaluate(() => window.dashboardInstance.config.openConfigView('appearance'));

        await page.locator('[data-appearance-toggle-icons="on"]').click();
        await page.locator('[data-appearance-iconstyle="muted"]').click();

        // theme.css turns Muted into a grayscale filter on the sample, so the
        // preview shows the same treatment the dashboard applies to a favicon.
        await expect.poll(() => page.evaluate(() => {
            const inner = document.querySelector('.config-icon-preview-dot .preview-icon');
            return inner ? getComputedStyle(inner).filter : '';
        })).toMatch(/grayscale/);

        // The slider updates the preview live, before the change is committed.
        const range = page.locator('[data-appearance-icon-intensity]');
        await range.fill('0.9');
        await range.dispatchEvent('input');
        await expect.poll(() => page.evaluate(() =>
            document.querySelector('.config-icon-preview-dot')?.style.getPropertyValue('--icon-theme-intensity'))).toBe('0.9');
    });

    test('appearance exposes the full control set', async ({ page }) => {
        await loadDashboard(page);
        await page.evaluate(() => window.dashboardInstance.config.openConfigView('appearance'));

        await expect(page.locator('[data-appearance-select="fontPreset"]')).toBeVisible();
        await expect(page.locator('[data-appearance-weight="bold"]')).toBeVisible();
        await expect(page.locator('[data-appearance-bg="gradient"]')).toBeVisible();
        await expect(page.locator('[data-appearance-range="backgroundOpacity"]')).toBeVisible();
        await expect(page.locator('[data-appearance-action="upload-font"]')).toBeVisible();
        await expect(page.locator('[data-appearance-action="edit-colors"]')).toBeVisible();

        await page.locator('[data-appearance-tab="layout"]').click();
        // Icon size moved out of the Layout version panel and into Bookmarks
        // layout, so it is a schema select now rather than a button group.
        await expect(page.locator('[data-behavior-field="launcherIconSize"]')).toBeVisible();

        await page.locator('[data-appearance-tab="display"]').click();
        await expect(page.locator('[data-appearance-toggle="showIcons"]')).toBeVisible();
        await expect(page.locator('[data-appearance-toggle="animationsEnabled"]')).toBeVisible();

        // Branding (page title + favicon) is the tail of Display now: one panel
        // with one toggle, a text field and an upload did not earn a tab.
        await expect(page.locator('[data-appearance-tab="branding"]')).toHaveCount(0);
        await expect(page.locator('[data-appearance-toggle="enableCustomTitle"]')).toBeVisible();
        await expect(page.locator('[data-appearance-text="customTitle"]')).toBeVisible();
        await expect(page.locator('[data-appearance-action="upload-favicon"]')).toBeVisible();
    });

    /**
     * The four background type buttons used to dead-end: picking Gradient or
     * Image set the type but offered nothing to choose, so no background was
     * ever applied. Each now reveals its own control.
     */
    test('gradient and image backgrounds can actually be chosen', async ({ page }) => {
        await loadDashboard(page);
        await page.evaluate(() => window.dashboardInstance.config.openConfigView('appearance'));

        await page.locator('[data-appearance-bg="gradient"]').click();
        const swatches = page.locator('[data-appearance-gradient]');
        await expect(swatches.first()).toBeVisible();
        expect(await swatches.count()).toBeGreaterThan(5);

        await swatches.nth(2).click();
        await expect.poll(() => page.evaluate(() => ({
            name: window.dashboardInstance.settings.backgroundGradient,
            css: document.documentElement.style.getPropertyValue('--custom-background-image'),
        })).then((r) => Boolean(r.name) && r.css.includes('gradient'))).toBe(true);

        await page.locator('[data-appearance-bg="image"]').click();
        const url = page.locator('[data-appearance-text="backgroundImageUrl"]');
        await expect(url).toBeVisible();
        await url.fill('https://example.com/pic.jpg');
        await url.dispatchEvent('change');
        await expect
            .poll(() => page.evaluate(() => window.dashboardInstance.settings.backgroundImageUrl))
            .toBe('https://example.com/pic.jpg');
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

        const picker = page.locator('[data-theme-picker-button]');
        await expect(picker).toBeVisible();
        await picker.click();
        // The built-in themes from the endpoint appear as options.
        await expect(page.locator('[data-theme-option="ocean-dark"]')).toHaveCount(1);

        await page.locator('[data-theme-option="ocean-dark"]').click();

        // Assert the stored choice, not the rendered one: with "follow system
        // dark mode" on, ThemeLoader.resolveDisplayTheme pairs the stored theme
        // with the OS preference, so data-theme legitimately reads ocean-light
        // on a light system. Asserting the resolved value made this test depend
        // on whichever spec ran before it.
        await expect.poll(() => saved && saved.theme).toBe('ocean-dark');
        await expect
            .poll(() => page.evaluate(() => window.dashboardInstance.settings.theme))
            .toBe('ocean-dark');
    });

    test('the theme-colours link opens the native editor tab', async ({ page }) => {
        await loadDashboard(page);
        await page.evaluate(() => window.dashboardInstance.config.openConfigView('appearance'));

        await page.locator('[data-appearance-action="edit-colors"]').click();

        // This used to reveal the old config's editor, embedded from a
        // server-rendered partial. That editor's buttons were wired through a
        // delegate calling window.configManager, which does not exist in this
        // view, so its Add button silently did nothing. It is replaced by the
        // native Custom themes tab — see config-custom-themes.spec.js.
        await expect(page.locator('#config-theme-colors-panel')).toHaveCount(0);
        await expect(page.locator('[data-theme-add]')).toBeVisible();
    });

    test('appearance has layout and display sub-tabs', async ({ page }) => {
        await loadDashboard(page);
        await page.evaluate(() => window.dashboardInstance.config.openConfigView('appearance'));

        await page.locator('[data-appearance-tab="layout"]').click();
        await expect(page.locator('[data-behavior-field="columnsPerRow"]')).toBeVisible();
        await expect(page.locator('[data-appearance-layout="classic"]')).toBeVisible();

        await page.locator('[data-appearance-tab="display"]').click();
        await expect(page.locator('[data-behavior-field="showStatus"]')).toBeVisible();
        await expect(page.locator('[data-appearance-toggle="showIcons"]')).toBeVisible();
    });

    test('the behavior section renders grouped settings across sub-tabs', async ({ page }) => {
        await loadDashboard(page);
        await page.evaluate(() => window.dashboardInstance.config.openConfigView('behavior'));

        // General tab is active by default.
        await expect(page.locator('[data-behavior-field="openInNewTab"]')).toBeVisible();
        // Other groups live under their own sub-tabs.
        await page.locator('[data-behavior-tab="datetime"]').click();
        await expect(page.locator('[data-behavior-field="dateFormat"]')).toBeVisible();
        await page.locator('[data-behavior-tab="search"]').click();
        await expect(page.locator('[data-behavior-field="enableFuzzySuggestions"]')).toBeVisible();
        // Pasting a URL is an inbox errand — where it lands is decided beside
        // the inbox switch, not among the search settings.
        await page.locator('[data-behavior-tab="inbox"]').click();
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
        await expect(page.locator('#bookmark-form-modal.show')).toBeVisible();
        const nameInput = page.locator('#bookmark-form-modal .bookmark-inline-form .bookmark-inline-input').first();
        await nameInput.click();
        // Two capital S characters: a shortcut that ignored input focus would
        // swallow them and navigate instead.
        await nameInput.type('Shift Stress');
        await expect(nameInput).toHaveValue('Shift Stress');
        await expect(page.locator('#bookmark-form-modal')).toHaveClass(/show/);
    });

    test('the cheat sheet documents the shortcut', async ({ page }) => {
        await loadDashboard(page);
        const found = await page.evaluate(() =>
            (window.dashboardInstance.getKeyboardCheatSheetItems() || [])
                .flatMap((s) => s.items)
                .filter((i) => /Shift \+ S/.test(i.keys))
                .filter((i) => /^Open config/i.test(i.description))
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

/**
 * Reopen config the way Shift+S does — no explicit section, no hash.
 *
 * Not the key itself: Shift+S from the grid does not reach the handler under
 * Playwright (the two tests in "Shift+S opens config" above fail on that with
 * and without the location memory), so pressing it here would test the harness
 * rather than the restore. `config.section` is reset first, or an assertion
 * that it came back as `behavior` would pass on the value left in memory.
 */
async function reopenConfigLikeShiftS(page) {
    await page.evaluate(async () => {
        window.location.hash = '';
        window.dashboardInstance.config.section = 'overview';
        await window.dashboardInstance.config.openConfigView();
    });
    await page.waitForSelector('#config-view-body', { timeout: 15_000 });
}

test.describe('config remembers last location', () => {
    // Escape used to be the exit that deliberately forgot, so coming straight
    // back landed on Overview and you re-navigated. Every exit now remembers,
    // for fifteen minutes.
    test('Shift+S returns to the section Escape left', async ({ page }) => {
        await loadDashboard(page);
        await page.evaluate(() => localStorage.removeItem('nextdash:config-last-location-v1'));
        await page.evaluate(() => window.dashboardInstance.config.openConfigView('bookmarks'));
        await page.keyboard.press('Escape');
        await expect.poll(() => page.evaluate(() => window.dashboardInstance?.activeView)).toBe('bookmarks');

        await reopenConfigLikeShiftS(page);
        expect(await page.evaluate(() => window.dashboardInstance.activeView)).toBe('config');
        expect(await page.evaluate(() => window.dashboardInstance.config.section)).toBe('bookmarks');
    });

    test('Escape restores the sub-tab too on the next Shift+S visit', async ({ page }) => {
        await loadDashboard(page);
        await page.evaluate(() => localStorage.removeItem('nextdash:config-last-location-v1'));
        await page.evaluate(() => window.dashboardInstance.config.openConfigView('behavior'));
        await page.locator('[data-behavior-tab="privacy"]').click();
        await page.keyboard.press('Escape');
        await expect.poll(() => page.evaluate(() => window.dashboardInstance?.activeView)).toBe('bookmarks');

        await reopenConfigLikeShiftS(page);
        expect(await page.evaluate(() => window.dashboardInstance.config.section)).toBe('behavior');
        expect(await page.evaluate(() => window.dashboardInstance.config.behaviorTab)).toBe('privacy');
    });

    test('a location older than fifteen minutes starts on Overview again', async ({ page }) => {
        await loadDashboard(page);
        await page.evaluate(() => localStorage.removeItem('nextdash:config-last-location-v1'));
        await page.evaluate(() => window.dashboardInstance.config.openConfigView('bookmarks'));
        await page.keyboard.press('Escape');
        await expect.poll(() => page.evaluate(() => window.dashboardInstance?.activeView)).toBe('bookmarks');

        // Age the entry rather than waiting the window out.
        await page.evaluate(() => {
            const k = 'nextdash:config-last-location-v1';
            const data = JSON.parse(localStorage.getItem(k));
            data.savedAt = Date.now() - (16 * 60 * 1000);
            localStorage.setItem(k, JSON.stringify(data));
        });

        await reopenConfigLikeShiftS(page);
        expect(await page.evaluate(() => window.dashboardInstance.activeView)).toBe('config');
        expect(await page.evaluate(() => window.dashboardInstance.config.section)).toBe('overview');
    });

    test('Shift+H from config remembers the section for Shift+S', async ({ page }) => {
        await loadDashboard(page);
        await page.evaluate(() => localStorage.removeItem('nextdash:config-last-location-v1'));
        await page.evaluate(() => window.dashboardInstance.config.openConfigView('bookmarks'));
        await page.locator('#config-section-panel').focus();
        await page.keyboard.press('Shift+H');
        await expect.poll(() => page.evaluate(() => window.dashboardInstance?.activeView)).toBe('health');

        await page.keyboard.press('Shift+S');
        await expect.poll(() => page.evaluate(() => window.dashboardInstance?.activeView)).toBe('config');
        await expect.poll(() => page.evaluate(() => window.dashboardInstance.config.section)).toBe('bookmarks');
    });

    test('Shift+I from config remembers the sub-tab for Shift+S', async ({ page }) => {
        await loadDashboard(page);
        await page.evaluate(() => localStorage.removeItem('nextdash:config-last-location-v1'));
        await page.evaluate(() => window.dashboardInstance.config.openConfigView('behavior'));
        await page.locator('[data-behavior-tab="privacy"]').click();
        await page.locator('#config-section-panel').focus();
        await page.keyboard.press('Shift+I');
        await expect.poll(() => page.evaluate(() => window.dashboardInstance?.activeView)).toBe('inbox');

        await page.keyboard.press('Shift+S');
        await expect.poll(() => page.evaluate(() => window.dashboardInstance.config.section)).toBe('behavior');
        await expect.poll(() => page.evaluate(() => window.dashboardInstance.config.behaviorTab)).toBe('privacy');
    });

    test('a #config/… deep link overrides the stored location', async ({ page }) => {
        await loadDashboard(page);
        await page.evaluate(() => {
            localStorage.setItem('nextdash:config-last-location-v1', JSON.stringify({
                section: 'bookmarks',
                subTab: null,
                savedAt: Date.now(),
            }));
        });
        await page.goto('/#config/appearance');
        await page.waitForFunction(() => window.dashboardInstance?.activeView === 'config', null, { timeout: 15_000 });
        await dismissOnboardingIfPresent(page);
        await dismissBlockingOverlays(page);

        await expect.poll(() => page.evaluate(() => window.dashboardInstance.config.section)).toBe('appearance');
    });

    test('pressing a page digit leaves config and the next Shift+S returns to it', async ({ page }) => {
        await loadDashboard(page);
        await page.evaluate(() => localStorage.removeItem('nextdash:config-last-location-v1'));
        await page.evaluate(() => window.dashboardInstance.config.openConfigView('stats'));
        await page.locator('#config-section-panel').focus();
        await page.keyboard.press('1');
        await expect.poll(() => page.evaluate(() => window.dashboardInstance?.activeView)).toBe('bookmarks');

        await reopenConfigLikeShiftS(page);
        expect(await page.evaluate(() => window.dashboardInstance.activeView)).toBe('config');
        expect(await page.evaluate(() => window.dashboardInstance.config.section)).toBe('stats');
    });

    test('bare #config restores the section Escape left', async ({ page }) => {
        await loadDashboard(page);
        await page.evaluate(() => localStorage.removeItem('nextdash:config-last-location-v1'));
        await page.evaluate(() => window.dashboardInstance.config.openConfigView('behavior'));
        await page.locator('[data-behavior-tab="privacy"]').click();
        await page.keyboard.press('Escape');
        await expect.poll(() => page.evaluate(() => window.dashboardInstance?.activeView)).toBe('bookmarks');

        await page.goto('/#config');
        await page.waitForFunction(() => window.dashboardInstance?.activeView === 'config', null, { timeout: 15_000 });
        await dismissOnboardingIfPresent(page);
        await dismissBlockingOverlays(page);

        await expect.poll(() => page.evaluate(() => window.dashboardInstance.config.section)).toBe('behavior');
    });

    test('cold load on #config restores the stored sub-tab', async ({ page }) => {
        await page.goto('/');
        await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
        await dismissOnboardingIfPresent(page);
        await page.evaluate(() => {
            localStorage.setItem('nextdash:config-last-location-v1', JSON.stringify({
                section: 'appearance',
                subTab: 'custom-themes',
                savedAt: Date.now(),
            }));
        });
        await page.goto('/#config');
        await page.waitForFunction(() => window.dashboardInstance?.activeView === 'config', null, { timeout: 15_000 });
        await dismissOnboardingIfPresent(page);
        await dismissBlockingOverlays(page);

        await expect.poll(() => page.evaluate(() => window.dashboardInstance.config.section)).toBe('appearance');
        await expect.poll(() => page.evaluate(() => window.dashboardInstance.config.appearanceTab)).toBe('custom-themes');
    });
});

test.describe('< opens the config view', () => {
    test('opens in place rather than loading the old /config page', async ({ page }) => {
        await loadDashboard(page);
        let navigated = false;
        page.on('framenavigated', (f) => {
            if (f === page.mainFrame() && new URL(f.url()).pathname === '/config') navigated = true;
        });
        // '<' used to navigate to the standalone page while Shift+S opened the
        // view, so the two config shortcuts landed somewhere different.
        await page.keyboard.press('Shift+Comma');
        await expect.poll(() => page.evaluate(() => window.dashboardInstance?.activeView)).toBe('config');
        expect(navigated).toBe(false);
        expect(new URL(page.url()).pathname).toBe('/');
    });
});

test.describe('sub-tab deep links', () => {
    test('a #config/<section>/<tab> link opens that tab from a cold load', async ({ page }) => {
        await page.goto('/#config/behavior/privacy');
        await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
        await dismissOnboardingIfPresent(page);

        // Sections with sub-tabs were only reachable at their first tab, so a
        // link to something like Privacy could not be handed out at all.
        await expect.poll(() => page.evaluate(() =>
            window.dashboardInstance.config.section)).toBe('behavior');
        await expect.poll(() => page.evaluate(() =>
            window.dashboardInstance.config.behaviorTab)).toBe('privacy');
        await expect(page.locator('[data-behavior-field="analyticsOptIn"]')).toBeVisible();
    });

    test('switching sub-tab keeps the hash shareable', async ({ page }) => {
        await loadDashboard(page);
        await page.evaluate(() => window.dashboardInstance.config.openConfigView('behavior'));
        await page.locator('[data-behavior-tab="privacy"]').click();
        await expect.poll(() => page.evaluate(() => window.location.hash))
            .toBe('#config/behavior/privacy');

        // The first tab is the section default, so it stays off the URL.
        await page.locator('[data-behavior-tab="general"]').click();
        await expect.poll(() => page.evaluate(() => window.location.hash)).toBe('#config/behavior');
    });

    test('an unknown tab falls back to the section rather than breaking', async ({ page }) => {
        await page.goto('/#config/behavior/nonsense');
        await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
        await dismissOnboardingIfPresent(page);
        await expect.poll(() => page.evaluate(() =>
            window.dashboardInstance.config.section)).toBe('behavior');
        await expect.poll(() => page.evaluate(() =>
            window.dashboardInstance.config.behaviorTab)).toBe('general');
    });

    test('legacy behavior layout and display hashes open appearance tabs', async ({ page }) => {
        await page.goto('/#config/behavior/layout');
        await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
        await dismissOnboardingIfPresent(page);
        await expect.poll(() => page.evaluate(() => window.dashboardInstance.config.section)).toBe('appearance');
        await expect.poll(() => page.evaluate(() => window.dashboardInstance.config.appearanceTab)).toBe('layout');
        await expect(page.locator('[data-appearance-layout="classic"]')).toBeVisible();
        await expect.poll(() => page.evaluate(() => window.location.hash)).toBe('#config/appearance/layout');

        await page.goto('/#config/behavior/display');
        await page.waitForFunction(() => window.dashboardInstance?.activeView === 'config', null, { timeout: 15_000 });
        await expect.poll(() => page.evaluate(() => window.dashboardInstance.config.appearanceTab)).toBe('display');
        await expect(page.locator('[data-appearance-toggle="showIcons"]')).toBeVisible();
        await expect.poll(() => page.evaluate(() => window.location.hash)).toBe('#config/appearance/display');
    });

    test('the analytics modal links straight to privacy', async ({ page }) => {
        await loadDashboard(page);
        await page.evaluate(() => document.querySelector('.quickstart-setup')?.remove());
        await page.evaluate(() => window.DashboardAnalyticsNotice.openDetails());

        // It used to only name the old config's path — "General → Advanced →
        // Privacy" — which no longer exists.
        const body = page.locator('.analytics-notice-modal-body');
        await expect(body).toContainText(/Behavior|Gedrag|Verhalten|Comportement/);
        await expect(body).not.toContainText(/Advanced|Geavanceerd|Erweitert|Avancé/);

        await page.locator('[data-an-action="open-privacy"]').click();
        // State changing is not the same as the user seeing it: assert the tab
        // is actually on screen, not just that behaviorTab was set.
        await expect(page.locator('[data-behavior-field="analyticsOptIn"]')).toBeVisible();
        await expect(page.locator('[data-behavior-tab="privacy"]')).toHaveClass(/is-active/);
        await expect.poll(() => page.evaluate(() => window.location.hash))
            .toBe('#config/behavior/privacy');
    });

    test('turning analytics on lands on the setting that changed', async ({ page }) => {
        await loadDashboard(page);
        await page.evaluate(async () => {
            window.dashboardInstance.settings.analyticsOptIn = false;
            await window.dashboardInstance.saveSettings?.();
            document.querySelector('.quickstart-setup')?.remove();
        });
        await page.evaluate(() => window.DashboardAnalyticsNotice.openDetails());

        // Opting in reloads, which is what loads the tracker — but the reload
        // used to discard where you were, leaving you on the dashboard with
        // nothing to show that anything had happened.
        await page.getByRole('button', { name: /turn on|inschakelen|aktivieren|activer/i }).click();
        await expect.poll(() => page.evaluate(() =>
            window.dashboardInstance?.activeView), { timeout: 15_000 }).toBe('config');
        await expect(page.locator('[data-behavior-field="analyticsOptIn"]')).toBeVisible();
        await expect(page.locator('[data-behavior-field="analyticsOptIn"]')).toBeChecked();
    });

    test('config header breadcrumb reflects section and bookmarks page filter', async ({ page }) => {
        await loadDashboard(page);
        await page.evaluate(() => window.dashboardInstance.config.openConfigView('bookmarks'));
        const pageId = await page.evaluate(() => String(window.dashboardInstance.pages[0]?.id || ''));
        await page.selectOption('#config-bm-page', pageId);
        await expect(page.locator('.config-view-breadcrumb')).toHaveCount(0);
        // The dashboard heading names the view; the trail sits in the panel head
        // with the section it describes, and carries the page filter.
        await expect(page.locator('.title')).toHaveText('config');
        await expect.poll(async () => page.locator('.config-view-head-breadcrumb').textContent()).toMatch(/bookmarks/i);
        await expect.poll(async () => page.locator('.config-view-head-breadcrumb').textContent()).not.toBe('config › bookmarks');
    });
});
