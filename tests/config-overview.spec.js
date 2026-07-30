// @ts-check
const { test, expect } = require('@playwright/test');
const { dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

const PROBLEMS = {
    summary: {
        totalBookmarks: 7, healthyCount: 3, brokenCount: 2, monitorDownCount: 1,
        duplicateCount: 1, uncheckedCount: 1, staleCount: 2, shortcutConflictCount: 0,
    },
    issues: [], duplicateGroups: [],
};
const CLEAN = {
    summary: {
        totalBookmarks: 7, healthyCount: 7, brokenCount: 0, monitorDownCount: 0,
        duplicateCount: 0, uncheckedCount: 0, staleCount: 0, shortcutConflictCount: 0,
    },
    issues: [], duplicateGroups: [],
};

async function openOverview(page, health = PROBLEMS) {
    await page.route('**/api/bookmark-health', (route) => route.fulfill({
        status: 200, contentType: 'application/json', body: JSON.stringify(health),
    }));
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.allBookmarks?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.evaluate(() => window.dashboardInstance.config.openConfigView('overview'));
    await expect(page.locator('.config-tiles')).toBeVisible();
}

async function loadOverview(page) {
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.evaluate(() => window.dashboardInstance.config.openConfigView('overview'));
    await page.waitForTimeout(1200);
}

test.describe('config overview', () => {
    test('problems are listed with a way to act on each', async ({ page }) => {
        await openOverview(page);
        const rows = page.locator('.config-attention-row');
        // broken, monitors down, duplicates, unchecked — inbox is empty here.
        await expect(rows).toHaveCount(4);
        await expect(rows.first()).toContainText('2');
        // Every row offers somewhere to go.
        for (let i = 0; i < 4; i += 1) {
            await expect(rows.nth(i).locator('[data-overview-go]')).toBeVisible();
        }
    });

    test('a clean install says so instead of listing zeroes', async ({ page }) => {
        await openOverview(page, CLEAN);
        await expect(page.locator('.config-attention-row')).toHaveCount(0);
        await expect(page.locator('.config-attention-clear')).toBeVisible();
    });

    test('at-a-glance shows the score and the headline counts', async ({ page }) => {
        await openOverview(page);
        const panel = page.locator('.config-panel').filter({
            has: page.locator('.config-panel-title', { hasText: /glance/i }),
        });
        await expect(panel.locator('.config-score-value')).toBeVisible();
        expect(await panel.locator('.config-mini-row').count()).toBeGreaterThanOrEqual(6);
    });

    test('the statistics link opens that section', async ({ page }) => {
        await openOverview(page);
        await page.locator('[data-overview-go=\'{"section":"stats"}\']').click();
        await expect.poll(() => page.evaluate(() =>
            window.dashboardInstance.config.section)).toBe('stats');
    });

    test('the latest release is summarised with a link to the notes', async ({ page }) => {
        await openOverview(page);
        const tag = page.locator('.config-release-tag');
        await expect(tag).toBeVisible();
        await expect(tag).toContainText(/^v\d/);
        // The summary is plain text, not the authored HTML.
        const panel = page.locator('.config-panel').filter({ has: tag });
        await expect(panel.locator('.config-panel-note')).not.toContainText('<strong>');
        await expect(page.locator('[data-overview-action="whats-new"]')).toBeVisible();
    });


    /**
     * The loader only logged failures to the console, so a stub that had not
     * registered left the button looking dead. It now falls back to the ★ button
     * and, failing that, says so.
     */
    test('the whats-new button actually opens the modal', async ({ page }) => {
        await openOverview(page);
        await page.locator('[data-overview-action="whats-new"]').click();
        await expect(page.locator('.whats-new-modal')).toBeVisible();
    });

    test('tips are shown with a link to the full list', async ({ page }) => {
        await openOverview(page);
        const tips = page.locator('.config-help-tips .config-help-tip');
        await expect(tips).toHaveCount(3);
        await expect(tips.first().locator('kbd')).toBeVisible();
        await page.locator('[data-overview-go=\'{"section":"help"}\']').click();
        await expect.poll(() => page.evaluate(() =>
            window.dashboardInstance.config.section)).toBe('help');
    });

    test('a problem row hands off to the health view with its filter', async ({ page }) => {
        await openOverview(page);
        await page.locator('.config-attention-row').first().locator('[data-overview-go]').click();
        await expect.poll(() => page.evaluate(() =>
            window.dashboardInstance.activeView)).toBe('health');
        expect(await page.evaluate(() => window.dashboardInstance.health.filter)).toBe('broken');
    });

    // The Ko-fi button reuses the what's-new modal's markup and CSS, so the two
    // are identical by construction. These assert that it actually arrives that
    // way: a missing class would silently drop the animation and the stars.
    test('the about panel links to GitHub and Ko-fi', async ({ page }) => {
        await loadOverview(page);

        const panel = page.locator('.config-about-panel');
        await expect(panel).toBeVisible();

        const github = panel.locator('.config-about-github');
        await expect(github).toHaveAttribute('href', 'https://github.com/jordibrouwer');
        await expect(github).toHaveAttribute('rel', /noopener/);

        const kofi = panel.locator('.wn-kofi-btn');
        await expect(kofi).toHaveAttribute('href', 'https://ko-fi.com/jordibrw');
        await expect(kofi).toHaveAttribute('rel', /noopener/);
    });

    test('the Ko-fi button keeps the animated treatment from the modal', async ({ page }) => {
        await loadOverview(page);

        const kofi = page.locator('.config-about-panel .wn-kofi-btn');
        await expect(kofi).toHaveClass(/wn-kofi-btn--animated/);
        // Four twinkling stars, as in the modal.
        await expect(page.locator('.config-about-panel .wn-kofi-star')).toHaveCount(4);

        const glow = await kofi.evaluate((el) => getComputedStyle(el).animationName);
        expect(glow).not.toBe('none');
    });

    // Every panel shares the overview's two-column grid. As a full-width block
    // between "needs attention" and that grid, the about panel pushed everything
    // below it down the page and the overview stopped reading as a summary.
    test('the overview panels form a two-by-two grid', async ({ page }) => {
        await loadOverview(page);

        const inColumns = await page.evaluate(() =>
            !!document.querySelector('.config-overview-columns .config-about-panel'));
        expect(inColumns).toBe(true);

        // The four panels form a 2x2 grid: about + stats on the first row,
        // release notes + tips on the second.
        const box = await page.evaluate(() => {
            const find = (text) => [...document.querySelectorAll('.config-overview-columns .config-panel')]
                .find((el) => el.textContent.includes(text));
            const rect = (text) => {
                const el = find(text);
                if (!el) return null;
                const r = el.getBoundingClientRect();
                return { x: Math.round(r.x), y: Math.round(r.y) };
            };
            return {
                about: rect('About the developer'),
                glance: rect('At a glance'),
                latest: rect('Latest update'),
                tips: rect('Tips'),
            };
        });

        // Every panel is inside the grid.
        for (const [name, r] of Object.entries(box)) {
            expect(r, `${name} should sit in the overview grid`).not.toBeNull();
        }
        // Side by side, not stacked.
        expect(Math.abs(box.about.y - box.glance.y)).toBeLessThan(20);
        expect(box.glance.x).toBeGreaterThan(box.about.x);
        // Tips sits beside the release notes rather than below everything.
        expect(Math.abs(box.latest.y - box.tips.y)).toBeLessThan(20);
        expect(box.tips.x).toBeGreaterThan(box.latest.x);
    });

    test('the about buttons stay on one line beside each other', async ({ page }) => {
        await loadOverview(page);

        const row = await page.evaluate(() => {
            const el = document.querySelector('.config-about-actions');
            const [gh, kofi] = el.children;
            const g = gh.getBoundingClientRect();
            const k = kofi.getBoundingClientRect();
            return {
                sameLine: Math.abs(g.y - k.y) < 3,
                withinPanel: k.right <= el.getBoundingClientRect().right + 1,
            };
        });
        expect(row.sameLine).toBe(true);
        expect(row.withinPanel).toBe(true);
    });

    // Opening #config directly renders config before the bookmark grid has ever
    // run, so the container carries neither packed-columns nor columns-N — and
    // .dashboard-grid:not(.packed-columns) sets width: fit-content with an auto
    // margin. That collapsed the shell to its content width on a reload or a
    // deep link: three tiles instead of five, one column instead of two, and the
    // whole view shifted right. Same page, different layout depending on how you
    // arrived.
    test('the layout is the same whether config is opened or loaded directly', async ({ page }) => {
        const shellWidth = () => page.evaluate(() => {
            const el = document.querySelector('.config-view');
            return el ? Math.round(el.getBoundingClientRect().width) : null;
        });

        // The direct load goes FIRST and in a fresh context: it is the case that
        // broke, and navigating to the dashboard first would leave the grid
        // classes behind that used to hide the bug.
        await page.goto('/#config');
        await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
        await dismissBlockingOverlays(page);
        await page.waitForTimeout(1500);
        const direct = await shellWidth();

        await loadOverview(page);
        const navigated = await shellWidth();

        expect(direct).toBe(navigated);
        // And it is the full shell, not a content-sized box.
        expect(direct).toBeGreaterThan(900);
    });
});
