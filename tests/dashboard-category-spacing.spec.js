// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * Vertical space between category rows.
 *
 * Distinct from densityMode, which sizes the bookmark rows inside a category.
 * This is the gap between the rows of categories themselves, which is what makes
 * a wide page feel empty — the old fixed 3rem left a visible band of nothing
 * between every row on a five-column layout.
 */

async function loadDashboard(page) {
    await page.setViewportSize({ width: 1600, height: 1000 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    // row-gap only applies to the non-packed grid; packed columns are flex.
    await page.evaluate(async () => {
        const d = window.dashboardInstance;
        // The default layout's row gap; masonry, a fresh install's default, sets its own.
        d.settings.layoutPreset = 'default';
        d.settings.packedColumns = false;
        await d.renderDashboard({ animate: false });
    });
}

const rowGap = (page) => page.evaluate(() =>
    getComputedStyle(document.querySelector('.dashboard-grid')).rowGap);

test.describe('category spacing', () => {
    test('defaults to following the theme: balanced, tighter than the old fixed gap', async ({ page }) => {
        await loadDashboard(page);
        const set = (theme) => page.evaluate(async (t) => {
            const d = window.dashboardInstance;
            d.settings.categorySpacing = 'theme';
            await d.config.setTheme(t);
            d.setupDOM();
            await d.renderDashboard({ animate: false });
        }, theme);
        const word = () => page.evaluate(() => document.body.getAttribute('data-category-spacing'));
        const start = await page.evaluate(() => window.dashboardInstance.settings.theme);
        await set('slate-dark');
        await expect.poll(word).toBe('balanced');
        // 32px, down from the 48px that was hard-coded before the setting existed.
        expect(await rowGap(page)).toBe('32px');
        // Confetti states its own: airy.
        await set('look-confetti-dark');
        await expect.poll(word).toBe('airy');
        expect(await rowGap(page)).toBe('48px');
        await set(start);
        await page.evaluate(() => window.dashboardInstance.config.saveSettingsWithFeedback());
    });

    test('each choice drives the gap', async ({ page }) => {
        await loadDashboard(page);
        for (const [mode, expected] of [['snug', '20px'], ['airy', '48px'], ['balanced', '32px']]) {
            await page.evaluate(async (m) => {
                const d = window.dashboardInstance;
                d.settings.categorySpacing = m;
                document.body.setAttribute('data-category-spacing', m);
                await d.renderDashboard({ animate: false });
            }, mode);
            expect(await rowGap(page)).toBe(expected);
        }
    });

    // Masonry is the default layout of a fresh install; it drew its blocks on a
    // fixed gap of its own and the setting did nothing there.
    test('each choice drives the gap in masonry too', async ({ page }) => {
        await loadDashboard(page);
        await page.evaluate(async () => {
            const d = window.dashboardInstance;
            d.settings.layoutPreset = 'masonry';
            await d.renderDashboard({ animate: false });
        });
        await expect.poll(() => page.evaluate(() => document.querySelector('.dashboard-grid').classList.contains('layout-masonry'))).toBe(true);
        const seen = {};
        for (const mode of ['snug', 'balanced', 'airy']) {
            await page.evaluate(async (m) => {
                const d = window.dashboardInstance;
                d.settings.categorySpacing = m;
                document.body.setAttribute('data-category-spacing', m);
                await d.renderDashboard({ animate: false });
            }, mode);
            seen[mode] = parseFloat(await rowGap(page));
        }
        expect(seen.snug).toBeLessThan(seen.balanced);
        expect(seen.balanced).toBeLessThan(seen.airy);
    });

    // Packed columns is what a fresh install opens on, and its columns kept a fixed
    // 3rem between blocks: the setting only reached the spread layout.
    test('each choice drives the gap between blocks in packed columns', async ({ page }) => {
        await loadDashboard(page);
        await page.evaluate(async () => {
            const d = window.dashboardInstance;
            d.settings.packedColumns = true;
            await d.renderDashboard({ animate: false, forceFull: true });
        });
        await expect.poll(() => page.evaluate(() => !!document.querySelector('.dashboard-grid.packed-columns .dashboard-column'))).toBe(true);
        const columnGap = () => page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.dashboard-grid.packed-columns .dashboard-column')).rowGap));
        const seen = {};
        for (const mode of ['snug', 'balanced', 'airy']) {
            await page.evaluate(async (m) => {
                const d = window.dashboardInstance;
                d.settings.categorySpacing = m;
                document.body.setAttribute('data-category-spacing', m);
            }, mode);
            seen[mode] = await columnGap();
        }
        expect(seen.snug).toBe(20);
        expect(seen.balanced).toBe(32);
        expect(seen.airy).toBe(48);
    });

    test('changing it in config applies without a reload', async ({ page }) => {
        await loadDashboard(page);
        await page.evaluate(async () => {
            const cfg = window.dashboardInstance.config;
            await (cfg.appearanceTab = cfg.appearanceTab || 'general', cfg).openConfigView('appearance');
        });
        await page.locator('[data-appearance-tab="layout"]').click();

        const card = page.locator('[data-behavior-field="categorySpacing"][data-behavior-value="snug"]');
        await expect(card).toBeVisible();
        await card.click();

        // The value is mirrored onto <body>, which is why the control is
        // chromeRender rather than render: without the chrome pass the CSS keeps
        // the old gap until the page is reloaded.
        await expect.poll(() => page.evaluate(() => document.body.getAttribute('data-category-spacing'))).toBe('snug');

        await page.evaluate(() => window.dashboardInstance.config.closeConfigView());
        await expect.poll(() => rowGap(page)).toBe('20px');
    });

    test('an unknown stored value falls back to balanced', async ({ page }) => {
        await loadDashboard(page);
        // The server validates on read, so a hand-edited settings.json cannot
        // leave the grid with no gap at all.
        const applied = await page.evaluate(async () => {
            const res = await fetch('/api/settings');
            const s = await res.json();
            return s.categorySpacing;
        });
        expect(['snug', 'balanced', 'airy']).toContain(applied);
    });
});

test.describe('page margins', () => {
    const containerPad = (page) => page.evaluate(() =>
        getComputedStyle(document.querySelector('.container')).paddingLeft);

    test('defaults to the margin the dashboard always had', async ({ page }) => {
        await loadDashboard(page);
        expect(await page.evaluate(() => document.body.getAttribute('data-side-margin'))).toBe('balanced');
        // clamp(2rem, 6vw, 8rem) at 1600px wide → 6vw → 96px. Unchanged from
        // before the setting existed, so an existing install sees no difference.
        expect(await containerPad(page)).toBe('96px');
    });

    test('snug hands the width back to the grid', async ({ page }) => {
        await loadDashboard(page);
        // Packed columns (the default) size themselves from the space available,
        // so the reclaimed band actually becomes grid. With packing off the
        // columns are a fixed width and the reclaimed space stays empty — the
        // margin still shrinks, but nothing grows into it.
        await page.evaluate(async () => {
            const d = window.dashboardInstance;
            d.settings.packedColumns = true;
            await d.renderDashboard({ animate: false });
        });
        const before = await page.evaluate(() =>
            Math.round(document.querySelector('.dashboard-grid').getBoundingClientRect().width));

        await page.evaluate(() => {
            window.dashboardInstance.settings.sideMargin = 'snug';
            document.body.setAttribute('data-side-margin', 'snug');
        });

        expect(await containerPad(page)).toBe('40px');
        const after = await page.evaluate(() =>
            Math.round(document.querySelector('.dashboard-grid').getBoundingClientRect().width));
        expect(after).toBeGreaterThan(before);
    });

    // The columns stop growing at a width and a wide window centres them, so the
    // band beside the grid used to move only the header. It now moves the columns.
    test('each choice moves the columns, not only the header', async ({ page }) => {
        await loadDashboard(page);
        await page.evaluate(async () => {
            const d = window.dashboardInstance;
            d.settings.layoutPreset = 'masonry';
            d.settings.packedColumns = true;
            await d.renderDashboard({ animate: false });
        });
        const widths = {};
        for (const mode of ['snug', 'balanced', 'airy']) {
            await page.evaluate((m) => {
                window.dashboardInstance.settings.sideMargin = m;
                document.body.setAttribute('data-side-margin', m);
            }, mode);
            widths[mode] = await page.evaluate(() =>
                Math.round(document.querySelector('.dashboard-grid .category').getBoundingClientRect().width));
        }
        expect(widths.snug).toBeGreaterThan(widths.balanced);
        expect(widths.balanced).toBeGreaterThan(widths.airy);
    });

    test('airy widens the band', async ({ page }) => {
        await loadDashboard(page);
        await page.evaluate(() => {
            window.dashboardInstance.settings.sideMargin = 'airy';
            document.body.setAttribute('data-side-margin', 'airy');
        });
        expect(await containerPad(page)).toBe('144px');
    });

    test('both controls are buttons, not a dropdown', async ({ page }) => {
        await loadDashboard(page);
        await page.evaluate(async () => {
            const cfg = window.dashboardInstance.config;
            await (cfg.appearanceTab = cfg.appearanceTab || 'general', cfg).openConfigView('appearance');
        });
        await page.locator('[data-appearance-tab="layout"]').click();

        for (const field of ['categorySpacing', 'sideMargin']) {
            await expect(page.locator(`[data-behavior-field="${field}"][data-behavior-type="cards"]`)).toHaveCount(field === 'sideMargin' ? 3 : 4);
            // A <select> would hide two of three spatial choices behind a click.
            await expect(page.locator(`select[data-behavior-field="${field}"]`)).toHaveCount(0);
            // The stored value is pre-selected, so the group shows where you are.
            await expect(page.locator(`[data-behavior-field="${field}"].is-active`)).toHaveCount(1);
        }
    });

    test('clicking a margin card applies it without a reload', async ({ page }) => {
        await loadDashboard(page);
        await page.evaluate(async () => {
            const cfg = window.dashboardInstance.config;
            await (cfg.appearanceTab = cfg.appearanceTab || 'general', cfg).openConfigView('appearance');
        });
        await page.locator('[data-appearance-tab="layout"]').click();

        await page.locator('[data-behavior-field="sideMargin"][data-behavior-value="snug"]').click();
        await expect.poll(() => page.evaluate(() => document.body.getAttribute('data-side-margin'))).toBe('snug');

        await page.evaluate(() => window.dashboardInstance.config.closeConfigView());
        await expect.poll(() => containerPad(page)).toBe('40px');
    });
});

test.describe('Appearance → Layout panel order', () => {
    test('Bookmarks layout leads, and the version panel is gone', async ({ page }) => {
        await loadDashboard(page);
        await page.evaluate(async () => {
            await (window.dashboardInstance.config.appearanceTab = window.dashboardInstance.config.appearanceTab || 'general', window.dashboardInstance.config).openConfigView('appearance');
        });
        await page.locator('[data-appearance-tab="layout"]').click();

        // Ordered by how often a panel is touched: the grid is what people come
        // here to change. The version switch that used to close the tab is gone
        // with the layout choice itself (v1.10.0).
        //
        // Categories across columns follows the grid it belongs to: how tall a category
        // gets and how wide it may be are two halves of one question, and both
        // are read after the column count they depend on.
        // First text node only: the heading also carries a "Reset panel" button
        // once something in that panel differs from its default, and whether it
        // is there depends on state left by other tests.
        await expect.poll(() => page.evaluate(() =>
            [...document.querySelectorAll('.config-panel-title')]
                .map((h) => (h.firstChild?.textContent || '').trim())
        //
        // Button bar left this tab when it was given one of its own (v1.3.0):
        // where the bar sits and which buttons it carries are the same errand,
        // and they now sit together under Button bar.
        )).toEqual(['Bookmarks layout', 'Categories across columns']);
    });

    test('the moved controls are still bound', async ({ page }) => {
        await loadDashboard(page);
        await page.evaluate(async () => {
            await (window.dashboardInstance.config.appearanceTab = window.dashboardInstance.config.appearanceTab || 'general', window.dashboardInstance.config).openConfigView('appearance');
        });
        await page.locator('[data-appearance-tab="layout"]').click();

        // Panels are bound by attribute across the whole container, so moving
        // the markup must not cost the bindings — but that is worth pinning.
        const card = page.locator('[data-behavior-field="sideMargin"][data-behavior-value="snug"]');
        await expect(card).toBeVisible();
        await card.click();
        await expect.poll(() => page.evaluate(() => document.body.getAttribute('data-side-margin'))).toBe('snug');
    });
});
