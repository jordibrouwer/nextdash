// @ts-check
const { test, expect } = require('@playwright/test');
const { dismissOnboardingIfPresent, dismissBlockingOverlays, markWhatsNewSeen } = require('./e2e-helpers');

/**
 * Config → Appearance.
 *
 * This section is written out by hand rather than built from a schema, which is
 * why the filter field added to the shared bar did nothing here: filtering
 * happened while the schema rendered, and there was no schema. The rest is
 * about the picker that replaced a native select — it owes the reader what a
 * select gives for free — and about a theme being small enough to hand to
 * someone without shipping a whole backup.
 */

async function openAppearance(page, tab) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.evaluate(() => window.dashboardInstance.config.openConfigView('appearance'));
    await page.waitForSelector('#config-appearance-body', { timeout: 15_000 });
    if (tab) {
        await page.click(`[data-appearance-tab="${tab}"]`);
        await page.waitForTimeout(900);
    }
}

const visiblePanels = (page) => page.evaluate(() =>
    [...document.querySelectorAll('#config-appearance-body .config-panel')]
        .filter((el) => !el.hasAttribute('hidden')).length);

test.describe('the filter reaches hand-written markup', () => {
    test('it narrows, empties and clears', async ({ page }) => {
        await openAppearance(page);
        const all = await visiblePanels(page);
        expect(all).toBeGreaterThan(1);

        const field = page.locator('[data-settings-filter]');
        await field.fill('font');
        await expect.poll(() => visiblePanels(page), { timeout: 5_000 }).toBeLessThan(all);

        // It used to answer every query with "everything", which is worse than
        // having no filter at all.
        await field.fill('zzzznothingatall');
        await expect.poll(() => visiblePanels(page), { timeout: 5_000 }).toBe(0);
        await expect(page.locator('#config-appearance-body [data-filter-empty]')).toBeVisible();

        await field.press('Escape');
        await expect.poll(() => visiblePanels(page), { timeout: 5_000 }).toBe(all);
    });

    test('a row nested in another row is hidden with it', async ({ page }) => {
        await openAppearance(page);
        await page.locator('[data-settings-filter]').fill('zzzznothingatall');
        await page.waitForTimeout(600);
        // Hiding parents and children independently left the child on screen
        // inside a hidden panel, which kept the panel alive.
        const strays = await page.evaluate(() => {
            const host = document.getElementById('config-appearance-body');
            return [...host.querySelectorAll('.config-field, .config-field-row')]
                .filter((row) => !row.hasAttribute('hidden')).length;
        });
        expect(strays).toBe(0);
    });
});

test.describe('the tabs carry their own weight', () => {
    test('Branding is not a tab of its own', async ({ page }) => {
        await openAppearance(page);
        const tabs = await page.locator('[data-appearance-tab]').evaluateAll((els) =>
            els.map((e) => e.getAttribute('data-appearance-tab')));
        // One panel, one toggle, a text field and an upload — not a tab.
        expect(tabs).not.toContain('branding');
        expect(tabs).toContain('display');
    });

    test('its panel is on Display, and the old link still lands on it', async ({ page }) => {
        await markWhatsNewSeen(page);
        await page.goto('/#config/appearance/branding');
        await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
        await dismissOnboardingIfPresent(page);
        await dismissBlockingOverlays(page);

        await expect.poll(() => page.evaluate(() => window.dashboardInstance.config?.appearanceTab),
            { timeout: 15_000 }).toBe('display');
        await expect(page.locator('[data-appearance-toggle="enableCustomTitle"]')).toBeVisible();
    });

    test('Custom themes has no changed bar, by decision', async ({ page }) => {
        await openAppearance(page, 'custom-themes');
        // A list editor has no default to differ from and nothing to filter.
        await expect(page.locator('#config-appearance-body .config-changed-bar')).toHaveCount(0);
        await expect(page.locator('[data-theme-base-select]')).toBeVisible();
    });

    test('the background panel heading is a heading, not a label', async ({ page }) => {
        await openAppearance(page);
        const titles = await page.locator('#config-appearance-body .config-panel-title')
            .evaluateAll((els) => els.map((e) => e.textContent.trim()));
        // backgroundLabel is "Background:" — a field label, used as a heading.
        expect(titles.some((t) => t.endsWith(':'))).toBe(false);
    });
});

