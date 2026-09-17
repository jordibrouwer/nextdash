// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * A config panel is one subject, and its heading names that subject.
 *
 * Two panels had grown into catch-alls. Appearance's "Theme" carried eleven
 * fields across four subjects -- the palette, how it is drawn, the texture
 * behind it, and what happens to your bookmark icons -- at 1046px, beside
 * panels of 203 and 327. Behavior's "General" carried eight across three, and
 * "General" is the heading you end up with when a panel is whatever was left
 * over: a reader looking for the key legend had no reason to look under it.
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
        if (s === 'appearance' || s === 'behavior') c[`${s}Tab`] = t || c[`${s}Tab`] || 'general';
        c.openConfigView(s);
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

test.describe('behavior panels', () => {
    /**
     * Weather was five of the eleven fields on the date tab, so a reader
     * setting a date format scrolled past a location, a unit and a refresh
     * interval to reach the clock. The line above the bookmarks is still one
     * line; what is split is the settings behind it.
     */
    test('the date tab separates the clock, the weather and the calendar', async ({ page }) => {
        await openTab(page, 'appearance', 'datetime');
        await expect.poll(async () => (await panels(page)).length).toBeGreaterThan(1);
        const found = await panels(page);

        expect(found.map((p) => p.title), 'the weather has no heading of its own').toContain('Weather');
        expect(found.map((p) => p.title), 'the calendar has no heading of its own').toContain('Calendar');
        for (const panel of found) {
            expect(panel.fields, `${panel.title} carries ${panel.fields} fields`).toBeLessThanOrEqual(5);
        }
    });

    /**
     * "Search" was right while it was the whole tab, and says nothing now that
     * two siblings stand beside it -- so the panel about keystrokes is named
     * for keystrokes, under a key of its own. A fallback cannot override a
     * locale that already answers.
     */
    test('the search tab separates typing from what the list offers', async ({ page }) => {
        await openTab(page, 'behavior', null);
        await page.click('[data-behavior-tab="search"]');
        await expect.poll(async () => (await panels(page)).length).toBeGreaterThan(1);
        const titles = (await panels(page)).map((p) => p.title);

        expect(titles, 'the tab is still one Search block').toContain('Suggestions');
        expect(titles, 'how the overlay behaves has no heading').toContain('The panel');
        expect(titles, 'the typing panel still carries the tab-wide name').not.toContain('Search');
    });

    test('the keyboard and link settings have headings of their own', async ({ page }) => {
        await openTab(page, 'behavior', null);
        const titles = (await panels(page)).map((p) => p.title);

        expect(titles, 'the keyboard settings are still filed under General').toContain('Keyboard');
        expect(titles, 'opening a link has no heading of its own').toContain('Opening links');
    });

    test('and General is no longer whatever was left over', async ({ page }) => {
        await openTab(page, 'behavior', null);
        const general = (await panels(page)).find((p) => p.title === 'General');

        expect(general, 'the General panel is gone entirely').toBeTruthy();
        expect(general.fields, `General still carries ${general.fields} fields`).toBeLessThanOrEqual(4);
    });

    test('every setting that was there is still there', async ({ page }) => {
        await openTab(page, 'behavior', null);

        // Named rather than counted: a split that quietly dropped one would
        // pass a count, and these are the eight that shared the old panel.
        const present = await page.evaluate(() => [
            'language', 'rememberScrollPosition', 'lockLayout', 'globalShortcuts',
            'showShortcutTooltips', 'showGridKeyLegend', 'openInNewTab', 'allowLocalBookmarks',
        ].filter((field) => document.querySelector(`[data-behavior-field="${field}"]`) === null));

        expect(present, 'settings lost in the split').toEqual([]);
    });
});
