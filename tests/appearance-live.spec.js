// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * The appearance controls change the page while you are looking at it.
 *
 * Depth, text contrast, the backdrop and the layout preset are the four that
 * are meant to be judged by eye: you move the control, you see whether you
 * like it, you move it back. A setting that only lands on the next reload is
 * not a preview, and the reload also closes config -- so the comparison the
 * control exists for cannot be made at all.
 *
 * Driven through the controls themselves rather than through the handlers
 * behind them. The handlers were all wired; what this pins down is that the
 * wiring is reachable from the select the user actually changes, and that no
 * navigation happens on the way.
 */

async function openAppearance(page) {
    await page.setViewportSize({ width: 1400, height: 1000 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);

    // A reload would reset this, which is how the assertions below tell a live
    // change apart from one that only survived because the page came back.
    await page.evaluate(() => { window.__notReloaded = true; });

    await page.waitForFunction(() => window.dashboardInstance?.config != null, null, { timeout: 20_000 });
}

/** Opens the appearance section and waits for its controls to exist. */
async function appearanceControls(page) {
    await openAppearance(page);
    await page.evaluate(() => (window.dashboardInstance.config.appearanceTab = window.dashboardInstance.config.appearanceTab || 'general', window.dashboardInstance.config).openConfigView('appearance'));
    await page.waitForSelector('#config-appearance-body', { timeout: 20_000 });
    await page.click('[data-appearance-tab="general"]');
    await page.waitForSelector('[data-appearance-select="themeDepth"]', { timeout: 20_000 });
}

const stillLive = (page) => page.evaluate(() => window.__notReloaded === true);

test.describe('appearance controls apply live', () => {
    test('depth lands on the page without a reload', async ({ page }) => {
        await appearanceControls(page);

        await page.selectOption('[data-appearance-select="themeDepth"]', 'flat');
        await expect.poll(() => page.getAttribute('body', 'data-depth')).toBe('flat');

        await page.selectOption('[data-appearance-select="themeDepth"]', 'rich');
        await expect.poll(() => page.getAttribute('body', 'data-depth')).toBe('rich');

        expect(await stillLive(page), 'the page reloaded to apply the depth').toBe(true);
    });

    test('and the surfaces repaint with it', async ({ page }) => {
        await appearanceControls(page);

        const shadow = () => page.evaluate(() => {
            const probe = document.createElement('div');
            probe.className = 'dashboard-grid layout-cards';
            const body = document.createElement('div');
            body.className = 'category';
            probe.appendChild(body);
            document.getElementById('dashboard-layout').appendChild(probe);
            const value = window.getComputedStyle(body).boxShadow;
            probe.remove();
            return value;
        });

        await page.selectOption('[data-appearance-select="themeDepth"]', 'flat');
        await expect.poll(shadow).toBe('none');

        await page.selectOption('[data-appearance-select="themeDepth"]', 'rich');
        await expect.poll(shadow).not.toBe('none');
    });

    test('text contrast moves the moment it is chosen', async ({ page }) => {
        await appearanceControls(page);
        // A select now, drawn like Depth and Glow above it: the slider offered
        // twenty-nine steps for a question with four answers.
        const select = page.locator('[data-appearance-select="inkGap"]');
        await select.waitFor({ timeout: 20_000 });

        // Read off a painted element, not off the property: --text-tertiary is
        // an oklch(from ...) expression and comes back as its own text, the
        // same text at every setting.
        const faint = () => page.evaluate(() => {
            const probe = document.createElement('span');
            probe.style.color = 'var(--text-tertiary)';
            document.body.appendChild(probe);
            const value = window.getComputedStyle(probe).color;
            probe.remove();
            return value;
        });

        const before = await faint();
        await select.selectOption('0.34');
        await expect.poll(faint).not.toBe(before);
        const low = await faint();

        await select.selectOption('0.58');
        await expect.poll(faint).not.toBe(low);

        expect(await stillLive(page), 'the page reloaded to apply the contrast').toBe(true);
    });

    test('the backdrop goes off and on again in place', async ({ page }) => {
        await appearanceControls(page);
        const select = page.locator('[data-appearance-select="themeBackdrop"]');
        await select.waitFor({ timeout: 20_000 });

        await select.selectOption('off');
        await expect.poll(() => page.getAttribute('body', 'data-theme-backdrop')).toBe('off');

        await select.selectOption('on');
        await expect.poll(() => page.getAttribute('body', 'data-theme-backdrop')).toBe('on');

        expect(await stillLive(page), 'the page reloaded to apply the backdrop').toBe(true);
    });

    /**
     * The preset is the one of the four that cannot show itself while you are
     * setting it: #dashboard-layout is shared with config, so with config open
     * the bookmark grid is not on screen to preview. What has to hold is that
     * closing config is enough -- no reload, no second visit.
     */
    test('the layout preset is on the grid as soon as config closes', async ({ page }) => {
        await openAppearance(page);
        // The preset sits under Appearance's layout tab, not in a section of
        // its own -- it moved there with the config reshuffle.
        await page.evaluate(() => (window.dashboardInstance.config.appearanceTab = window.dashboardInstance.config.appearanceTab || 'general', window.dashboardInstance.config).openConfigView('appearance'));
        await page.waitForSelector('#config-appearance-body', { timeout: 20_000 });
        await page.click('[data-appearance-tab="layout"]');
        const select = page.locator('[data-behavior-field="layoutPreset"]');
        await select.first().waitFor({ timeout: 20_000 });

        await select.first().selectOption('cards');
        await expect.poll(() => page.getAttribute('body', 'data-layout-preset')).toBe('cards');

        await page.evaluate(() => window.dashboardInstance.config.closeConfigView());
        await expect.poll(() => page.getAttribute('.dashboard-grid', 'class')).toContain('layout-cards');

        expect(await stillLive(page), 'the page reloaded to apply the preset').toBe(true);
    });
});
