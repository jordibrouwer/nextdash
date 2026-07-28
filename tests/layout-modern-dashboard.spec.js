// @ts-check
const { test, expect } = require('@playwright/test');
const {
    markWhatsNewSeen,
    prepareDashboardInteraction,
    openShortcutSearch,
} = require('./e2e-helpers');

/**
 * Modern layout coverage for the dashboard chrome and the overlay layer —
 * layout-modern.css and overlays-modern.css.
 *
 * These two files carry the bulk of the modern layer and were the only part of
 * it that never had tests: the view-level files (health, config, inbox) got
 * theirs as each was covered. This spec pins the load-bearing pieces, the ones
 * present on every page load, rather than trying to assert all ~90 selectors.
 *
 * Same shape as the sibling specs: both layouts render identical markup, so
 * every assertion compares a computed style between them on the same element.
 */

async function loadDashboard(page) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await prepareDashboardInteraction(page);
}

/**
 * Switch layout in place. Transitions are killed first: modern animates
 * box-shadow, and a shadow still interpolating out of `none` computes as fully
 * transparent, which would make an assertion pass while nothing is drawn.
 */
async function setLayout(page, version) {
    await page.addStyleTag({
        content: '*, *::before, *::after { transition: none !important; animation: none !important; }',
    });
    await page.evaluate((v) => {
        document.documentElement.setAttribute('data-layout-version', v);
        document.body.setAttribute('data-layout-version', v);
    }, version);
    await page.evaluate(() => new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(resolve));
    }));
}

async function computed(page, selector, props) {
    return page.evaluate(({ sel, list }) => {
        const el = document.querySelector(sel);
        if (!el) throw new Error(`missing element: ${sel}`);
        const s = getComputedStyle(el);
        return Object.fromEntries(list.map((p) => [p, s[p]]));
    }, { sel: selector, list: props });
}

async function bothLayouts(page, selector, props) {
    await setLayout(page, 'classic');
    const classic = await computed(page, selector, props);
    await setLayout(page, 'modern');
    const modern = await computed(page, selector, props);
    return { classic, modern };
}

test.describe('modern layout — dashboard chrome', () => {
    test('turns the page tabs into a pill group', async ({ page }) => {
        await loadDashboard(page);

        // Classic underlines the active tab; modern makes the strip a rounded
        // container with pill buttons inside it.
        const nav = await bothLayouts(page, '.page-navigation', ['borderRadius', 'borderTopWidth']);
        expect(nav.classic.borderRadius).toBe('0px');
        expect(nav.modern.borderRadius).not.toBe('0px');

        const btn = await bothLayouts(page, '.page-nav-btn', ['borderRadius', 'borderBottomWidth']);
        expect(btn.modern.borderRadius).not.toBe(btn.classic.borderRadius);
        // The classic underline is a bottom border; modern drops it.
        expect(btn.modern.borderBottomWidth).toBe('0px');
    });

    test('lays the header controls out as one aligned, non-overlapping row', async ({ page }) => {
        await loadDashboard(page);
        await page.evaluate(() => {
            window.dashboardInstance.settings.inboxEnabled = true;
            window.dashboardInstance.renderPageNavigation?.();
        });
        await setLayout(page, 'modern');

        const row = await page.evaluate(() => {
            const kids = [...document.querySelector('.header-actions').children]
                .filter((el) => el.offsetParent !== null)
                .map((el) => {
                    const r = el.getBoundingClientRect();
                    return {
                        cls: el.className.split(' ')[0],
                        top: Math.round(r.top),
                        height: Math.round(r.height),
                        left: Math.round(r.left),
                        right: Math.round(r.right),
                    };
                });
            const gaps = kids.slice(1).map((k, i) => k.left - kids[i].right);
            return { kids, gaps };
        });

        expect(row.kids.length).toBeGreaterThanOrEqual(3);

        // Every control gets a filled pill in modern, so any negative gap shows
        // as two backgrounds overlapping. Classic pulls the health and config
        // icons back by 1rem to tighten bare glyphs, which modern must undo.
        for (const gap of row.gaps) {
            expect(gap).toBeGreaterThanOrEqual(0);
        }

        // The tab strip is a padded container and its neighbours are single
        // controls, so they only line up if the row centres them.
        const tops = row.kids.map((k) => k.top);
        expect(Math.max(...tops) - Math.min(...tops)).toBeLessThanOrEqual(2);

        const heights = row.kids.map((k) => k.height);
        expect(Math.max(...heights) - Math.min(...heights)).toBeLessThanOrEqual(2);
    });

    test('gives the header links a pill surface', async ({ page }) => {
        await loadDashboard(page);
        const { classic, modern } = await bothLayouts(
            page,
            '.config-link a',
            ['borderRadius', 'borderTopWidth'],
        );

        expect(modern.borderRadius).not.toBe(classic.borderRadius);
        // Classic draws no border on these; modern gives them a surface edge.
        expect(classic.borderTopWidth).toBe('0px');
        expect(modern.borderTopWidth).not.toBe('0px');
    });

    test('rounds bookmark rows', async ({ page }) => {
        await loadDashboard(page);
        await expect(page.locator('.bookmark-link').first()).toBeVisible();

        const { classic, modern } = await bothLayouts(page, '.bookmark-link', ['borderRadius']);
        expect(modern.borderRadius).not.toBe(classic.borderRadius);
    });

    test('publishes the row and category radii on the grid', async ({ page }) => {
        await loadDashboard(page);

        // The presets read these two custom properties rather than each
        // hardcoding a radius, so they are the contract the eight layout
        // presets share. Classic does not define them at all.
        const read = () => page.evaluate(() => {
            const el = document.querySelector('.dashboard-grid');
            if (!el) throw new Error('missing .dashboard-grid');
            const s = getComputedStyle(el);
            return {
                row: s.getPropertyValue('--modern-row-radius').trim(),
                category: s.getPropertyValue('--modern-category-radius').trim(),
            };
        });

        await setLayout(page, 'classic');
        expect(await read()).toEqual({ row: '', category: '' });

        await setLayout(page, 'modern');
        const modern = await read();
        expect(modern.row).not.toBe('');
        expect(modern.category).not.toBe('');
    });

    test('leaves classic unchanged when the layout attribute is absent', async ({ page }) => {
        await loadDashboard(page);

        await setLayout(page, 'classic');
        const asClassic = await computed(page, '.page-navigation', ['borderRadius', 'padding', 'backgroundColor']);

        await page.evaluate(() => {
            document.documentElement.removeAttribute('data-layout-version');
            document.body.removeAttribute('data-layout-version');
        });
        const noAttribute = await computed(page, '.page-navigation', ['borderRadius', 'padding', 'backgroundColor']);

        expect(noAttribute).toEqual(asClassic);
    });
});

