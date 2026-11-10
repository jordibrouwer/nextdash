// The highlights of v1.28.0: the Tests tab of a bookmark, the checks as chips
// on the Bookmarks view's rows, and the larger weather in the header. See
// tests/whats-new-media.spec.js. Run it over the seed of
// scripts/make-manual-seed.sh, never over ./data-demo.
const fs = require('fs');
const path = require('path');

/** A name for the greeting and the header with the weather beside the rule. */
function headerData(dir) {
    const file = path.join(dir, 'settings.json');
    const settings = JSON.parse(fs.readFileSync(file, 'utf8'));
    fs.writeFileSync(file, `${JSON.stringify({ ...settings, greetingName: 'Jordi', headerClockPlacement: 'classic' }, null, 2)}\n`);
}

/** The Bookmarks view, found by its header icon, with the list drawn. */
async function openBookmarks(page, { openDashboard, settle }) {
    await openDashboard(page);
    await page.locator('.library-link-anchor').click();
    await page.locator('#config-bm-list .config-bm-row').first().waitFor();
    await settle(page);
    // Pacing for the capture, not a condition: a transition gets time to finish before the frame is taken.
    await page.waitForTimeout(800);
}

module.exports = {
    shots: [
        {
            slug: 'network-tests',
            kind: 'image',
            alt: 'The Tests tab of a bookmark: three tiles for its checks, and a Ping check opened with its uptime strip and last result',
            viewport: { width: 1280, height: 900 },
            target: (page) => page.locator('#config-bm-panel'),
            async setup(page, kit) {
                await openBookmarks(page, kit);
                await page.locator('#config-bm-search').fill('GitLab');
                // Pacing for the capture, not a condition: the list filters after a short delay.
                await page.waitForTimeout(600);
                await page.locator('#config-bm-list .config-bm-row', {
                    has: page.locator('.config-bm-title', { hasText: /^GitLab$/ }),
                }).first().click();
                await page.locator('#config-bm-panel .config-bm-panel-title', { hasText: /^GitLab$/ }).waitFor();
                await page.evaluate(() => document.activeElement?.blur?.());
                await page.keyboard.press('4');
                const tests = page.locator('#config-bm-panel [data-bm-pane="tests"]');
                await tests.locator('[data-net-card]').first().waitFor();
                await page.evaluate(() => document.querySelectorAll('[data-net-card]').forEach((d) => { d.open = true; }));
                // Pacing for the capture, not a condition: the strips and sparklines finish drawing.
                await page.waitForTimeout(1_000);
            },
        },
        {
            slug: 'check-chips',
            kind: 'image',
            alt: 'The Bookmarks view filtered on Has checks: four rows, each with its check as a chip beside the tags, and the Check type filter in the rail',
            viewport: { width: 1280, height: 800 },
            target: (page) => page.locator('.config-view--library').first(),
            async setup(page, kit) {
                await openBookmarks(page, kit);
                await page.locator('#config-bm-rail').getByText('Has checks', { exact: true }).first().click();
                await page.locator('#config-bm-list .config-bm-row').first().waitFor();
                // The list draws only the rows near the screen: bring it back to the top.
                await page.evaluate(() => {
                    document.querySelector('#config-bm-list')?.scrollTo?.(0, 0);
                    window.scrollTo(0, 0);
                });
                // Pacing for the capture, not a condition: the list redraws after the filter.
                await page.waitForTimeout(900);
            },
        },
        {
            slug: 'weather-header',
            kind: 'image',
            alt: 'The header with the clock, the greeting, and the weather in large type beside the rule, with the day and place in two small lines',
            viewport: { width: 1280, height: 800 },
            dataTweak: { run: headerData },
            target: (page) => page.locator('.dashboard-section.section-controls').first(),
            async setup(page, { openDashboard }) {
                await openDashboard(page);
            },
        },
    ],
};
