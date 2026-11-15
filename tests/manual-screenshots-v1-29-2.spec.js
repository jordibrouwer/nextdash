// @ts-check
/*
 * The MANUAL.md screenshots added in v1.29.2: the response-time chart of a
 * network check in the Tests tab, and the new-bookmark form with the turned
 * arrow that brings a page's own title back. Same harness as the other specs:
 *
 *   MANUAL_SHOTS=1 NEXTDASH_DATA_DIR=<seed> PW_WORKERS=8 \
 *     npx playwright test tests/manual-screenshots-v1-29-2.spec.js
 *
 * The chart reads the history the demo seed already keeps for its checks. The
 * title preview is stubbed with an invented page: a real fetch would put a real
 * address in the picture.
 */
const { test, prepare, settle, snap, shot, crop, openDashboard, DESKTOP } = require('./helpers/manual-shot-kit');

test.skip(!process.env.MANUAL_SHOTS, 'manual screenshots run on purpose only');
test.describe.configure({ mode: 'parallel' });
test.setTimeout(120_000);
test.use({ viewport: DESKTOP, reducedMotion: 'reduce' });

test('11 the Tests tab: the response-time chart of a check', async ({ page }) => {
    await prepare(page);
    await openDashboard(page);
    await page.locator('.library-link-anchor').click();
    await page.locator('#config-bm-list .config-bm-row').first().waitFor();
    await settle(page);
    // Pacing for the capture, not a condition: a transition or a redraw gets time to finish before the frame is taken.
    await page.waitForTimeout(800);
    await page.locator('#config-bm-search').fill('GitHub');
    // Pacing for the capture, not a condition: the list redraws for the search.
    await page.waitForTimeout(600);
    await page.locator('#config-bm-list .config-bm-row', { has: page.locator('.config-bm-title', { hasText: /^GitHub$/ }) }).first().click();
    const panel = page.locator('#config-bm-panel');
    await panel.locator('.config-bm-panel-title', { hasText: /^GitHub$/ }).waitFor();
    await page.evaluate(() => document.activeElement?.blur?.());
    await page.keyboard.press('4');
    const tests = panel.locator('[data-bm-pane="tests"]');
    await tests.waitFor({ state: 'visible' });
    // The first check opens on its chart by itself; wait for the plot to be drawn.
    await tests.locator('.net-trend svg, .net-trend canvas').first().waitFor({ timeout: 15_000 });
    // Pacing for the capture, not a condition: the plot finishes drawing.
    await page.waitForTimeout(800);
    await snap(page, panel, '11-tests-trend.jpg', { pad: 0 });
});

test('05 the new-bookmark form: the page title, cleaned, with the way back', async ({ page }) => {
    await prepare(page);
    await page.route('**/api/bookmark-preview*', (route) => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ title: 'Radarr', originalTitle: 'Login - Radarr', description: '' }),
    }));
    await openDashboard(page);
    await page.keyboard.press('+');
    const form = page.getByRole('dialog', { name: 'Create New Bookmark' });
    await form.waitFor();
    // Pacing for the capture, not a condition: the form opens with the cursor in URL.
    await page.waitForTimeout(400);
    await page.keyboard.type('https://radarr.lab.example', { delay: 10 });
    await page.keyboard.press('Tab');
    await form.locator('.bookmark-form-name-restore').waitFor({ timeout: 15_000 });
    await page.waitForTimeout(600);
    await crop(page, form, '05-title-restore.jpg');
});

/*
 * Full frames for nextdash.cc/features/network-tests: the Bookmarks view with
 * the Tests tab open on the chart of a GitLab ping that went down for three
 * hours. Only with SHOTS_FULL=1, like the Glances frames.
 */
test('site: the Tests tab with the response-time chart, full frame', async ({ page }) => {
    test.skip(!process.env.SHOTS_FULL, 'only for nextdash.cc');
    await prepare(page);
    await openDashboard(page);
    await page.locator('.library-link-anchor').click();
    await page.locator('#config-bm-list .config-bm-row').first().waitFor();
    await settle(page);
    // Pacing for the capture, not a condition: a transition or a redraw gets time to finish before the frame is taken.
    await page.waitForTimeout(800);
    await page.locator('#config-bm-search').fill('GitLab');
    // Pacing for the capture, not a condition: the list redraws for the search.
    await page.waitForTimeout(600);
    await page.locator('#config-bm-list .config-bm-row', { has: page.locator('.config-bm-title', { hasText: /^GitLab$/ }) }).first().click();
    const panel = page.locator('#config-bm-panel');
    await panel.locator('.config-bm-panel-title', { hasText: /^GitLab$/ }).waitFor();
    await page.evaluate(() => document.activeElement?.blur?.());
    await page.keyboard.press('4');
    const tests = panel.locator('[data-bm-pane="tests"]');
    await tests.waitFor({ state: 'visible' });
    await tests.locator('.net-trend svg, .net-trend canvas').first().waitFor({ timeout: 15_000 });
    // Pacing for the capture, not a condition: the plot finishes drawing.
    await page.waitForTimeout(800);
    await shot(page, 'site-network-tests-trend.jpg');
});
