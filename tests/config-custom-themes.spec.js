// @ts-check
const { test, expect } = require('@playwright/test');
const { dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * Start from no custom themes.
 *
 * These specs share one dev server, so themes left by an earlier test would
 * make any count assertion drift. Clearing through the API keeps each test
 * independent of the order they run in.
 */
async function resetCustomThemes(page) {
    await page.evaluate(async () => {
        // Writes need the app's own fetch wrapper: a plain fetch has no write
        // token and the server answers 401.
        const cfg = window.dashboardInstance.config;
        const colors = await (await fetch('/api/colors')).json();
        colors.custom = {};
        await cfg.writeFetch('/api/colors', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(colors),
        });
        if (String(window.dashboardInstance.settings.theme || '').startsWith('theme-')) {
            window.dashboardInstance.settings.theme = 'cherry-graphite-dark';
            await window.dashboardInstance.saveSettings?.();
        }
        cfg._colorsData = null;
        cfg._themeSelected = null;
        cfg._themeList = null;
    });
}

async function openCustomThemes(page) {
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await resetCustomThemes(page);
    await page.reload();
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.evaluate(() => window.dashboardInstance.config.openConfigView('appearance'));
    await page.locator('[data-appearance-tab="custom-themes"]').click();
    await expect(page.locator('[data-theme-add]')).toBeVisible();
}

