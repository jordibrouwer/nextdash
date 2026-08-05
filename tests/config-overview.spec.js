// @ts-check
const { test, expect } = require('@playwright/test');
const { dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

async function dismissConfigSettingPromoIfPresent(page) {
    const promo = page.locator('.config-setting-promo');
    if (await promo.count()) {
        await promo.locator('.config-setting-promo-dismiss').click();
        await expect(promo).toHaveCount(0, { timeout: 3000 });
    }
}

async function waitForOverviewHealth(page, health) {
    await page.evaluate((healthPayload) => {
        const d = window.dashboardInstance;
        if (d?.health) {
            d.health.report = healthPayload;
        }
        if (d?.config?.isActiveView?.() && d.config.section === 'overview') {
            d.config.repaintOverview();
        }
    }, health);
    const expectedBroken = Number(health.summary.brokenCount) || 0;
    const expectedMonitored = Number(health.summary.monitoredCount) || 0;
    if (expectedMonitored > 0) {
        // Monitored moved from a status tile into the At a glance list.
        await expect(page.locator('.config-mini-list')).toContainText(/Monitored/, { timeout: 5000 });
    }
    if (expectedBroken > 0) {
        await expect(page.locator('.config-attention-row').first()).toBeVisible({ timeout: 5000 });
    }
}
const PROBLEMS = {
    summary: {
        totalBookmarks: 7, healthyCount: 3, brokenCount: 2, monitorDownCount: 1,
        monitoredCount: 2, duplicateCount: 1, uncheckedCount: 1, staleCount: 2, shortcutConflictCount: 0,
    },
    issues: [], duplicateGroups: [],
};
const CLEAN = {
    summary: {
        totalBookmarks: 7, healthyCount: 7, brokenCount: 0, monitorDownCount: 0,
        monitoredCount: 0, duplicateCount: 0, uncheckedCount: 0, staleCount: 0, shortcutConflictCount: 0,
    },
    issues: [], duplicateGroups: [],
};

async function openOverview(page, health = PROBLEMS) {
    await page.route('**/api/bookmark-health**', (route) => route.fulfill({
        status: 200, contentType: 'application/json', body: JSON.stringify(health),
    }));
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.allBookmarks?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.evaluate(() => {
        ['random-theme-v2', 'find-settings-v1', 'bookmarks-page-filter-v1'].forEach((id) => {
            window.DiscoverabilityState?.markSettingPromoSeen?.(id, { persist: false });
        });
    });
    await page.evaluate(() => window.dashboardInstance.config.openConfigView('overview'));
    await expect(page.locator('.config-overview-layout')).toBeVisible();
    await waitForOverviewHealth(page, health);
    await dismissConfigSettingPromoIfPresent(page);
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
    /**
     * The status tile row is gone: all six counts were already on the page, in
     * At a glance or as a Needs attention row. What has to survive is that the
     * numbers themselves are still reachable — monitored included.
     */
    test('the counts the tile row carried are still on the page', async ({ page }) => {
        await openOverview(page);
        await expect(page.locator('.config-tiles--overview')).toHaveCount(0);

        const glance = page.locator('.config-mini-list');
        await expect(glance).toContainText('Monitored');
        await expect(glance).toContainText('Bookmarks');
        await expect(glance).toContainText('Pages');

        // Broken links and duplicates are actionable, so they live in the
        // attention panel rather than as a decorative zero.
        const attention = page.locator('.config-attention-list');
        await expect(attention).toContainText('Broken links');
        await expect(attention).toContainText('Duplicate bookmarks');
    });


    test('new features carousel shows translated copy, not locale keys', async ({ page }) => {
        await openOverview(page);
        const spotlight = page.locator('.config-feature-spotlight');
        await expect(spotlight).toBeVisible();
        const text = await spotlight.innerText();
        expect(text).not.toMatch(/config\.overviewNewFeature/);
        await expect(spotlight.locator('.config-feature-spotlight-title')).not.toHaveText(/config\./);
    });

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
        expect(await page.evaluate(() => window.dashboardInstance.health.instance?.filter
            ?? window.dashboardInstance.health.filter)).toBe('broken');
    });

    // The Ko-fi button reuses the what's-new modal's markup and CSS, so the two
    // are identical by construction. These assert that it actually arrives that
    // way: a missing class would silently drop the animation and the stars.
    test('the about panel links to GitHub and Ko-fi', async ({ page }) => {
        await loadOverview(page);

        const panel = page.locator('.config-about-panel');
        await expect(panel).toBeVisible();

        const github = panel.locator('.config-about-github');
        await expect(github).toHaveAttribute('href', 'https://github.com/jordibrouwer/nextdash');
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

    // Developer and latest update share one row at half width each; tips sit
    // full width underneath.
    test('the overview places developer beside latest update with tips below', async ({ page }) => {
        await loadOverview(page);

        const inAboutRow = await page.evaluate(() =>
            !!document.querySelector('.config-overview-about-row .config-about-panel'));
        expect(inAboutRow).toBe(true);

        const box = await page.evaluate(() => {
            const find = (text) => [...document.querySelectorAll('.config-overview-layout .config-panel')]
                .find((el) => el.textContent.includes(text));
            const measure = (el) => {
                if (!el) return null;
                const r = el.getBoundingClientRect();
                return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width) };
            };
            const rect = (text) => measure(find(text));
            return {
                about: rect('About the developer'),
                latest: rect('Latest update'),
                tips: rect('Tips'),
                glance: rect('At a glance'),
            };
        });

        for (const [name, r] of Object.entries(box)) {
            expect(r, `${name} should be on the overview`).not.toBeNull();
        }
        // Developer and latest update side by side at roughly half width each.
        expect(Math.abs(box.about.y - box.latest.y)).toBeLessThan(20);
        expect(box.latest.x).toBeGreaterThan(box.about.x);
        expect(box.about.w).toBeGreaterThan(200);
        expect(Math.abs(box.about.w - box.latest.w)).toBeLessThan(40);
        // Tips sits below that row, not beside it.
        expect(box.tips.y).toBeGreaterThan(box.about.y + 40);
        expect(box.tips.y).toBeGreaterThan(box.latest.y + 40);
        // At a glance stays in the top row above developer.
        expect(box.glance.y).toBeLessThan(box.about.y - 20);
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
