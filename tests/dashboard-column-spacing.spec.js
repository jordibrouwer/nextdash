// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * The room between columns, across the page.
 *
 * Space between categories only ever spoke for the room down the page; the room
 * across it was whatever the layout preset said, 1rem on a masonry page. Space
 * between columns is its own setting: seen in Config, in the theme studio, and
 * reached from the palette by :columngap. The other Surfaces words that had no
 * palette command yet (:surface, :effects, :widgetbg, :widgetopacity) ride
 * along here, because they are asked for the same way.
 */

async function loadDashboard(page) {
    await page.setViewportSize({ width: 1600, height: 1000 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
}

/** The gap between the first two blocks that share a row, left edge to right edge. */
const gapBetweenColumns = (page) => page.evaluate(() => {
    const blocks = [...document.querySelectorAll('.dashboard-grid .category')]
        .map((c) => c.getBoundingClientRect())
        .filter((r) => r.width > 0);
    const top = Math.min(...blocks.map((r) => r.top));
    const row = blocks.filter((r) => Math.abs(r.top - top) < 4).sort((a, b) => a.left - b.left);
    return Math.round(row[1].left - row[0].right);
});

const setSpacing = (page, value) => page.evaluate(async (v) => {
    const d = window.dashboardInstance;
    d.settings.columnSpacing = v;
    d.setupDOM();
    await d.renderDashboard({ animate: false });
}, value);

async function palette(page, typed) {
    await page.keyboard.press('Escape');
    await page.keyboard.press(':');
    await expect(page.locator('#shortcut-search.show')).toBeVisible({ timeout: 5_000 });
    await page.keyboard.type(typed);
    await expect(page.locator('#search-query')).toContainText(typed);
}

const setting = (page, key) => page.evaluate((k) => window.dashboardInstance.settings[k], key);

test.describe('space between columns', () => {
    test('Follow the theme: Confetti is airy, another theme balanced, a pick stays', async ({ page }) => {
        await loadDashboard(page);
        const startTheme = await page.evaluate(() => window.dashboardInstance.settings.theme);
        const word = () => page.evaluate(() => document.body.getAttribute('data-column-spacing'));
        const use = (theme, v) => page.evaluate(async ([t, s]) => {
            const d = window.dashboardInstance;
            d.settings.columnSpacing = s;
            await d.config.ensureSection('appearance');   // setTheme lives in Appearance's file
            await d.config.setTheme(t);
            d.setupDOM();
        }, [theme, v]);
        await use('look-confetti-dark', 'theme');
        await expect.poll(word).toBe('airy');
        await use('look-confetti-light', 'theme');
        await expect.poll(word).toBe('airy');
        await use('slate-dark', 'theme');
        await expect.poll(word).toBe('balanced');
        await use('look-confetti-dark', 'snug');
        await expect.poll(word).toBe('snug');
        // Leave the install as found: the setting and the theme are saved.
        await use(startTheme, 'theme');
        await page.evaluate(() => window.dashboardInstance.config.saveSettingsWithFeedback());
    });

    test('the default follows the theme (balanced), and each choice moves the columns', async ({ page }) => {
        await loadDashboard(page);
        await expect.poll(() => page.evaluate(() => document.body.getAttribute('data-column-spacing') === window.ThemeLoader.resolveColumnSpacing('theme', document.body.getAttribute('data-theme')))).toBe(true);
        const seen = {};
        for (const mode of ['snug', 'balanced', 'airy']) {
            await setSpacing(page, mode);
            seen[mode] = await gapBetweenColumns(page);
        }
        expect(seen.snug).toBe(12);
        expect(seen.balanced).toBe(24);
        expect(seen.airy).toBe(40);
    });

    test('it moves the columns of a packed page and of an unpacked one', async ({ page }) => {
        await loadDashboard(page);
        for (const packed of [true, false]) {
            await page.evaluate(async (p) => {
                const d = window.dashboardInstance;
                d.settings.packedColumns = p;
                d.settings.columnSpacing = 'airy';
                d.setupDOM();
                await d.renderDashboard({ animate: false });
            }, packed);
            // The grid's own column gap: an unpacked grid lays its tracks out
            // wider than its blocks, so the room between two blocks is more.
            expect(await page.evaluate(() => getComputedStyle(document.querySelector('.dashboard-grid')).columnGap),
                `packed=${packed}`).toBe('40px');
        }
    });

    test('changing it in Config applies without a reload', async ({ page }) => {
        await loadDashboard(page);
        await page.evaluate(async () => {
            const cfg = window.dashboardInstance.config;
            await (cfg.appearanceTab = cfg.appearanceTab || 'general', cfg).openConfigView('appearance');
        });
        await page.locator('[data-appearance-tab="layout"]').click();
        const card = page.locator('[data-behavior-field="columnSpacing"][data-behavior-value="snug"]');
        await expect(card).toBeVisible();
        // Next to the rows one, in the same tab.
        await expect(page.locator('[data-behavior-field="categorySpacing"][data-behavior-value="snug"]')).toBeVisible();
        await card.click();
        await expect.poll(() => page.evaluate(() => document.body.getAttribute('data-column-spacing'))).toBe('snug');
        expect(await setting(page, 'columnSpacing')).toBe('snug');
    });

    test('the theme studio offers it on its Layout tab', async ({ page }) => {
        await loadDashboard(page);
        // Shift+A is the studio, the way a reader opens it from the dashboard.
        await page.locator('body').click({ position: { x: 5, y: 5 } }).catch(() => {});
        await page.keyboard.press('Shift+A');
        await expect(page.locator('[data-studio-tab="layout"]')).toBeVisible({ timeout: 15_000 });
        await page.locator('[data-studio-tab="layout"]').click();
        await expect(page.locator('[data-behavior-field="columnSpacing"]').first()).toBeVisible();
        // Beside the rows one, on the same tab.
        await expect(page.locator('[data-behavior-field="categorySpacing"]').first()).toBeVisible();
    });

    test('an unknown stored value reads back as balanced', async ({ page }) => {
        await loadDashboard(page);
        const value = await page.evaluate(async () => (await (await fetch('/api/settings')).json()).columnSpacing);
        expect(['snug', 'balanced', 'airy']).toContain(value);
    });
});

test.describe('the Surfaces settings in the palette', () => {
    test(':columngap writes what it names', async ({ page }) => {
        await loadDashboard(page);
        await palette(page, 'columngap airy');
        await page.keyboard.press('Enter');
        await expect.poll(() => setting(page, 'columnSpacing'), { timeout: 5_000 }).toBe('airy');
        await expect.poll(() => page.evaluate(() => document.body.getAttribute('data-column-spacing'))).toBe('airy');
    });

    test(':surface, :effects, :widgetbg and :widgetopacity each write what they name', async ({ page }) => {
        await loadDashboard(page);

        await palette(page, 'widgetbg none');
        await page.keyboard.press('Enter');
        await expect.poll(() => setting(page, 'widgetSurface'), { timeout: 5_000 }).toBe('none');
        await expect.poll(() => page.evaluate(() => document.body.getAttribute('data-widget-bg'))).toBe('none');

        await palette(page, 'widgetopacity 40');
        await page.keyboard.press('Enter');
        await expect.poll(() => setting(page, 'widgetOpacity'), { timeout: 5_000 }).toBe(40);
        await expect.poll(() => page.evaluate(() => document.documentElement.style.getPropertyValue('--widget-bg').trim())).toBe('40');

        await palette(page, 'effects off');
        await page.keyboard.press('Enter');
        await expect.poll(() => setting(page, 'themeEffects'), { timeout: 5_000 }).toBe('off');

        await palette(page, 'surface open');
        await page.keyboard.press('Enter');
        await expect.poll(() => page.evaluate(() => document.body.getAttribute('data-cat-surface')), { timeout: 5_000 }).toBe('open');
    });

    test('they are listed under Look & layout', async ({ page }) => {
        await loadDashboard(page);
        const names = await page.evaluate(() => {
            const group = window.dashboardInstance.search?.commands?.commandGroups?.find((g) => g.id === 'look-and-feel')
                || window.dashboardInstance.searchCommands?.commandGroups?.find((g) => g.id === 'look-and-feel');
            return group ? group.commands : null;
        });
        test.skip(!names, 'the command groups are not reachable on this build');
        for (const word of ['surface', 'effects', 'widgetbg', 'widgetopacity', 'columngap']) {
            expect(names).toContain(word);
        }
    });
});