test.describe('custom theme editor', () => {
    test('Appearance is split into General and Custom themes', async ({ page }) => {
        await page.goto('/');
        await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
        await dismissOnboardingIfPresent(page);
        await dismissBlockingOverlays(page);
        await page.evaluate(() => window.dashboardInstance.config.openConfigView('appearance'));
        await expect(page.locator('[data-appearance-tab]')).toHaveCount(2);
        await expect(page.locator('[data-appearance-tab="general"]')).toBeVisible();
        await expect(page.locator('[data-appearance-tab="custom-themes"]')).toBeVisible();
    });

    test('adding a theme copies a full palette and opens its editor', async ({ page }) => {
        await openCustomThemes(page);
        await page.locator('[data-theme-add]').click();
        await expect(page.locator('[data-theme-row]')).toHaveCount(1);
        await expect(page.locator('#config-theme-editor')).toBeVisible();
        // All twelve ThemeColors fields are editable.
        await expect(page.locator('[data-theme-color]')).toHaveCount(12);

        // A new theme must start from a real palette: blank colours would render
        // the dashboard with empty CSS variables.
        const stored = await page.evaluate(async () => {
            const c = await (await fetch('/api/colors')).json();
            const id = Object.keys(c.custom)[0];
            return c.custom[id];
        });
        expect(stored.textPrimary).toBeTruthy();
        expect(stored.backgroundPrimary).toBeTruthy();
        expect(stored.name).toBeTruthy();
    });

    test('editing a colour previews live and saves on commit', async ({ page }) => {
        await openCustomThemes(page);
        await page.locator('[data-theme-add]').click();
        await expect(page.locator('#config-theme-editor')).toBeVisible();

        const field = page.locator('[data-theme-color="backgroundPrimary"]');
        await field.fill('#123456');
        // /api/theme.css writes on html[data-theme="…"], so a :root preview
        // would lose on specificity and silently do nothing.
        await expect.poll(() => page.evaluate(() =>
            getComputedStyle(document.documentElement).getPropertyValue('--background-primary').trim()))
            .toBe('#123456');

        await field.blur();
        await expect.poll(() => page.evaluate(async () => {
            const c = await (await fetch('/api/colors')).json();
            return c.custom[Object.keys(c.custom)[0]].backgroundPrimary;
        }), { timeout: 10_000 }).toBe('#123456');
    });

    test('an unparseable colour is refused and the field put back', async ({ page }) => {
        await openCustomThemes(page);
        await page.locator('[data-theme-add]').click();
        await expect(page.locator('#config-theme-editor')).toBeVisible();
        const field = page.locator('[data-theme-color="textPrimary"]');
        const original = await field.inputValue();
        await field.fill('not-a-colour');
        await field.blur();
        // Saving it would store a value that renders as an empty CSS variable.
        await expect(field).toHaveValue(original);
    });

    test('a custom theme can be applied and survives a reload', async ({ page }) => {
        await openCustomThemes(page);
        await page.locator('[data-theme-add]').click();
        await expect(page.locator('#config-theme-editor')).toBeVisible();
        await page.locator('[data-theme-color="backgroundPrimary"]').fill('#123456');
        await page.locator('[data-theme-color="backgroundPrimary"]').blur();
        await page.waitForTimeout(500);
        await page.locator('[data-theme-action="apply"]').click();

        const id = await page.evaluate(() => window.dashboardInstance.settings.theme);
        expect(id).toMatch(/^theme-/);
        // The server used to reject any id that was not packaged, silently
        // rewriting it to the default, so the choice never stuck.
        await expect.poll(async () => page.evaluate(async () =>
            (await (await fetch('/api/settings')).json()).theme), { timeout: 10_000 }).toBe(id);

        // And its colours have to reach the generated stylesheet.
        const css = await page.evaluate(async (themeId) => {
            const text = await (await fetch(`/api/theme.css?b=${Date.now()}`)).text();
            const block = text.split('\n\n').find((b) => b.includes(`data-theme="${themeId}"`)) || '';
            return (block.match(/--background-primary:\s*([^;]+)/) || [])[1]?.trim();
        }, id);
        expect(css).toBe('#123456');

        await page.reload();
        await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
        await dismissOnboardingIfPresent(page);
        await expect.poll(() => page.evaluate(() =>
            document.documentElement.getAttribute('data-theme'))).toBe(id);
    });

    test('a saved theme appears in the theme picker', async ({ page }) => {
        await openCustomThemes(page);
        await page.locator('[data-theme-add]').click();
        await expect(page.locator('[data-theme-name]')).toHaveCount(1);
        await page.locator('[data-theme-name]').first().fill('Midnight Blue');
        await page.locator('[data-theme-name]').first().blur();
        await page.waitForTimeout(800);

        // The picker is built from a cached custom-themes response, so the
        // cache has to be dropped when a theme is added or renamed.
        await page.locator('[data-appearance-tab="general"]').click();
        await expect.poll(async () => (await page.locator('[data-appearance-select="theme"] option')
            .allTextContents()).some((t) => t.includes('Midnight Blue')), { timeout: 10_000 }).toBe(true);
    });

    test('themes can be duplicated and deleted, with a confirmation', async ({ page }) => {
        await openCustomThemes(page);
        await page.locator('[data-theme-add]').click();
        await expect(page.locator('#config-theme-editor')).toBeVisible();

        await page.locator('[data-theme-action="duplicate"]').click();
        await expect(page.locator('[data-theme-row]')).toHaveCount(2);

        await page.locator('[data-theme-delete]').first().click();
        await expect(page.locator('#config-confirm-modal')).toBeVisible();
        await page.locator('[data-confirm="ok"]').click();
        await expect(page.locator('[data-theme-row]')).toHaveCount(1);
    });

    test('two themes cannot share a name', async ({ page }) => {
        await openCustomThemes(page);
        await page.locator('[data-theme-add]').click();
        await expect(page.locator('#config-theme-editor')).toBeVisible();
        await page.locator('[data-theme-action="duplicate"]').click();
        await expect(page.locator('[data-theme-row]')).toHaveCount(2);

        const first = await page.locator('[data-theme-name]').nth(0).inputValue();
        const second = page.locator('[data-theme-name]').nth(1);
        await second.fill(first);
        await second.blur();
        await expect(second).not.toHaveValue(first);
    });

    test('packaged and base themes are editable from the same tab', async ({ page }) => {
        await openCustomThemes(page);
        // The old embedded editor was the only way to recolour these; removing
        // it would have made them unreachable.
        await page.selectOption('[data-theme-base-select]', 'dark');
        await expect(page.locator('#config-theme-editor')).toHaveAttribute('data-theme-editing', 'dark');
        await expect(page.locator('[data-theme-color]')).toHaveCount(12);
        // Renaming and deleting are for custom themes only.
        await expect(page.locator('[data-theme-action="reset"]')).toBeVisible();

        const field = page.locator('[data-theme-color="accentSuccess"]');
        await field.fill('#aa3366');
        await field.blur();
        await expect.poll(() => page.evaluate(async () =>
            (await (await fetch('/api/colors')).json()).dark.accentSuccess), { timeout: 10_000 }).toBe('#aa3366');
    });

    test('resetting the packaged themes keeps your own', async ({ page }) => {
        await openCustomThemes(page);
        await page.locator('[data-theme-add]').click();
        await expect(page.locator('[data-theme-row]')).toHaveCount(1);

        await page.selectOption('[data-theme-base-select]', 'dark');
        await page.locator('[data-theme-color="accentSuccess"]').fill('#aa3366');
        await page.locator('[data-theme-color="accentSuccess"]').blur();
        await page.waitForTimeout(500);

        await page.locator('[data-theme-action="reset"]').click();
        await expect(page.locator('#config-confirm-modal')).toBeVisible();
        await page.locator('[data-confirm="ok"]').click();

        await expect.poll(() => page.evaluate(async () =>
            (await (await fetch('/api/colors')).json()).dark.accentSuccess), { timeout: 10_000 })
            .not.toBe('#aa3366');
        await expect(page.locator('[data-theme-row]')).toHaveCount(1);
    });
});
