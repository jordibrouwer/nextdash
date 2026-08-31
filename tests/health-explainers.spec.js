// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * In-view explanation: a sentence about the active filter, and the ℹ that opens
 * the longer "how this works".
 *
 * The filter pills are one or two words and several of them sound alike, so the
 * rule behind each one was only reachable as a tooltip on the matching tile —
 * invisible on touch, and to anyone who did not think to hover.
 */

function issue(overrides = {}) {
    return {
        pageId: 1, index: 0, pageName: 'dev', category: 'tools',
        url: 'https://example.com/a', name: 'A bookmark',
        status: 'healthy', flags: ['healthy'], score: 100, duplicateCount: 0,
        lastChecked: Date.now(), reasons: [], reasonDetails: [],
        ...overrides,
    };
}

function report() {
    return {
        generatedAt: Date.now(),
        summary: {
            totalBookmarks: 3, healthyCount: 1, brokenCount: 1, duplicateCount: 0,
            uncheckedCount: 0, staleCount: 0, unusedCount: 1,
        },
        issues: [
            issue({ index: 0, name: 'Healthy one' }),
            issue({
                index: 1, name: 'Broken one', url: 'https://example.com/broken',
                status: 'broken', flags: ['broken'], score: 30,
                reasons: ['HTTP 500'], reasonDetails: [{ code: 'last_error', detail: 'HTTP 500', penalty: 60 }],
            }),
            issue({
                index: 2, name: 'Unused one', url: 'https://example.com/unused',
                status: 'unused', flags: ['unused'], score: 85, openCount: 0, lastOpened: 0,
                reasons: ['Never opened'], reasonDetails: [{ code: 'never_opened', penalty: 10 }],
            }),
        ],
        duplicateGroups: [],
    };
}

async function open(page, filter = 'broken') {
    await page.route('**/api/bookmark-health**', async (route) => {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(report()) });
    });
    await markWhatsNewSeen(page);
    await page.goto(`/?hv_filter=${filter}#health`);
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    // Not prepareDashboardInteraction: it calls ensureBookmarksDashboardView,
    // which is exactly what this deep link is not. It put the grid back over
    // the view this spec had just opened, and every assertion below then read
    // a health view that could no longer redraw.
    await page.waitForSelector('#dashboard-layout.health-layout', { timeout: 15_000 });
    await page.waitForFunction(
        () => window.dashboardInstance?.activeView === 'health', null, { timeout: 15_000 });
}

