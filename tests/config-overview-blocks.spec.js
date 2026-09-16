// @ts-check
const { test, expect } = require('./fixtures');
const { dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/*
 * Overview as the draft draws it: a row of figures, then four blocks.
 *
 * The section used to be five panels about nextDash itself -- the release, the
 * developer, what was new, a tip -- with two about the install wedged between
 * them. Those five all have another address (About, About > News, Help > Tips),
 * so what is left here is the install: what needs you, how you use it, how
 * tidy it is, and whether the links still answer.
 */

async function dismissConfigSettingPromoIfPresent(page) {
    const promo = page.locator('.config-setting-promo');
    if (await promo.count()) {
        await promo.locator('.config-setting-promo-dismiss').click();
        await expect(promo).toHaveCount(0, { timeout: 3000 });
    }
}

const PROBLEMS = {
    summary: {
        totalBookmarks: 7, healthyCount: 3, brokenCount: 2, monitorDownCount: 1,
        contentCount: 1,
        monitoredCount: 2, duplicateCount: 1, uncheckedCount: 1, staleCount: 2, shortcutConflictCount: 0,
    },
    issues: [], duplicateGroups: [],
};

const CLEAN = {
    summary: {
        totalBookmarks: 7, healthyCount: 7, brokenCount: 0, monitorDownCount: 0,
        contentCount: 0,
        monitoredCount: 0, duplicateCount: 0, uncheckedCount: 0, staleCount: 0, shortcutConflictCount: 0,
    },
    issues: [], duplicateGroups: [],
};

async function openOverview(page, health = PROBLEMS, update = null) {
    await page.route('**/api/bookmark-health**', (route) => route.fulfill({
        status: 200, contentType: 'application/json', body: JSON.stringify(health),
    }));
    // The section loads its own update status on the way in, so the answer has
    // to come from the route the app asks -- setting the field by hand is
    // overwritten by that fetch landing a moment later.
    if (update) {
        await page.route('**/api/update-status**', (route) => route.fulfill({
            status: 200, contentType: 'application/json', body: JSON.stringify(update),
        }));
    }
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.allBookmarks?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.evaluate(() => {
        ['random-theme-v2', 'find-settings-v1', 'bookmarks-page-filter-v1'].forEach((id) => {
            window.DiscoverabilityState?.markSettingPromoSeen?.(id, { persist: false });
        });
    });
    await page.evaluate((healthPayload) => {
        const d = window.dashboardInstance;
        if (d?.health) d.health.report = healthPayload;
    }, health);
    await page.evaluate(() => window.dashboardInstance.config.openConfigView('overview'));
    await expect(page.locator('.config-overview-blocks')).toBeVisible();
    await dismissConfigSettingPromoIfPresent(page);
}

test.describe('Config overview — figures and blocks', () => {
    test('the figure row counts the install', async ({ page }) => {
        await openOverview(page);

        const tiles = page.locator('.config-overview-tiles .config-tile');
        await expect(tiles).toHaveCount(8);

        const labels = (await tiles.locator('.config-tile-label').allTextContents())
            .map((t) => t.trim().toLowerCase());
        expect(labels).toEqual([
            'bookmarks', 'pages', 'categories', 'distinct tags',
            'monitored', 'with shortcut', 'pinned', 'last edited',
        ]);

        // The figures are the install's own, not decoration: the first one is
        // what computeStats() counts.
        const shown = (await tiles.first().locator('.config-tile-value').textContent() || '').trim();
        const counted = await page.evaluate(() => String(window.dashboardInstance.config.computeStats().total));
        expect(shown).toBe(counted);
    });

    test('each block says what it is for', async ({ page }) => {
        await openOverview(page);

        const blocks = page.locator('.config-overview-blocks .config-block');
        await expect(blocks).toHaveCount(4);

        const titles = (await blocks.locator('.config-block-title').allTextContents())
            .map((t) => t.trim().toLowerCase());
        expect(titles).toEqual([
            'needs attention',
            'how you use this collection',
            'cleanup score',
            'health at a glance',
        ]);

        // Every block carries the line that says what it is, so none of them
        // is a heading over an unexplained figure.
        for (let i = 0; i < 4; i += 1) {
            await expect(blocks.nth(i).locator('.config-block-what')).not.toBeEmpty();
        }
    });

    test('a problem is a sentence with the action beside it', async ({ page }) => {
        await openOverview(page);

        const rows = page.locator('.config-block--attention .config-attention-sentence');
        await expect(rows.first()).toBeVisible();
        // A sentence, not a count in one column and a label in another.
        await expect(rows.first().locator('.config-attention-text')).toContainText(/\w+ \w+/);
        await expect(rows.first().locator('.config-attention-chip')).toBeVisible();
    });

    test('a problem hands off to health with its filter', async ({ page }) => {
        await openOverview(page);

        // Found by where the chip goes, not by the wording of the sentence:
        // the copy is translatable, the destination is the behaviour.
        await page.locator('.config-attention-chip[data-overview-go*="broken"]').first().click();

        await expect.poll(() => page.evaluate(() =>
            window.dashboardInstance.activeView)).toBe('health');
        expect(await page.evaluate(() => window.dashboardInstance.health.instance?.filter
            ?? window.dashboardInstance.health.filter)).toBe('broken');
    });

    test('a clean install says so instead of listing zeroes', async ({ page }) => {
        await openOverview(page, CLEAN);

        await expect(page.locator('.config-block--attention .config-attention-sentence')).toHaveCount(0);
        await expect(page.locator('.config-block--attention')).toContainText(/nothing needs attention/i);
    });

    test('the cleanup block names the biggest deduction', async ({ page }) => {
        await openOverview(page);

        const score = await page.evaluate(() => window.dashboardInstance.config.computeStats().cleanup);
        await expect(page.locator('.config-cleanup-score')).toHaveText(String(score.score));
        await expect(page.locator('.config-cleanup-bar-fill')).toBeVisible();

        // The reason line is the detail that costs the most, so the number is
        // never a verdict without a cause.
        const worst = [...score.details].sort((a, b) => (b.penalty || 0) - (a.penalty || 0))[0];
        await expect(page.locator('.config-cleanup-reason')).toContainText(worst.text);
    });

    /*
     * Driven by crafted figures, because the fixture cannot tell the two rules
     * apart: its heaviest deduction happens to be the first one computed, so a
     * renderer taking details[0] passes the test above unchanged. Here the
     * first detail is the cheap one, so only picking by penalty answers "B".
     */
    test('the reason is the heaviest deduction, not the first one', async ({ page }) => {
        await openOverview(page);

        await page.evaluate(() => {
            const c = window.dashboardInstance.config;
            const real = c.computeStats.bind(c);
            c.computeStats = () => ({
                ...real(),
                cleanup: {
                    score: 62,
                    details: [
                        { type: 'warn', penalty: 3, text: 'A cheap deduction' },
                        { type: 'bad', penalty: 35, text: 'B expensive deduction' },
                    ],
                },
            });
            c.repaintOverview();
        });

        await expect(page.locator('.config-cleanup-score')).toHaveText('62');
        await expect(page.locator('.config-cleanup-reason')).toHaveText('B expensive deduction');
    });

    /*
     * The four states the report keeps apart, not three invented ones: a
     * bookmark is healthy, or answered with the wrong content, or is a monitor
     * that is down, or is an ordinary dead link -- never two at once, so the
     * counts add up to what was checked.
     */
    test('health at a glance counts what the report counts', async ({ page }) => {
        await openOverview(page);

        await expect(page.locator('.config-health-count--healthy')).toHaveText('3');
        await expect(page.locator('.config-health-count--content')).toHaveText('1');
        await expect(page.locator('.config-health-count--down')).toHaveText('1');
        await expect(page.locator('.config-health-count--broken')).toHaveText('2');
    });

    test('how you use this collection states the shares it drew them from', async ({ page }) => {
        await openOverview(page);

        const stats = await page.evaluate(() => {
            const s = window.dashboardInstance.config.computeStats();
            return {
                shortcut: s.total ? Math.round((s.withShortcut / s.total) * 100) : 0,
                tagged: s.total ? Math.round((s.tagged / s.total) * 100) : 0,
            };
        });

        const habits = page.locator('.config-block--habits');
        await expect(habits).toContainText(`${stats.shortcut}%`);
        await expect(habits).toContainText(`${stats.tagged}%`);
    });
});

/*
 * The update bar was a permanent panel saying "you are on the latest release".
 * It is a notice now: it appears when there is something to say and draws
 * nothing when there is not -- the same rule the attention block already
 * followed.
 */
test.describe('Config overview — the update notice', () => {
    test('nothing is drawn when the install is current', async ({ page }) => {
        await openOverview(page, PROBLEMS, { current: 'v1.0.0', updateAvailable: false });

        await expect(page.locator('.config-overview-blocks')).toBeVisible();
        await expect(page.locator('.config-update-notice')).toHaveCount(0);
    });

    /*
     * The bar that went carried the running version, and About deliberately has
     * no version line -- so without this the release number left config
     * entirely, and with it the way into the notes. One line at the foot, where
     * a colophon belongs, rather than the framed panel it used to be.
     */
    test('the running release is named at the foot, with a way into its notes', async ({ page }) => {
        await openOverview(page, PROBLEMS, { current: 'v1.2.3', updateAvailable: false });

        const foot = page.locator('.config-overview-footnote');
        await expect(foot).toContainText('v1.2.3');
        await expect(foot.locator('[data-overview-action="whats-new"]')).toBeVisible();
    });

    test('the foot opens the what’s-new modal', async ({ page }) => {
        await openOverview(page, PROBLEMS, { current: 'v1.2.3', updateAvailable: false });

        await page.locator('.config-overview-footnote [data-overview-action="whats-new"]').click();
        await expect(page.locator('.whats-new-modal')).toBeVisible();
    });

    test('an available release is named above the figures', async ({ page }) => {
        await openOverview(page, PROBLEMS, {
            current: 'v1.0.0',
            latest: 'v9.9.9',
            updateAvailable: true,
            releaseUrl: 'https://example.invalid/release',
        });

        const notice = page.locator('.config-update-notice');
        await expect(notice).toBeVisible();
        await expect(notice).toContainText('v9.9.9');
        // Above the figures, not below them: it is the one thing on the page
        // that is about nextDash rather than about this collection.
        const order = await page.evaluate(() => {
            const notice = document.querySelector('.config-update-notice');
            const tiles = document.querySelector('.config-overview-tiles');
            return notice.compareDocumentPosition(tiles) & Node.DOCUMENT_POSITION_FOLLOWING ? 'before' : 'after';
        });
        expect(order).toBe('before');
    });
});

/*
 * Kept from the section's previous spec: the shell has to be the shell whether
 * config was opened from the dashboard or loaded straight into. A direct load
 * once rendered a content-sized box instead of the full grid.
 */
test.describe('Config overview — the shell it sits in', () => {
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

        await page.goto('/');
        await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
        await dismissOnboardingIfPresent(page);
        await dismissBlockingOverlays(page);
        await page.evaluate(() => window.dashboardInstance.config.openConfigView('overview'));
        await page.waitForTimeout(1200);
        const navigated = await shellWidth();

        expect(direct).toBe(navigated);
        // And it is the full shell, not a content-sized box.
        expect(direct).toBeGreaterThan(900);
    });
});
