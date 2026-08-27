// @ts-check
const { test, expect } = require('./fixtures');
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

    /**
     * Only what needs the reader is framed. Five panels with identical borders
     * left the eye nowhere to land and made the update bar compete with its
     * neighbours, so everything below the act zone is unframed.
     */
    test('only the act zone is framed', async ({ page }) => {
        await openOverview(page);
        const framed = await page.evaluate(() => {
            const panel = document.getElementById('config-section-panel');
            return [...panel.querySelectorAll('.config-panel')]
                .filter((el) => !el.classList.contains('config-panel--plain'))
                .map((el) => el.querySelector('.config-panel-title')?.textContent?.trim() || el.className);
        });
        expect(framed).toEqual(['Needs attention']);
        // The update bar sits above it and keeps its own frame.
        await expect(page.locator('.config-overview-act > .config-update-bar')).toHaveCount(1);
    });

    test('the stream shows translated copy, not locale keys', async ({ page }) => {
        await openOverview(page);
        const stream = page.locator('.config-news-stream');
        await expect(stream).toBeVisible({ timeout: 15_000 });
        // A feature's words live in the locale files; a post's come from the
        // feed. Neither may render as a key.
        await expect(stream).not.toContainText('config.overviewNewFeature');
        await expect(stream).not.toContainText('config.overviewNews');
        // Every row says where it came from.
        const sources = await page.locator('.config-src-chip').evaluateAll((els) =>
            [...new Set(els.map((el) => el.textContent.trim().toLowerCase()))]);
        expect(sources.length).toBeGreaterThan(0);
        expect(sources.every((s) => s.length > 0)).toBe(true);
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
        // A quiet line, not a framed panel: reporting the absence of problems
        // used to be the largest block on a healthy install's Overview.
        await expect(page.locator('.config-panel--attention')).toHaveCount(0);
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
        // Scoped to the At a glance panel: a spotlight entry in the news stream
        // may point at the same section, and two buttons carrying one target is
        // the stream working rather than a duplicate to disambiguate by index.
        const panel = page.locator('.config-panel').filter({
            has: page.locator('.config-panel-title', { hasText: /glance/i }),
        });
        await panel.locator('[data-overview-go=\'{"section":"stats"}\']').click();
        await expect.poll(() => page.evaluate(() =>
            window.dashboardInstance.config.section)).toBe('stats');
    });

    test('the posts from the site lead the read row', async ({ page }) => {
        await openOverview(page);
        // The Latest update panel used to sit here and said what the update bar
        // above it already said, with the notes a button away in What's new.
        // The site's posts are what it could not say.
        await expect(page.locator('.config-news-panel')).toBeVisible();
        await expect(page.locator('.config-overview-layout')).not.toContainText('Latest update');
    });

    /**
     * The loader only logged failures to the console, so a stub that had not
     * registered left the button looking dead. It now falls back to the ★ button
     * and, failing that, says so.
     */
    test('the whats-new button actually opens the modal', async ({ page }) => {
        await openOverview(page);
        // It moved into the update bar with the release number it belongs to,
        // when the panel that used to carry it was removed.
        // It sits in the update bar beside the version it belongs to, and on
        // every release row in the stream — so the first one is the bar's.
        await page.locator('[data-overview-action="whats-new"]').first().click();
        await expect(page.locator('.whats-new-modal')).toBeVisible();
    });

    test('tips are shown with a link to the full list', async ({ page }) => {
        await openOverview(page);
        // A footer row rather than a panel — three keyboard hints did not need
        // a heading and a frame of their own.
        const tips = page.locator('.config-overview-tips-row .config-help-tip');
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

        // GitHub is one of the four addresses in the list now, not a button of
        // its own: the side column is too narrow for a row of two.
        const github = panel.locator('.config-about-links a[href*="github.com"]');
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

    // The stream takes the wide column directly under the act zone; the side
    // column carries the figures about your own install. That order is the
    // whole point of the rebuild: what the project is doing sits above the
    // fold, and what your library contains is beside it, not on top.
    //
    // Within that column: About, then the "Your install" line, then the figures
    // and the settings that differ from stock. About belongs to the zone the
    // page opens with — what the project is — so it sits level with the stream,
    // and the line under it heads exactly the two blocks that describe your own
    // install. At the foot it was the last thing on a column nobody scrolls to
    // the end of.
    test('the stream leads, with About and the figures beside it', async ({ page }) => {
        await loadOverview(page);

        const box = await page.evaluate(() => {
            const measure = (el) => {
                if (!el) return null;
                const r = el.getBoundingClientRect();
                return { x: Math.round(r.x), y: Math.round(r.y + window.scrollY), w: Math.round(r.width) };
            };
            const find = (text) => [...document.querySelectorAll('.config-overview-layout .config-panel')]
                .find((el) => el.textContent.includes(text));
            return {
                news: measure(document.querySelector('.config-news-panel')),
                about: measure(document.querySelector('.config-about-panel')),
                glance: measure(find('At a glance')),
                // The panel, not the flex row inside it: the blocks in the side
                // column line up with one another, and a panel has padding.
                changed: measure(find('Not stock')),
                installRule: measure(document.querySelector('.config-overview-side .config-zone-rule')),
                act: measure(document.querySelector('.config-overview-act')),
                tips: measure(document.querySelector('.config-overview-tips-row')),
                viewport: window.innerHeight,
            };
        });

        for (const [name, r] of Object.entries(box)) {
            if (name === 'viewport') continue;
            expect(r, `${name} should be on the overview`).not.toBeNull();
        }
        // The stream starts within a screen of the top: it used to begin at
        // 936px on a 900px window, which is the definition of not being seen.
        expect(box.news.y).toBeLessThan(box.viewport);
        expect(box.news.y).toBeGreaterThan(box.act.y);
        // Side column to the right, and wider on the left where the list is.
        expect(box.about.x).toBeGreaterThan(box.news.x);
        expect(box.news.w).toBeGreaterThan(box.about.w);
        // About leads that column, and the two blocks about your own install
        // follow it in order.
        expect(box.glance.x).toBe(box.about.x);
        expect(box.about.y).toBeLessThan(box.glance.y);
        expect(box.changed.x).toBe(box.about.x);
        expect(box.glance.y).toBeLessThan(box.changed.y);
        // The install line sits between them, heading only what it covers.
        expect(box.installRule.y).toBeGreaterThan(box.about.y);
        expect(box.installRule.y).toBeLessThan(box.glance.y);
        // Tips still closes the page.
        expect(box.tips.y).toBeGreaterThan(box.news.y);
    });

    test('about lists its addresses one per line, with Ko-fi across the card', async ({ page }) => {
        await loadOverview(page);

        // The pair of buttons became a list when About moved into the narrower
        // side column: four addresses read better stacked than wrapped, and
        // nextdash.cc and its feed appeared nowhere in the product before.
        const links = page.locator('.config-about-links a');
        await expect(links).toHaveCount(4);
        await expect(links.nth(0)).toHaveAttribute('href', /nextdash\.cc\/$/);
        await expect(links.nth(1)).toHaveAttribute('href', /nextdash\.cc\/feed/);

        const stacked = await page.locator('.config-about-links').evaluate((list) => {
            const tops = [...list.querySelectorAll('a')].map((a) => Math.round(a.getBoundingClientRect().top));
            return new Set(tops).size === tops.length;
        });
        expect(stacked).toBe(true);

        // The one thing on the page that asks for something spans the card.
        const kofi = await page.locator('.config-about-panel .wn-kofi-btn').evaluate((btn) => {
            const panel = btn.closest('.config-panel').getBoundingClientRect();
            const box = btn.getBoundingClientRect();
            return box.width > panel.width * 0.8;
        });
        expect(kofi).toBe(true);
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
