// @ts-check
const { test, expect } = require('./fixtures');
const { dismissOnboardingIfPresent, dismissBlockingOverlays, markWhatsNewSeen } = require('./e2e-helpers');

/**
 * Config → Help: the guide has to be findable, current, and honest about what
 * the reader actually has switched on.
 *
 * The failures this pins were all of the same kind — help that had drifted from
 * the app it describes. Jump targets naming the wrong tab, a search that
 * stopped covering prose the moment it moved section, a Health tab carrying
 * nine panels against three on Data, and a tip catalogue that existed in the
 * locales and rendered nowhere.
 */

async function openHelp(page, tab) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.evaluate(() => window.dashboardInstance.config.openConfigView('help'));
    await page.waitForSelector('#config-help-body', { timeout: 15_000 });
    if (tab) {
        await page.evaluate((t) => {
            const c = window.dashboardInstance.config;
            c.helpTab = t;
            c.render();
        }, tab);
        await page.waitForTimeout(500);
    }
}

test.describe('the index agrees with where panels live', () => {
    test('every jump target names the tab its panel is on', async ({ page }) => {
        await openHelp(page);

        const wrong = await page.evaluate(() => {
            const c = window.dashboardInstance.config;
            const parse = new DOMParser();
            const titlesByTab = {};
            for (const tab of DashboardConfig.HELP_TABS) {
                const doc = parse.parseFromString(c.renderHelpBodyFor(tab), 'text/html');
                titlesByTab[tab] = [...doc.querySelectorAll('.config-panel-title')].map((e) => e.textContent.trim());
            }
            const bad = [];
            for (const panel of DashboardConfig.HELP_JUMP_PANELS) {
                if (!panel.tab) continue;
                const title = c.t(panel.titleKey, panel.fallback);
                const actual = Object.keys(titlesByTab).filter((t) => titlesByTab[t].includes(title));
                // A title that renders nowhere is a stale index entry; one that
                // renders somewhere else sends the reader a tab away.
                if (!actual.includes(panel.tab)) bad.push(`${title}: says ${panel.tab}, is on ${actual.join('/') || 'nothing'}`);
            }
            return bad;
        });
        expect(wrong).toEqual([]);
    });
});

test.describe('the search covers everywhere help lives', () => {
    test('every source renders panels it can read', async ({ page }) => {
        await openHelp(page);
        const empty = await page.evaluate(() => {
            const c = window.dashboardInstance.config;
            const parse = new DOMParser();
            return DashboardConfig.HELP_SEARCH_SOURCES()
                .filter((source) => {
                    const doc = parse.parseFromString(c.renderHelpSourceBody(source), 'text/html');
                    return doc.querySelectorAll('.config-panel').length === 0;
                })
                .map((source) => `${source.kind}:${source.id}`);
        });
        // A source that renders nothing is prose that has moved without the
        // list being told — exactly how About fell out of the search.
        expect(empty).toEqual([]);
    });

    test('a word that only appears in About is found, and labelled About', async ({ page }) => {
        await openHelp(page);
        await page.fill('#config-help-search', 'ko-fi');
        await expect(page.locator('.config-help-result')).toHaveCount(1, { timeout: 10_000 });
        await expect(page.locator('.config-help-result-tab')).toHaveText(/about/i);

        // And it leaves Help for the section it came from.
        await page.locator('.config-help-result-tab').click();
        await expect.poll(() => page.evaluate(() => window.dashboardInstance.config.section),
            { timeout: 10_000 }).toBe('about');
    });

    test('a query that matches nothing says so, about help', async ({ page }) => {
        await openHelp(page);
        await page.fill('#config-help-search', 'zzzznothingatall');
        await expect(page.locator('#config-help-body .config-panel-empty'))
            .toContainText(/help/i, { timeout: 10_000 });
    });
});

test.describe('the tabs carry a readable amount each', () => {
    test('no tab is more than twice the median', async ({ page }) => {
        await openHelp(page);
        const counts = await page.evaluate(() => {
            const c = window.dashboardInstance.config;
            const parse = new DOMParser();
            const out = {};
            for (const tab of DashboardConfig.HELP_TABS) {
                const doc = parse.parseFromString(c.renderHelpBodyFor(tab), 'text/html');
                out[tab] = doc.querySelectorAll('.config-panel').length;
            }
            return out;
        });
        const values = Object.values(counts).sort((a, b) => a - b);
        const median = values[Math.floor(values.length / 2)];
        // Health held nine against a median of four — a manual inside a tab.
        for (const [tab, n] of Object.entries(counts)) {
            expect(n, `${tab} has ${n} panels against a median of ${median}`).toBeLessThanOrEqual(median * 2);
            expect(n, `${tab} is empty`).toBeGreaterThan(0);
        }
    });

    test('Tips renders the whole catalogue, grouped', async ({ page }) => {
        await openHelp(page, 'tips');
        const panels = page.locator('#config-help-body .config-panel');
        await expect(panels).toHaveCount(7);
        // The Start tab used to show eleven hand-picked keys while the prose
        // promised the rest were here.
        const tips = await page.locator('#config-help-body .config-help-tip').count();
        expect(tips).toBeGreaterThan(30);
        // Rendered from the shared groups, so a missing locale key would show
        // as its own name rather than as a tip.
        await expect(page.locator('#config-help-body')).not.toContainText('config.tip');
    });
});

test.describe('one topic can be linked to', () => {
    test('a panel link opens that panel, on its tab', async ({ page }) => {
        await markWhatsNewSeen(page);
        await page.goto('/#config/help/monitoring/health-cert');
        await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
        await dismissOnboardingIfPresent(page);
        await dismissBlockingOverlays(page);

        await expect.poll(() => page.evaluate(() => window.dashboardInstance.config?.helpTab),
            { timeout: 15_000 }).toBe('monitoring');
        const panel = page.locator('#help-panel-health-cert');
        await expect(panel).toBeVisible();
        // Arriving at a wall of prose with no idea which part was linked is
        // barely better than arriving at the top.
        await expect(panel).toHaveClass(/is-linked/);
        // The address keeps the panel rather than being rewritten to the tab.
        expect(await page.evaluate(() => location.hash)).toBe('#config/help/monitoring/health-cert');
    });

    test('every panel carries an id, and a link button', async ({ page }) => {
        await openHelp(page, 'health');
        const panels = await page.locator('#config-help-body [data-help-panel]').count();
        const links = await page.locator('#config-help-body [data-help-panel-link]').count();
        expect(panels).toBeGreaterThan(0);
        expect(links).toBe(panels);
    });
});

test.describe('help says what is switched on here', () => {
    test('the inbox panel reports its state and offers the setting', async ({ page }) => {
        await openHelp(page, 'inbox');
        const state = page.locator('.config-help-state').first();
        await expect(state).toBeVisible();
        await expect(state).toContainText(/switched (on|off)/i);

        // The button uses the Overview jump shape, whose handler is bound to
        // the overview body — without wiring here it renders and does nothing.
        await state.locator('[data-overview-go]').click();
        await expect.poll(() => page.evaluate(() => window.dashboardInstance.config.section),
            { timeout: 10_000 }).toBe('behavior');
    });
});