test.describe('the picker owes what a select gives free', () => {
    test('typing jumps to a theme by name', async ({ page }) => {
        await openAppearance(page);
        await page.click('[data-theme-picker-button]');
        await page.waitForTimeout(400);
        await page.keyboard.type('te', { delay: 80 });

        await expect.poll(() => page.evaluate(() =>
            document.querySelector('[data-theme-picker-list] .is-active')?.textContent?.trim()),
        { timeout: 5_000 }).toMatch(/^Te/i);

        // Leaving without choosing changes nothing.
        const before = await page.evaluate(() => window.dashboardInstance.settings.theme);
        await page.keyboard.press('Escape');
        await page.waitForTimeout(500);
        expect(await page.evaluate(() => window.dashboardInstance.settings.theme)).toBe(before);
    });
});

test.describe('a size you can see before you pick it', () => {
    test('focusing a type size shows it, leaving puts it back', async ({ page }) => {
        await openAppearance(page);
        // applyFontSize swaps a font-size-* class on <body>, so that is what
        // changing size looks like from here.
        const read = () => page.evaluate(() => ({
            css: [...document.body.classList].find((c) => c.startsWith('font-size-')) || '',
            setting: window.dashboardInstance.settings.fontSize,
        }));

        const before = await read();
        const other = await page.evaluate((current) => {
            const btns = [...document.querySelectorAll('[data-appearance-font]')];
            const target = btns.find((b) => b.getAttribute('data-appearance-font') !== current) || btns[0];
            target.focus();
            return target.getAttribute('data-appearance-font');
        }, before.setting);
        await page.waitForTimeout(300);

        // Small/Medium/Large says nothing about what the grid will look like.
        const during = await read();
        expect(during.css).not.toBe(before.css);
        expect(other).not.toBe(before.setting);

        await page.evaluate(() => document.activeElement?.blur());
        await page.waitForTimeout(300);
        const after = await read();
        // Browsing is not choosing: the stored size never moved.
        expect(after.css).toBe(before.css);
        expect(after.setting).toBe(before.setting);
    });
});

test.describe('a theme can be handed to someone', () => {
    test('exported as a file, and read back as a new theme', async ({ page }) => {
        await openAppearance(page, 'custom-themes');
        if (!(await page.locator('[data-theme-export]').count())) {
            await page.click('[data-theme-add]');
            await page.waitForTimeout(1500);
        }

        const exported = await page.evaluate(async () => {
            const c = window.dashboardInstance.config;
            let blob = null;
            const real = c.triggerDownload.bind(c);
            c.triggerDownload = (b) => { blob = b; };
            c.exportCustomTheme(Object.keys(c._colorsData.custom)[0]);
            c.triggerDownload = real;
            return blob ? JSON.parse(await blob.text()) : null;
        });
        expect(exported?.nextdashTheme).toBe(1);
        expect(Object.keys(exported.colors).length).toBeGreaterThan(5);

        const counts = await page.evaluate(async (payload) => {
            const c = window.dashboardInstance.config;
            const before = Object.keys(c._colorsData.custom).length;
            await c.importCustomTheme(new File([JSON.stringify(payload)], 't.json', { type: 'application/json' }));
            return { before, after: Object.keys(c._colorsData.custom).length };
        }, exported);
        expect(counts.after).toBe(counts.before + 1);
    });

    test('anything else is refused rather than stored', async ({ page }) => {
        await openAppearance(page, 'custom-themes');
        const counts = await page.evaluate(async () => {
            const c = window.dashboardInstance.config;
            const before = Object.keys(c._colorsData.custom || {}).length;
            await c.importCustomTheme(new File(['{"nope":1}'], 'x.json', { type: 'application/json' }));
            await c.importCustomTheme(new File(['not json at all'], 'y.json', { type: 'application/json' }));
            return { before, after: Object.keys(c._colorsData.custom || {}).length };
        });
        expect(counts.after).toBe(counts.before);
    });
});
