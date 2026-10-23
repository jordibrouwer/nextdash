// The highlights of v1.21.1: the new Insights blocks on the Glances page and
// the Containers view saying why no container could be paired with Glances
// (pictures). Glances and Docker are mocked, as in
// tests/manual-screenshots-glances.spec.js and tests/glances-containers-link.spec.js.
// See tests/whats-new-media.spec.js.
const { mockGlances } = require('../../helpers/glances-mock');
const { mockDocker } = require('../../helpers/docker-mock');

module.exports = {
    shots: [
        {
            slug: 'glances-insights',
            kind: 'image',
            alt: 'The Glances Insights tab: a typical day with a bar for every hour, the load against the cores, and where the memory goes',
            viewport: { width: 1280, height: 2600 },
            target: (page) => [
                page.locator('[data-glances-insight="day"]'),
                page.locator('[data-glances-insight="load"]'),
                page.locator('[data-glances-insight="memory"]'),
            ],
            async setup(page, { openDashboard, settle }) {
                await mockGlances(page);
                await openDashboard(page);
                await page.locator('#page-nav-glances-link').click();
                await page.locator('#dashboard-layout.glances-layout [data-glances-body]').waitFor();
                // The tour is offered once on a first visit; settle closes it with Escape, as a reader would.
                await page.waitForTimeout(1_500);
                await settle(page);
                await page.locator('[data-glances-section="insights"]').click();
                await page.locator('[data-glances-insight="day"]').waitFor();
                // Pacing for the capture, not a condition: the frame is taken after the page has had time to draw.
                await page.waitForTimeout(800);
            },
        },
        {
            slug: 'glances-link-problem',
            kind: 'image',
            alt: 'The side panel of a container in the Containers view, saying that it is linked to Glances but that no container could be paired',
            viewport: { width: 1280, height: 800 },
            target: (page) => page.locator('[data-docker-drawer]').first(),
            async setup(page, { openDashboard, settle }) {
                await mockGlances(page);
                await mockDocker(page);
                // Linked on purpose, yet not one container of the two lists belongs to the other.
                await page.route('**/api/glances/docker-link', (route) => route.fulfill({
                    json: {
                        mode: 'auto', same: true, reason: 'same-name', glancesHost: 'homelab', dockerHost: 'homelab',
                        matches: [], onlyGlances: [], onlyDocker: [], byId: 0, byName: 0,
                        problem: 'none-matched', glancesCount: 8, dockerCount: 6,
                    },
                }));
                await openDashboard(page, '#docker/sonarr');
                await settle(page);
                await page.locator('[data-docker-drawer] [data-slp-tab="resources"]').click();
                await page.locator('[data-glances-embed-problem="none-matched"]').waitFor();
                await settle(page);
                // Pacing for the capture, not a condition: the frame is taken after the page has had time to draw.
                await page.waitForTimeout(800);
            },
        },
    ],
};
