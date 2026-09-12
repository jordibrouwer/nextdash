// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * A config panel is one subject, and its heading names that subject.
 *
 * Appearance's "Theme" had grown into a catch-all: eleven fields across four
 * subjects -- the palette, how it is drawn, the texture behind it, and what
 * happens to your bookmark icons -- at 1046px, beside panels of 203 and 327.
 *
 * Split by what a setting is about, not by how many fit. The fields, their
 * controls and their order within a subject are untouched.
 */

async function openTab(page, section, tab) {
    await page.setViewportSize({ width: 1500, height: 1100 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => !!window.dashboardInstance?.config, null, { timeout: 20_000 });
    await page.evaluate(([s, t]) => {
        const c = window.dashboardInstance.config;
        c.openConfigView(s);
        if (t) c.switchAppearanceTab?.(t);
    }, [section, tab]);
    await page.waitForSelector('.config-panel-title', { timeout: 20_000 });
}

/** Every panel on screen: its heading, its height, and how many fields it holds. */
const panels = (page) => page.evaluate(() =>
    [...document.querySelectorAll('.config-view-body .config-panel')].map((panel) => ({
        title: (panel.querySelector('.config-panel-title')?.textContent || '').trim(),
        height: Math.round(panel.getBoundingClientRect().height),
        fields: panel.querySelectorAll(':scope > .config-field, :scope > .config-field-row').length,
    })).filter((p) => p.fields > 0));

test.describe('appearance panels', () => {
    test('the theme panel is the theme, and nothing else', async ({ page }) => {
        await openTab(page, 'appearance', 'general');
        const found = await panels(page);
        const titles = found.map((p) => p.title);

        // The three subjects that used to sit inside Theme now say so.
        for (const name of ['Surfaces', 'Backdrop', 'Favicons']) {
            expect(titles, `no panel named ${name}`).toContain(name);
        }
    });

    test('and no panel on the tab is a catch-all any more', async ({ page }) => {
        await openTab(page, 'appearance', 'general');
        const found = await panels(page);

        for (const panel of found) {
            // Eleven fields was the Theme panel. Five is generous for one
            // subject and still catches a panel growing back into a list.
            expect(panel.fields, `${panel.title} carries ${panel.fields} fields`).toBeLessThanOrEqual(5);
        }
    });

    test('the tallest panel is no longer three times the shortest', async ({ page }) => {
        await openTab(page, 'appearance', 'general');
        const heights = (await panels(page)).map((p) => p.height);

        const ratio = Math.max(...heights) / Math.min(...heights);
        // 1046 against 203 was five to one. Panels carry different things and
        // will never match, but a page of blocks should read as blocks.
        expect(ratio, `panels run ${Math.min(...heights)}px to ${Math.max(...heights)}px`).toBeLessThan(3);
    });
});