test.describe('health view explanations', () => {
    test('the note under the toolbar describes the active filter', async ({ page }) => {
        await open(page, 'broken');

        const note = page.locator('.health-view-filter-note');
        await expect(note).toBeVisible();
        await expect(note).toContainText(/did not respond/i);
    });

    test('the note changes with the filter', async ({ page }) => {
        await open(page, 'broken');
        const note = page.locator('.health-view-filter-note');
        const broken = await note.textContent();

        // Unused, not All: All has no note by design. filterExplanation returns
        // '' for it, with the reason written out — "Every bookmark, whatever its
        // state" names what an unfiltered list is to someone already looking at
        // one, and cost a line above every row to say it.
        await page.locator('[data-health-filter="unused"]').click();
        await expect(note).not.toHaveText(String(broken));
        await expect(note).toContainText(/never been opened|nooit geopend/i);

        // And All drops the row rather than rendering it empty.
        await page.locator('[data-health-filter="all"]').click();
        await expect(note).toHaveCount(0);
    });

    test('the two filters that sound alike are told apart', async ({ page }) => {
        // "Stale" and "Unused" are the pair people confuse; each note has to name
        // its own rule rather than restating the label.
        await open(page, 'unused');
        await expect(page.locator('.health-view-filter-note')).toContainText(/never been opened/i);

        await open(page, 'stale');
        await expect(page.locator('.health-view-filter-note')).toContainText(/30 days/i);
    });

    test('a filter with no rows still explains itself', async ({ page }) => {
        // The empty state says "nothing to fix"; without the note there would be
        // nothing saying what was looked for.
        await open(page, 'duplicate');

        await expect(page.locator('.health-view-item')).toHaveCount(0);
        await expect(page.locator('.health-view-filter-note')).toContainText(/same address/i);
    });

    test('the info button opens the explainer and closes again', async ({ page }) => {
        await open(page);

        await page.locator('[data-health-help]').click();
        const modal = page.locator('#app-modal');
        await expect(modal).toBeVisible();
        await expect(modal).toContainText(/How the health view works/i);

        // The six things the numbers need explaining for.
        await expect(modal.locator('.health-explain-row')).toHaveCount(6);
        await expect(modal).toContainText(/starts at 100/i);
        await expect(modal).toContainText(/several things at once/i);
        await expect(modal).toContainText(/no data/i);
        await expect(modal).toContainText(/three thousand/i);
        await expect(modal).toContainText(/90 days/i);

        // Informational only: one button to dismiss it, with no Cancel beside it
        // that would imply the explanation could be declined.
        await expect(modal.locator('.modal-button')).toHaveCount(1);
        await expect(modal.locator('.modal-button')).toContainText(/got it/i);

        await page.keyboard.press('Escape');
        await expect(modal).not.toBeVisible();
        // Escape closed the modal, not the view behind it.
        await expect(page.locator('#dashboard-layout.health-layout')).toBeVisible();
    });

    test('the explainer fits on screen with room above and below', async ({ page }) => {
        // It grew to whatever its six sections needed — 786px in an 800px window,
        // touching the bottom edge. The cap has to hold at short heights too,
        // which is where a vh-only rule would still leave almost no margin.
        for (const height of [600, 800]) {
            await page.setViewportSize({ width: 1280, height });
            await open(page);
            await page.locator('[data-health-help]').click();
            await page.waitForSelector('#app-modal .health-explain');

            const box = await page.evaluate(() => {
                const el = document.querySelector('#app-modal .modal');
                const r = el.getBoundingClientRect();
                return { top: r.top, bottom: window.innerHeight - r.bottom, height: r.height };
            });

            expect(box.height, `fits in a ${height}px window`).toBeLessThan(height);
            expect(box.top, `gap above at ${height}px`).toBeGreaterThan(24);
            expect(box.bottom, `gap below at ${height}px`).toBeGreaterThan(24);
        }
    });

    test('a long explainer scrolls its body rather than the page', async ({ page }) => {
        // The cap is only safe if the content it hides is still reachable.
        await page.setViewportSize({ width: 1280, height: 420 });
        await open(page);
        await page.locator('[data-health-help]').click();
        await page.waitForSelector('#app-modal .health-explain');

        const scroll = await page.evaluate(() => {
            const body = document.querySelector('#app-modal .modal-body');
            const panel = document.querySelector('#app-modal .modal');
            return {
                scrollable: body.scrollHeight > body.clientHeight,
                overflowY: getComputedStyle(body).overflowY,
                // The panel clips rather than scrolling: if it grew instead, the
                // cap would be doing nothing and the modal would overflow again.
                panelClips: getComputedStyle(panel).overflow === 'hidden',
                panelWithinViewport: panel.getBoundingClientRect().height < window.innerHeight,
            };
        });
        expect(scroll.scrollable, 'the hidden content is still reachable').toBe(true);
        expect(scroll.overflowY).toBe('auto');
        expect(scroll.panelClips).toBe(true);
        expect(scroll.panelWithinViewport).toBe(true);
    });

    test('the explainer renders prose in another language', async ({ page }) => {
        await open(page);
        await page.evaluate(async () => {
            await window.dashboardInstance.language.loadTranslations('nl');
            const h = window.dashboardInstance.healthView || window.dashboardInstance.health;
            h.render();
        });

        await expect(page.locator('.health-view-filter-note')).toContainText(/reageerden niet/i);

        await page.locator('[data-health-help]').click();
        const modal = page.locator('#app-modal');
        await expect(modal).toContainText(/gezondheidsoverzicht/i);
        await expect(modal).not.toContainText('dashboard.healthExplain');
    });
});
