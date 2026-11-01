// @ts-check
const { test, expect } = require('./fixtures');
const { startStubSite, startFeedlessSite, installWithBookmarks } = require('./helpers/feed-watch');
const { markWhatsNewSeen, dismissBlockingOverlays, dismissOnboardingIfPresent } = require('./e2e-helpers');

/**
 * "Watch more…" lists the bookmarks without a watch, takes a quick look at each
 * site and puts the ones that advertise a feed first.
 */
test.describe.configure({ mode: 'serial' });

let withFeed;
let without;
test.beforeEach(async ({ request }) => {
    withFeed = await startStubSite();
    without = await startFeedlessSite();
    // The names sort the plain site first, so putting the feed site first proves the ranking.
    await installWithBookmarks(request, [{ name: 'A Plain site', site: without }, { name: 'Z Feed site', site: withFeed }]);
});
test.afterEach(async () => { await withFeed.close(); await without.close(); });

async function openChooser(page) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.evaluate(() => { try { localStorage.removeItem('nextdash.feedScan'); } catch { /* none */ } });
    await page.evaluate(() => window.dashboardInstance.config.openConfigView('overview'));
    await page.locator('[data-config-section="feed-watch"]').click();
    await page.locator('[data-feed-watch-overview] [data-fwm-more]').click();
    await expect(page.locator('[data-fwm-chooser]')).toBeVisible();
}

test('the sites with a feed come first, tagged, and the status says how many were found', async ({ page }) => {
    await openChooser(page);
    const chooser = page.locator('[data-fwm-chooser]');
    await expect(chooser.locator('[data-fwm-scan]')).toHaveText('1 of 2 sites have a feed');
    const choices = chooser.locator('[data-fwm-choose]');
    await expect(choices.first()).toContainText('Z Feed site');
    await expect(choices.first()).toContainText('feed found');
    await expect(choices.nth(1)).toContainText('A Plain site');
    await expect(choices.nth(1)).toContainText('no feed advertised');
});

test('"Only sites with a feed" hides the others, and a plain site stays choosable', async ({ page }) => {
    await openChooser(page);
    const chooser = page.locator('[data-fwm-chooser]');
    await expect(chooser.locator('[data-fwm-scan]')).toHaveText('1 of 2 sites have a feed');
    await chooser.locator('[data-fwm-only]').check();
    await expect(chooser.locator('[data-fwm-choose]')).toHaveCount(1);
    await expect(chooser.locator('[data-fwm-choose]')).toContainText('Z Feed site');
    await chooser.locator('[data-fwm-only]').uncheck();
    await expect(chooser.locator('[data-fwm-choose]')).toHaveCount(2);
});

test('the result is kept: a second look does not ask the sites again', async ({ page }) => {
    await openChooser(page);
    await expect(page.locator('[data-fwm-scan]')).toHaveText('1 of 2 sites have a feed');
    await page.keyboard.press('Escape');
    let asked = 0;
    await page.route('**/api/feeds/watch/candidates**', (route) => { asked += 1; return route.continue(); });
    await page.locator('[data-feed-watch-overview] [data-fwm-more]').click();
    await expect(page.locator('[data-fwm-scan]')).toHaveText('1 of 2 sites have a feed');
    expect(asked).toBe(0);
});

test('the chooser closes with the mouse and says Esc closes it', async ({ page }) => {
    await openChooser(page);
    await expect(page.locator('#modal-esc-hint')).toBeVisible();
    await expect(page.locator('#modal-esc-hint')).toContainText('ESC');
    await page.locator('[data-feed-watch-x]').click();
    await expect(page.locator('[data-fwm-chooser]')).toBeHidden();
    await page.locator('[data-feed-watch-overview] [data-fwm-more]').click();
    await expect(page.locator('[data-fwm-chooser]')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-fwm-chooser]')).toBeHidden();
});
