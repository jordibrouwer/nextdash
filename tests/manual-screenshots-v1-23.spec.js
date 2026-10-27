// @ts-check
/*
 * The MANUAL.md screenshots of what v1.23 added: the Quick start guide, the
 * example tag cloud, the keyboard and Monitoring tours, the settings search's
 * recent list and the tips frequency. Same harness as the other specs:
 *
 *   MANUAL_SHOTS=1 NEXTDASH_DATA_DIR=<seed> PW_WORKERS=8 \
 *     npx playwright test tests/manual-screenshots-v1-23.spec.js
 */
const {
    test,
    prepare,
    settle,
    snap,
    openDashboard,
    DESKTOP,
} = require('./helpers/manual-shot-kit');

test.skip(!process.env.MANUAL_SHOTS, 'manual screenshots run on purpose only');
test.describe.configure({ mode: 'parallel' });
test.use({ viewport: DESKTOP, reducedMotion: 'reduce' });
test.setTimeout(90_000);

async function openConfig(page, section) {
    await openDashboard(page);
    await page.locator('.config-link-anchor').click();
    await page.locator('[data-config-section]').first().waitFor();
    if (section) await page.locator(`[data-config-section="${section}"]`).click();
    // Pacing for the capture, not a condition: a transition gets time to finish before the frame is taken.
    await page.waitForTimeout(800);
    await settle(page);
}

test.describe('first start', () => {
    // A new install as it really starts: the Quick start bar, opened by the reader.
    test.use({ dataPatch: 'empty' });
    async function openGuide(page) {
        await prepare(page);
        await page.goto('/');
        await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 30_000 });
        await page.locator('[data-start-guide-bar]').waitFor({ state: 'visible', timeout: 30_000 });
        // Pacing for the capture, not a condition: the bar finishes sliding in before it is clicked.
        await page.waitForTimeout(1_500);
        await page.locator('[data-start-guide-open]').click();
        const guide = page.locator('[data-start-guide-modal]');
        await guide.waitFor({ state: 'visible' });
        // Pacing for the capture, not a condition: the modal finishes rising before the frame is taken.
        await page.waitForTimeout(900);
        return guide;
    }

    test('02 quick start', async ({ page }) => {
        const guide = await openGuide(page);
        await snap(page, guide, '02-quick-start.jpg', { pad: 16 });
    });

    test('02 quick start steps', async ({ page }) => {
        // Tall enough for the whole grid and the foot of the guide.
        await page.setViewportSize({ width: 1440, height: 1000 });
        const guide = await openGuide(page);
        await guide.locator('[data-sg-more]').click();
        await page.locator('[data-sg-less]').waitFor();
        // Pacing for the capture, not a condition: the modal settles at its new height.
        await page.waitForTimeout(600);
        await snap(page, guide, '02-quick-start-steps.jpg', { pad: 16 });
    });

    test('08 tag cloud example', async ({ page }) => {
        const guide = await openGuide(page);
        // A page started empty has no tags yet, which is when the example is offered.
        await guide.locator('[data-sg-empty]').click();
        await guide.locator('[data-sg-empty-confirm]').click();
        await page.locator('[data-sg-empty]').waitFor({ state: 'detached', timeout: 15_000 });
        await guide.locator('[data-sg-more]').click();
        await guide.locator('[data-sg-step="tags"] .sg-step-button').click();
        const cloud = page.locator('#tag-cloud-modal.is-open');
        await cloud.waitFor();
        // Pacing for the capture, not a condition: the cloud finishes drawing its words.
        await page.waitForTimeout(1_000);
        await page.evaluate(() => document.querySelectorAll('#tag-cloud-modal .is-keyboard-focused')
            .forEach((el) => el.classList.remove('is-keyboard-focused')));
        const box = await cloud.boundingBox();
        await snap(page, cloud, '08-tag-cloud-example.jpg', { pad: 0, maxHeight: Math.floor(box.height) - 4 });
    });
});

test('08 keyboard tour', async ({ page }) => {
    await prepare(page);
    await openDashboard(page);
    await page.keyboard.press(':');
    await page.locator('#shortcut-search.show').waitFor();
    await page.keyboard.type('tour keyboard', { delay: 40 });
    await page.locator('.search-match', { hasText: 'keyboard' }).first().waitFor();
    await page.keyboard.press('Enter');
    const tour = page.locator('#app-modal.show .keyboard-tutorial-modal');
    await tour.waitFor({ timeout: 15_000 });
    await page.locator('#app-modal.show .modal-actions .modal-button').first().click();
    await page.locator('#app-modal.show .keyboard-tutorial-progress', { hasText: 'Step 2' }).waitFor();
    // Pacing for the capture, not a condition: the picture of the step finishes drawing.
    await page.waitForTimeout(1_500);
    await snap(page, tour, '08-keyboard-tour.jpg', { pad: 16 });
});

test('17 monitoring tour', async ({ page }) => {
    await prepare(page);
    await openConfig(page, 'monitoring');
    await page.locator('[data-monitoring-tour]').first().click();
    const tour = page.locator('#app-modal.show .monitoring-tutorial-modal');
    await tour.waitFor({ timeout: 15_000 });
    await page.locator('#app-modal.show .monitoring-tutorial-progress', { hasText: 'Step 1' }).waitFor();
    // Pacing for the capture, not a condition: the picture of the step finishes drawing.
    await page.waitForTimeout(1_500);
    await snap(page, tour, '17-monitoring-tour.jpg', { pad: 16 });
});

test('17 find settings recent', async ({ page }) => {
    await prepare(page);
    await openConfig(page, 'appearance');
    // Two settings opened through the finder, so the list has something to remember.
    for (const query of ['quiet hours', 'open links']) {
        await page.keyboard.press('ControlOrMeta+Shift+K');
        const finder = page.locator('#app-modal.show .config-settings-jump-modal');
        await finder.waitFor();
        await finder.locator('input').first().click();
        await page.keyboard.type(query, { delay: 40 });
        await page.locator('.config-settings-jump-result').first().waitFor();
        await page.keyboard.press('Enter');
        await finder.waitFor({ state: 'detached' });
        // Pacing for the capture, not a condition: the section finishes opening.
        await page.waitForTimeout(800);
    }
    await page.keyboard.press('ControlOrMeta+Shift+K');
    const finder = page.locator('#app-modal.show .config-settings-jump-modal');
    await finder.waitFor();
    await page.locator('.config-settings-jump-group', { hasText: 'Recent' }).waitFor();
    // The picture is taken once the panel's entrance has finished.
    await page.waitForTimeout(600);
    await snap(page, finder, '17-find-settings-recent.jpg', { pad: 4, keepFocus: true });
});

test('17 onboarding tips frequency', async ({ page }) => {
    await prepare(page);
    await openConfig(page, 'behavior');
    await page.locator('[data-behavior-tab="privacy"]').first().click();
    const select = page.locator('[data-behavior-field="sessionTipsFrequency"]');
    await select.waitFor();
    const group = page.locator('#config-section-panel .config-panel', { has: select }).first();
    // The group's title sits under the sticky head unless it is scrolled clear of it.
    await group.evaluate((el) => {
        let box = el.parentElement;
        while (box && box.scrollHeight <= box.clientHeight + 1) box = box.parentElement;
        if (box) box.scrollTop += el.getBoundingClientRect().top - 150;
    });
    // Pacing for the capture, not a condition: the section finishes scrolling.
    await page.waitForTimeout(600);
    await snap(page, group, '17-onboarding-tips.jpg', { pad: 14, maxHeight: 420 });
});