test.describe('modern layout — grid presets', () => {
    /**
     * The eight presets each get their own block of modern rules, and none of
     * them had any coverage. Rather than pin per-preset styling — which would
     * restate the CSS — assert the two things that actually broke elsewhere in
     * this layer: content overflowing the viewport sideways, and rows in a
     * column overlapping each other.
     */
    const PRESETS = ['default', 'compact', 'cards', 'terminal', 'masonry', 'list', 'widgets', 'launcher'];

    for (const preset of PRESETS) {
        test(`${preset} lays out without overflow or overlap`, async ({ page }) => {
            await loadDashboard(page);
            await setLayout(page, 'modern');
            await page.evaluate((v) => {
                window.dashboardInstance.settings.layoutPreset = v;
                document.body.setAttribute('data-layout-preset', v);
                window.dashboardInstance.renderDashboard({ animate: false });
            }, preset);
            await expect(page.locator('.bookmark-link').first()).toBeVisible();

            const geo = await page.evaluate(() => {
                const overflow = document.documentElement.scrollWidth - document.documentElement.clientWidth;
                const overlaps = [...document.querySelectorAll('.bookmarks-list')].slice(0, 3).flatMap((list) => {
                    const rects = [...list.querySelectorAll(':scope > .bookmark-link')]
                        .slice(0, 6)
                        .map((el) => el.getBoundingClientRect());
                    const bad = [];
                    for (let i = 1; i < rects.length; i += 1) {
                        // Same column (launcher and widgets tile sideways, so only
                        // compare rows that actually stack) => must not overlap.
                        const sameColumn = Math.abs(rects[i].left - rects[i - 1].left) < 2;
                        if (sameColumn && rects[i].top < rects[i - 1].bottom - 1) {
                            bad.push(Math.round(rects[i - 1].bottom - rects[i].top));
                        }
                    }
                    return bad;
                });
                return { overflow, overlaps };
            });

            expect(geo.overflow).toBeLessThanOrEqual(0);
            expect(geo.overlaps).toEqual([]);
        });
    }
});

test.describe('modern layout — overlays', () => {
    test('restyles the search overlay', async ({ page }) => {
        await loadDashboard(page);
        await openShortcutSearch(page);
        await expect(page.locator('#shortcut-search.show')).toBeVisible();

        const { classic, modern } = await bothLayouts(
            page,
            '.search-container',
            ['borderRadius', 'boxShadow'],
        );

        expect(modern.borderRadius).not.toBe(classic.borderRadius);
        expect(modern.boxShadow).not.toBe(classic.boxShadow);
    });

    test('restyles modals', async ({ page }) => {
        await loadDashboard(page);
        await page.evaluate(() => window.dashboardInstance.showKeyboardCheatSheet?.());
        await expect(page.locator('#app-modal .modal')).toBeVisible();

        const { classic, modern } = await bothLayouts(
            page,
            '#app-modal .modal',
            ['borderRadius', 'boxShadow'],
        );

        expect(modern.borderRadius).not.toBe(classic.borderRadius);
        expect(modern.boxShadow).not.toBe(classic.boxShadow);
    });
});
