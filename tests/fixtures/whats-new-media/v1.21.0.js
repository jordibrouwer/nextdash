// The highlights of v1.21.0: the Glances view (a recording), the domains widget
// and the Glances widget (pictures). Glances and the health report are mocked,
// as in tests/manual-screenshots-glances.spec.js. See tests/whats-new-media.spec.js.
const { mockGlances } = require('../../helpers/glances-mock');

const DAY = 86_400_000;

module.exports = {
    shots: [
        {
            slug: 'glances-view',
            kind: 'video',
            alt: 'The Glances page: the overview of a host, then the Processes tab with the side panel of one process open',
            async setup(page, { openDashboard, settle }) {
                await mockGlances(page);
                await openDashboard(page);
                await page.locator('#page-nav-glances-link').click();
                await page.locator('#dashboard-layout.glances-layout [data-glances-body]').waitFor();
                // The tour is offered once on a first visit; settle closes it with Escape, as a reader would.
                await page.waitForTimeout(1_500);
                await settle(page);
                await page.waitForTimeout(800);
            },
            async act(page) {
                await page.waitForTimeout(1_200);
                await page.locator('[data-glances-section="processes"]').click();
                await page.locator('[data-glances-pid]').first().waitFor();
                await page.waitForTimeout(900);
                await page.locator('[data-glances-pid]', { hasText: 'jellyfin' }).first().click();
                await page.locator('[data-glances-drawer]').first().waitFor({ state: 'visible' });
                await page.waitForTimeout(2_000);
            },
        },
        {
            slug: 'domains-widget',
            kind: 'image',
            alt: 'The Domains widget listing the registrations that run out soon, with the days left, and a quiet group of domains whose registry shows no date',
            viewport: { width: 1280, height: 800 },
            dataPatch: 'domains',
            target: (page) => page.locator('[data-widget-type="domains"]').first(),
            async setup(page, { openDashboard, settle }) {
                const now = Date.now();
                const domain = (name, days) => [name, { domain: name, expiresAt: now + days * DAY }];
                await page.route('**/api/bookmark-health**', (route) => route.fulfill({
                    json: {
                        generatedAt: now,
                        summary: { totalBookmarks: 0, brokenCount: 0 },
                        issues: [],
                        domains: Object.fromEntries([domain('example.org', 6), domain('example.net', 19), domain('example.com', 27)]),
                        domainSummary: { enabled: true, watched: 5, noDate: [{ domain: 'voorbeeld.nl', state: 'hidden' }, { domain: 'beispiel.de', state: 'unsupported' }] },
                    },
                }));
                await openDashboard(page);
                const last = await page.evaluate(() => window.dashboardInstance.pages.length);
                await openDashboard(page, `#${last}`);
                await page.locator('[data-widget-type="domains"] .dashboard-widget-row').first().waitFor();
                await page.waitForTimeout(800);
                await settle(page);
            },
        },
        {
            slug: 'glances-widget',
            kind: 'image',
            alt: 'Two Glances tiles on the dashboard: one host as meters, another as a processor graph, beside the processor and memory tiles',
            viewport: { width: 1280, height: 800 },
            dataPatch: 'glances',
            target: (page) => {
                const tile = (type) => page.locator(`[data-widget-type="${type}"]`);
                return [
                    tile('glances').filter({ has: page.locator('a[href$="host=main"]') }),
                    tile('glances').filter({ has: page.locator('a[href$="host=vps"]') }),
                    tile('cpu').first(),
                    tile('memory').first(),
                ];
            },
            async setup(page, { openDashboard, settle }) {
                await mockGlances(page);
                await openDashboard(page);
                const last = await page.evaluate(() => window.dashboardInstance.pages.length);
                await openDashboard(page, `#${last}`);
                await page.locator('[data-widget-type="glances"] svg.dashboard-widget-glances-spark path').waitFor();
                await page.waitForTimeout(1_000);
                await settle(page);
            },
        },
    ],
};
