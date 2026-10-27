// @ts-check
const { test, expect } = require('./fixtures');
const { dismissOnboardingIfPresent, dismissBlockingOverlays, markWhatsNewSeen } = require('./e2e-helpers');

/**
 * A card can belong to a view other than the bookmarks.
 *
 * Every card used to be held back anywhere but the bookmarks view, so a card
 * about containers or the inbox — whose natural place is that view — was never
 * shown at all. `view` names the one it belongs to.
 */

async function loadDashboard(page) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.evaluate(() => {
        document.querySelectorAll('.quickstart-card').forEach((el) => el.remove());
        const d = window.dashboardInstance;
        d.settings.quickStart = { ...(d.settings.quickStart || {}), analyticsChoiceMade: true };
        window.__probes = {
            plain: window.NoticeCard.define({ id: 'probe-plain', title: 'plain', body: 'x', actions: [] }),
            docker: window.NoticeCard.define({ id: 'probe-docker', title: 'docker', body: 'x', view: 'docker', actions: [] }),
        };
    });
}

const shouldShow = (page, name) => page.evaluate((n) => window.__probes[n].shouldShow(), name);
const inView = (page, view) => page.evaluate((v) => { window.dashboardInstance.activeView = v; }, view);

test('a card without a view is for the bookmarks, a card with one is for that view', async ({ page }) => {
    await loadDashboard(page);

    await inView(page, 'bookmarks');
    expect(await shouldShow(page, 'plain')).toBe(true);
    expect(await shouldShow(page, 'docker')).toBe(false);

    await inView(page, 'docker');
    expect(await shouldShow(page, 'docker')).toBe(true);
    expect(await shouldShow(page, 'plain')).toBe(false);
});

test('a card for another view does not count as a card still to come', async ({ page }) => {
    await loadDashboard(page);
    await inView(page, 'bookmarks');
    // Other cards of the install may be on their way; only the difference the
    // probe makes is the point.
    const before = await page.evaluate(() => window.NoticeCard.busy());
    await page.evaluate(() => window.__probes.docker.autoStart());
    expect(await page.evaluate(() => window.NoticeCard.busy())).toBe(before);
    await page.evaluate(() => window.__probes.docker.stop());
});
