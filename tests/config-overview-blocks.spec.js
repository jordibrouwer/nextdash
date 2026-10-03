// @ts-check
const { test, expect } = require('./fixtures');
const { dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/*
 * Overview as panels: one attention line, your install on the left as a panel
 * per part of the app, nextDash on the right (news, new features, a tip).
 *
 * The section used to be a row of eight figure tiles and four explained
 * blocks. What those said is still here -- the counts, the cleanup score and
 * its heaviest deduction, the four health states, what needs you -- each in
 * the panel it belongs to.
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
        ['random-theme-v2', 'bookmarks-page-filter-v1'].forEach((id) => {
            window.DiscoverabilityState?.markSettingPromoSeen?.(id, { persist: false });
        });
    });
    await page.evaluate((healthPayload) => {
        const d = window.dashboardInstance;
        if (d?.health) d.health.report = healthPayload;
    }, health);
    await page.evaluate(() => window.dashboardInstance.config.openConfigView('overview'));
    await expect(page.locator('.config-overview-panels')).toBeVisible();
    await dismissConfigSettingPromoIfPresent(page);
}

test.describe('Config overview — your install', () => {
    test('a panel per part of the install, each with a way in', async ({ page }) => {
        await openOverview(page);

        const panels = page.locator('.config-overview-panels .config-widget');
        const ids = await panels.evaluateAll((els) => els.map((el) =>
            [...el.classList].find((c) => c.startsWith('config-widget--')).replace('config-widget--', '')));
        // Containers only appear with a Docker socket, and the inbox only when
        // it is switched on -- the three that are always there are asserted.
        for (const id of ['bookmarks', 'health', 'stats']) expect(ids).toContain(id);
        for (let i = 0; i < ids.length; i += 1) {
            await expect(panels.nth(i).locator('.config-widget-go')).toBeVisible();
        }

        // The figures are the install's own: the bookmarks panel leads with
        // what computeStats() counts.
        const shown = (await page.locator('.config-widget--bookmarks .config-widget-value').textContent() || '').trim();
        const counted = await page.evaluate(() => String(window.dashboardInstance.config.computeStats().total));
        expect(shown).toBe(counted);
    });

    test('what needs you is one line of chips, each going where it is fixed', async ({ page }) => {
        await openOverview(page);

        const line = page.locator('.config-overview-attention');
        await expect(line).toBeVisible();
        await expect(line.locator('.config-attention-chip').first()).toBeVisible();

        // Found by where the chip goes, not by its wording: the copy is
        // translatable, the destination is the behaviour.
        await line.locator('.config-attention-chip[data-overview-go*="broken"]').click();
        await expect.poll(() => page.evaluate(() =>
            window.dashboardInstance.activeView)).toBe('library');
        expect(await page.evaluate(() => window.dashboardInstance.config.instance.bmHealthFilter)).toBe('broken');
    });

    test('a clean install says so instead of listing zeroes', async ({ page }) => {
        await openOverview(page, CLEAN);

        await expect(page.locator('.config-overview-attention .config-attention-chip')).toHaveCount(0);
        await expect(page.locator('.config-overview-attention')).toContainText(/nothing needs attention/i);
    });

    test('the cleanup score names the biggest deduction', async ({ page }) => {
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
    test('the health panel counts what the report counts', async ({ page }) => {
        await openOverview(page);

        const health = page.locator('.config-widget--health');
        await expect(health.locator('.config-widget-v--health-healthy')).toHaveText('3');
        await expect(health.locator('.config-widget-v--health-content')).toHaveText('1');
        await expect(health.locator('.config-widget-v--health-down')).toHaveText('1');
        await expect(health.locator('.config-widget-v--health-broken')).toHaveText('2');
        // Broken plus down, said in the panel's own foot.
        await expect(health.locator('.config-widget-alert')).toContainText('3');
    });

    test('the health panel opens the Bookmarks view', async ({ page }) => {
        await openOverview(page);

        await page.locator('.config-widget--health .config-widget-go').click();
        await expect.poll(() => page.evaluate(() =>
            window.dashboardInstance.activeView)).toBe('library');
    });

    /*
     * The panel is drawn from the container list search keeps, so it is the
     * route the app reads that is stubbed: a socket, and three containers --
     * one stopped, one with an update waiting.
     */
    test('the containers panel counts the list and puts updates on the attention line', async ({ page }) => {
        await page.route('**/api/docker/status', (route) => route.fulfill({
            contentType: 'application/json', body: JSON.stringify({ socket: true, control: false }),
        }));
        await page.route('**/api/docker/containers', (route) => route.fulfill({
            contentType: 'application/json',
            body: JSON.stringify({ containers: [
                { id: 'a', name: 'alpha', state: 'running', health: 'healthy', update: { status: 'available' } },
                { id: 'b', name: 'bravo', state: 'running', health: '' },
                { id: 'c', name: 'charlie', state: 'exited', health: '' },
            ] }),
        }));
        await openOverview(page);

        const panel = page.locator('.config-widget--containers');
        await expect(panel).toBeVisible({ timeout: 10_000 });
        await expect(panel.locator('.config-widget-value')).toHaveText('2');
        await expect(panel.locator('.config-widget-alert')).toHaveText('alpha');
        await expect(page.locator('.config-attention-chip[data-overview-go*="docker"]')).toContainText('1');
    });

    test('without a Docker socket there is no containers panel', async ({ page }) => {
        await page.route('**/api/docker/status', (route) => route.fulfill({
            contentType: 'application/json', body: JSON.stringify({ socket: false, control: false }),
        }));
        await openOverview(page);
        await page.waitForTimeout(500);

        await expect(page.locator('.config-widget--containers')).toHaveCount(0);
        // Statistics then fills the half the containers panel would have taken
        // or the row on its own; either way the page has no hole.
        await expect(page.locator('.config-widget--stats')).toBeVisible();
    });
});

