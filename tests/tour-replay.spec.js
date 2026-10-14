// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');
const { mockDocker } = require('./helpers/docker-mock');

/**
 * Replaying a view's tour from Config.
 *
 * The tours of the Inbox, the Bookmarks view, Containers and Widgets no longer
 * open by themselves when their view first opens; only the dashboard's does.
 * So "show it again" cannot mean "it will turn up next time" any more: the
 * button takes you to the view and plays the tour there and then -- seen
 * before or not.
 */

async function openDashboard(page) {
    await page.setViewportSize({ width: 1400, height: 900 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.evaluate(() => {
        const d = window.dashboardInstance;
        d.settings.enableSessionTips = true;
        d.settings.inboxEnabled = true;
    });
}

async function findReplayButton(page, id) {
    await page.evaluate(() => window.dashboardInstance.config.openConfigView('behavior'));
    const button = page.locator(`[data-replay-tour="${id}"]`);
    // The row sits on one of Behaviour's tabs; walk them until it shows.
    for (const tab of await page.locator('[data-behavior-tab], [data-config-subtab]').all()) {
        if (await button.isVisible()) break;
        await tab.click();
    }
    await expect(button).toBeVisible();
    return button;
}

const TOURS = [
    { id: 'inboxTutorialV3', view: 'inbox', modal: '.inbox-tutorial-modal' },
    { id: 'bookmarksTutorialV1', view: 'library', modal: '.bookmarks-tutorial-modal' },
    { id: 'containersTutorialV3', view: 'docker', modal: '.containers-tutorial-modal', docker: true },
    { id: 'widgetsTutorialV1', view: 'config', modal: '.widgets-tutorial-modal', section: 'widgets' },
];

for (const tour of TOURS) {
    test(`${tour.id}: the button goes there and plays it now, seen or not`, async ({ page }) => {
        if (tour.docker) await mockDocker(page);
        await openDashboard(page);
        const button = await findReplayButton(page, tour.id);
        await expect(button).toBeEnabled();
        await button.click();

        await expect(page.locator(`#app-modal.show ${tour.modal}`)).toBeVisible({ timeout: 15_000 });
        expect(await page.evaluate(() => window.dashboardInstance.activeView)).toBe(tour.view);
        if (tour.section) {
            expect(await page.evaluate(() => window.dashboardInstance.config.instance?.section)).toBe(tour.section);
        }
        await page.keyboard.press('Escape');
        await expect(page.locator('#app-modal.show')).toHaveCount(0);
    });
}
