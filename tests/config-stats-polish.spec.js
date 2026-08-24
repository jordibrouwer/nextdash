// @ts-check
const { test, expect } = require('./fixtures');
const { dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * The smaller ways Statistics misrepresented itself.
 *
 * With no bookmarks every panel still rendered, so a fresh install met a page
 * of "0 / 0 · 0%" bars and a cleanup score of 0/100 — which reads as broken
 * rather than as empty. The concentration panel went further and vanished
 * outright, leaving a gap between two panels. The figures are recomputed at
 * render time but nothing said when. And each tile's label and value were
 * separate spans, so they were announced as two loose strings.
 */

async function loadDashboard(page) {
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.allBookmarks?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
}

async function openStats(page) {
    await page.evaluate(() => window.dashboardInstance.config.openConfigView('stats'));
    await page.waitForFunction(() => typeof window.DashboardConfig === 'function', null, { timeout: 10_000 });
}

/** Empties the collection and repaints, as a fresh install would render. */
async function emptyCollection(page, tab = 'overview') {
    await page.evaluate((t) => {
        const d = window.dashboardInstance;
        d.allBookmarks = [];
        d.config.statsTab = t;
        d.config.repaintStatsBody();
    }, tab);
}

test.describe('statistics: an empty dashboard explains itself', () => {
    test('the zero-bookmark state replaces the panels', async ({ page }) => {
        await loadDashboard(page);
        await openStats(page);
        await emptyCollection(page);

        await expect(page.locator('.config-panel--empty-state')).toBeVisible();
        // The wall of zeroes is what this replaces.
        await expect(page.locator('.config-ratio')).toHaveCount(0);
        await expect(page.locator('#config-stats-body')).not.toContainText('0 / 0');
    });

    test('it holds on every tab that measures the collection', async ({ page }) => {
        await loadDashboard(page);
        await openStats(page);
        for (const tab of ['overview', 'activity', 'content', 'health']) {
            await emptyCollection(page, tab);
            await expect(page.locator('.config-panel--empty-state'), `tab ${tab}`).toBeVisible();
        }
    });

    test('Inbox keeps its own panels, which are server-side', async ({ page }) => {
        await loadDashboard(page);
        await openStats(page);
        await emptyCollection(page, 'inbox');
        // Its numbers do not come from allBookmarks, so they still mean something.
        await expect(page.locator('.config-panel--empty-state')).toHaveCount(0);
    });

    test('the empty state offers a way out', async ({ page }) => {
        await loadDashboard(page);
        await openStats(page);
        await emptyCollection(page);

        await page.locator('[data-stats-action="add-bookmark"]').click();
        // The button must actually open the form, not just look like an action.
        // (#app-modal is a permanent, normally-hidden host — not this dialog.)
        await expect(page.locator('.bookmark-form-modal-dialog')).toBeVisible();
    });

    test('the panels return once a bookmark exists', async ({ page }) => {
        await loadDashboard(page);
        await openStats(page);
        await emptyCollection(page, 'content');
        await expect(page.locator('.config-panel--empty-state')).toBeVisible();

        await page.evaluate(() => {
            const d = window.dashboardInstance;
            d.allBookmarks = [{
                name: 'One', url: 'https://one.example.com/', pageId: d.pages[0].id,
                category: '', tags: [], openCount: 0, lastOpened: 0,
            }];
            d.config.repaintStatsBody();
        });
        await expect(page.locator('.config-panel--empty-state')).toHaveCount(0);
        await expect(page.locator('.config-ratio').first()).toBeVisible();
    });
});

test.describe('statistics: no panel disappears without saying why', () => {
    test('the concentration panel stays put with nothing opened', async ({ page }) => {
        await loadDashboard(page);
        await openStats(page);
        // One bookmark, never opened: the panel used to return '' here, leaving
        // a gap between its neighbours.
        await page.evaluate(() => {
            const d = window.dashboardInstance;
            d.allBookmarks = [{
                name: 'Unused', url: 'https://unused.example.com/', pageId: d.pages[0].id,
                category: 'c', tags: [], openCount: 0, lastOpened: 0,
            }];
            d.config.statsTab = 'content';
            d.config.repaintStatsBody();
        });

        const panel = page.locator('.config-panel')
            .filter({ has: page.locator('.config-panel-title', { hasText: 'Where your usage sits' }) });
        await expect(panel).toHaveCount(1);
        await expect(panel.locator('.config-panel-empty')).toBeVisible();
    });
});

test.describe('statistics: the figures are dated', () => {
    test('the page says when it was worked out', async ({ page }) => {
        await loadDashboard(page);
        await openStats(page);
        const stamp = page.locator('.config-stats-updated');
        await expect(stamp).toBeVisible();
        await expect(stamp).toHaveText(/\d/);
    });

    test('it refreshes with the numbers it dates', async ({ page }) => {
        await loadDashboard(page);
        await openStats(page);
        // The stamp sits outside #config-stats-body, so a repaint that skipped
        // it would leave it claiming the time of the first render.
        const before = await page.evaluate(() => {
            const el = document.querySelector('.config-stats-updated');
            el.dataset.probe = 'first-render';
            return el.dataset.probe;
        });
        expect(before).toBe('first-render');

        await page.locator('[data-stats-tab="content"]').click();
        const marker = await page.evaluate(() =>
            document.querySelector('.config-stats-updated')?.dataset.probe ?? null);
        expect(marker).toBeNull();
        await expect(page.locator('.config-stats-updated')).toBeVisible();
    });
});

test.describe('statistics: tiles read as one thing', () => {
    test('each tile carries a single accessible name', async ({ page }) => {
        await loadDashboard(page);
        await openStats(page);

        const tiles = page.locator('.config-tiles--overview .config-tile');
        expect(await tiles.count()).toBeGreaterThan(0);
        const label = await tiles.first().getAttribute('aria-label');
        // "Bookmarks: 102" — the pair, not two adjacent strings.
        expect(label).toMatch(/.+:\s*\d+/);
    });

    test('the visible spans are not announced twice', async ({ page }) => {
        await loadDashboard(page);
        await openStats(page);
        const tile = page.locator('.config-tiles--overview .config-tile').first();
        await expect(tile.locator('.config-tile-label')).toHaveAttribute('aria-hidden', 'true');
        await expect(tile.locator('.config-tile-value')).toHaveAttribute('aria-hidden', 'true');
    });
});