test.describe('Config overview — from nextDash', () => {
    test('new features are the newest announced ones, each a way into what it changed', async ({ page }) => {
        await openOverview(page);

        const rows = page.locator('.config-widget--features .config-overview-feature');
        await expect(rows.first()).toBeVisible({ timeout: 10_000 });
        expect(await rows.count()).toBeLessThanOrEqual(3);

        // The catalogue is newest first and only dated entries are shown, so
        // the first row is the first entry that carries a `since`.
        const first = await page.evaluate(() => {
            const c = window.dashboardInstance.config;
            const f = c.overviewNewFeatures().find((e) => e.since);
            return { since: f.since, go: f.go };
        });
        await expect(rows.first().locator('.config-overview-feature-since')).toHaveText(first.since);

        await rows.first().locator('.config-overview-feature-link').click();
        if (first.go.openBookmarkForm) {
            await expect(page.locator('#bookmark-form-modal')).toHaveClass(/show/, { timeout: 10_000 });
        } else if (first.go.view) {
            await expect.poll(() => page.evaluate(() =>
                document.getElementById('dashboard-layout')?.className || ''), { timeout: 10_000 })
                .toContain(`${first.go.view}-layout`);
        } else {
            await expect.poll(() => page.evaluate(() => window.dashboardInstance.config.section), { timeout: 10_000 })
                .toBe(first.go.section);
        }
    });

    test('the tip steps forward and back, in place', async ({ page }) => {
        await openOverview(page);

        const tip = page.locator('.config-widget--tip [data-overview-tip]');
        await expect(tip).toBeVisible();
        const first = await tip.innerText();
        const ix = Number(await tip.getAttribute('data-overview-tip'));

        await page.locator('[data-overview-action="tip-next"]').click();
        await expect(tip).not.toHaveText(first);
        await expect(page.locator('.config-widget--tip .config-overview-tip-count')).toContainText(String(ix + 2));

        await page.locator('[data-overview-action="tip-prev"]').click();
        await expect(tip).toHaveText(first);
    });

    test('all tips is Help → Tips', async ({ page }) => {
        await openOverview(page);

        await page.locator('.config-widget--tip .config-widget-go').click();
        await expect.poll(() => page.evaluate(() => {
            const c = window.dashboardInstance.config;
            return `${c.section}/${c.helpTab}`;
        })).toBe('help/tips');
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

        await expect(page.locator('.config-overview-panels')).toBeVisible();
        await expect(page.locator('.config-update-notice')).toHaveCount(0);
    });

    /*
     * The bar that went carried the running version, and About deliberately has
     * no version line -- so without this the release number left config
     * entirely, and with it the way into the notes. It sits at the foot of the
     * New features panel, beside what that release brought.
     */
    test('the running release is named under the new features, with a way into its notes', async ({ page }) => {
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

    test('an available release is named above the panels', async ({ page }) => {
        await openOverview(page, PROBLEMS, {
            current: 'v1.0.0',
            latest: 'v9.9.9',
            updateAvailable: true,
            releaseUrl: 'https://example.invalid/release',
        });

        const notice = page.locator('.config-update-notice');
        await expect(notice).toBeVisible();
        await expect(notice).toContainText('v9.9.9');
        // Above the panels, not in the nextDash column: it is the one thing
        // about nextDash that asks you to do something.
        const order = await page.evaluate(() => {
            const notice = document.querySelector('.config-update-notice');
            const panels = document.querySelector('.config-overview-panels');
            return notice.compareDocumentPosition(panels) & Node.DOCUMENT_POSITION_FOLLOWING ? 'before' : 'after';
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
