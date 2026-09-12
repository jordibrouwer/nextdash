// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * A figure with a label under it looks the same wherever it stands.
 *
 * Config's statistics and the dashboard's widgets both draw one, and they had
 * drifted: config set its label in upper case at 0.06em of tracking in the
 * secondary text colour, the widgets left theirs in normal case at 0.03em in
 * the tertiary. Two components for one idea, and the two were visibly
 * different objects.
 *
 * They read the same way now, and it is the widget's treatment that won. The
 * app lower-cases on purpose everywhere it names something -- the category
 * heading, the view name, the block title -- and config's capitals were the
 * exception rather than the rule.
 *
 * The sizes still differ, and should: a statistics tile is the content of its
 * page, a widget figure is one cell in a tile on a dashboard.
 *
 * Read off real elements rather than off bare class names. The two captions
 * are one component now, and the shared declarations sit on `stat-tile-label`
 * -- a probe wearing only the legacy name would come back unstyled and the
 * test would compare two sets of inherited values, which agree about nothing
 * in particular. What is worth holding is that the elements config and the
 * widgets actually render still agree.
 */

async function openConfig(page) {
    await page.setViewportSize({ width: 1400, height: 900 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);

    // config-view.css rides in the lazy views bundle, so its classes only
    // resolve once config has opened and the sheet has landed.
    await page.waitForFunction(() => window.dashboardInstance?.config != null, null, { timeout: 20_000 });
    await page.evaluate(() => window.dashboardInstance.config.openConfigView());
    await page.waitForSelector('.config-view', { timeout: 20_000 });
    await page.waitForFunction(() => {
        const probe = document.createElement('span');
        probe.className = 'config-tile-delta';
        document.body.appendChild(probe);
        const styled = parseFloat(window.getComputedStyle(probe).marginLeft) > 0;
        probe.remove();
        return styled;
    }, null, { timeout: 20_000 });
}

const labelStyle = (page, className) => page.evaluate((name) => {
    const probe = document.createElement('span');
    // Both names, as the markup carries them: the shared class brings the
    // treatment, the legacy one brings whatever its own sheet still owns.
    probe.className = `stat-tile-label ${name}`;
    document.body.appendChild(probe);
    const style = window.getComputedStyle(probe);
    // Tracking as a share of the type it sits in. Both are declared in em, so
    // the computed pixels differ with the font size -- which is the em doing
    // its job, not a disagreement.
    const size = parseFloat(style.fontSize) || 1;
    const value = {
        transform: style.textTransform,
        tracking: Math.round((parseFloat(style.letterSpacing) || 0) / size * 1000) / 1000,
        colour: style.color,
    };
    probe.remove();
    return value;
}, className);

test.describe('the stat tile', () => {
    test('its label reads the same in config as on a widget', async ({ page }) => {
        await openConfig(page);

        const config = await labelStyle(page, 'config-tile-label');
        const widget = await labelStyle(page, 'dashboard-widget-stat-label');

        expect(config.transform, 'config still shouts its labels').toBe(widget.transform);
        expect(config.tracking, 'two ideas of how wide to track a caption').toBe(widget.tracking);
        expect(config.colour, 'two ideas of how dim a caption is').toBe(widget.colour);
    });

    test('and it is the quiet treatment that won', async ({ page }) => {
        await openConfig(page);

        const config = await labelStyle(page, 'config-tile-label');
        expect(config.transform, 'the labels are upper case again').toBe('none');
    });
});
