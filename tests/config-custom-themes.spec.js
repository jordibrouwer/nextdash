// @ts-check
const { test, expect } = require('./fixtures');
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
    await page.evaluate(() => (window.dashboardInstance.config.appearanceTab = window.dashboardInstance.config.appearanceTab || 'general', window.dashboardInstance.config).openConfigView('appearance'));
    await page.locator('[data-appearance-goto="custom-themes"]').click();
    await expect(page.locator('[data-theme-add]')).toBeVisible();
}

test.describe('custom theme editor', () => {
    test('Appearance is split into General and Custom themes', async ({ page }) => {
        await page.goto('/');
        await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
        await dismissOnboardingIfPresent(page);
        await dismissBlockingOverlays(page);
        await page.evaluate(() => (window.dashboardInstance.config.appearanceTab = window.dashboardInstance.config.appearanceTab || 'general', window.dashboardInstance.config).openConfigView('appearance'));
        // Eight on the strip; Custom themes is a page of Look, reached from it.
        await expect(page.locator('[data-appearance-tab]')).toHaveCount(8);
        await expect(page.locator('[data-appearance-tab="general"]')).toBeVisible();
        await expect(page.locator('[data-appearance-tab="background"]')).toBeVisible();
        await expect(page.locator('[data-appearance-tab="surface"]')).toBeVisible();
        await expect(page.locator('[data-appearance-tab="layout"]')).toBeVisible();
        await expect(page.locator('[data-appearance-tab="display"]')).toBeVisible();
        await expect(page.locator('[data-appearance-tab="header"]')).toBeVisible();
        // Branding is one panel — a toggle, a text field and an upload — so it
        // lives on Display rather than owning a tab of its own.
        await expect(page.locator('[data-appearance-tab="branding"]')).toHaveCount(0);
        // One button reaches that page. It used to be two -- "Open the theme
        // editor…" and "Make your own theme…" both ran switchAppearanceTab to
        // the same tab -- so the count is part of what this pins.
        await expect(page.locator('[data-appearance-goto="custom-themes"]')).toBeVisible();
        await expect(page.locator('[data-appearance-goto="custom-themes"]'),
            'the second button to the same tab is back').toHaveCount(1);
    });

    test('adding a theme copies a full palette and opens its editor', async ({ page }) => {
        await openCustomThemes(page);
        await page.locator('[data-theme-add]').click();
        await expect(page.locator('[data-theme-row]')).toHaveCount(1);
        await expect(page.locator('#config-theme-editor')).toBeVisible();
        // Every colour a theme has is editable: the twelve it always had, the
        // theme's own accent and the info accent.
        await expect(page.locator('[data-theme-color]')).toHaveCount(14);

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
        await expect(page.locator('[data-theme-action="apply"]')).toBeVisible({ timeout: 10_000 });
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
            window.dashboardInstance.settings.theme)).toBe(id);
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
        await expect.poll(async () => (await page.locator('[data-theme-picker-list] [data-theme-option]')
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
        await expect(page.locator('[data-theme-color]')).toHaveCount(14);
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
        await expect(page.locator('#config-theme-editor[data-theme-editing="dark"]')).toBeVisible({ timeout: 10_000 });
        await page.locator('[data-theme-color="accentSuccess"]').fill('#aa3366');
        await page.locator('[data-theme-color="accentSuccess"]').blur();

        await expect(page.locator('[data-theme-action="reset"]')).toBeVisible({ timeout: 10_000 });
        await page.locator('[data-theme-action="reset"]').click();
        await expect(page.locator('#config-confirm-modal')).toBeVisible();
        await page.locator('[data-confirm="ok"]').click();

        await expect.poll(() => page.evaluate(async () =>
            (await (await fetch('/api/colors')).json()).dark.accentSuccess), { timeout: 10_000 })
            .not.toBe('#aa3366');
        await expect(page.locator('[data-theme-row]')).toHaveCount(1);
    });

    test('the Appearance link opens the theme editor tab', async ({ page }) => {
        await page.goto('/');
        await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
        await dismissOnboardingIfPresent(page);
        await dismissBlockingOverlays(page);
        await page.evaluate(() => (window.dashboardInstance.config.appearanceTab = window.dashboardInstance.config.appearanceTab || 'general', window.dashboardInstance.config).openConfigView('appearance'));
        // The old embedded panel is gone; the link is a jump to the tab.
        await expect(page.locator('#config-theme-colors-panel')).toHaveCount(0);
        await page.locator('[data-appearance-goto="custom-themes"]').click();
        await expect(page.locator('[data-theme-add]')).toBeVisible();
        await expect.poll(() => page.evaluate(() =>
            window.dashboardInstance.config.appearanceTab)).toBe('custom-themes');
    });

    test('Look opens Custom themes as a page of its own, with a way back', async ({ page }) => {
        await page.goto('/');
        await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
        await dismissOnboardingIfPresent(page);
        await dismissBlockingOverlays(page);
        await page.evaluate(() => (window.dashboardInstance.config.appearanceTab = 'general', window.dashboardInstance.config).openConfigView('appearance'));

        await page.locator('[data-appearance-goto="custom-themes"]').click();
        await expect.poll(() => page.evaluate(() =>
            window.dashboardInstance.config.appearanceTab)).toBe('custom-themes');
        await expect(page.locator('[data-theme-add]')).toBeVisible();
        // Not a tab on the strip: Look stays lit, since that is where it lives.
        await expect(page.locator('[data-appearance-tab="custom-themes"]')).toHaveCount(0);
        await expect(page.locator('[data-appearance-tab="general"]')).toHaveAttribute('aria-selected', 'true');

        await page.locator('.config-subpage-back').click();
        await expect.poll(() => page.evaluate(() =>
            window.dashboardInstance.config.appearanceTab)).toBe('general');
        await expect(page.locator('[data-theme-add]')).toHaveCount(0);
    });

    test('favicon harmonization persists for a custom theme with auto dark mode', async ({ page }) => {
        await openCustomThemes(page);
        await page.locator('[data-theme-add]').click();
        const customId = await page.evaluate(() => Object.keys(window.dashboardInstance.config._colorsData.custom)[0]);

        await page.locator('[data-appearance-tab="general"]').click();
        await page.evaluate(async (id) => {
            window.dashboardInstance.settings.autoDarkMode = true;
            window.dashboardInstance.config.setTheme(id);
            await window.dashboardInstance.saveSettings?.();
        }, customId);

        await page.locator('[data-appearance-toggle-icons="on"]').click();
        await expect(page.locator('[data-appearance-toggle-icons="on"]')).toHaveAttribute('aria-pressed', 'true');

        await expect.poll(() => page.evaluate(() =>
            window.dashboardInstance.config.iconStylingEntry()?.enabled === true)).toBe(true);

        await page.reload();
        await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
        await dismissOnboardingIfPresent(page);
        await dismissBlockingOverlays(page);

        expect(await page.evaluate(() =>
            window.dashboardInstance.config.iconStylingEntry()?.enabled === true)).toBe(true);

        await page.evaluate(() => (window.dashboardInstance.config.appearanceTab = window.dashboardInstance.config.appearanceTab || 'general', window.dashboardInstance.config).openConfigView('appearance'));
        await expect(page.locator('[data-appearance-toggle-icons="on"]')).toHaveAttribute('aria-pressed', 'true');
    });

    test('favicon harmonization persists after switching to the custom themes tab', async ({ page }) => {
        await openCustomThemes(page);
        await page.locator('[data-theme-add]').click();
        const customId = await page.evaluate(() => Object.keys(window.dashboardInstance.config._colorsData.custom)[0]);

        await page.locator('[data-appearance-tab="general"]').click();
        await page.evaluate(async (id) => {
            window.dashboardInstance.settings.autoDarkMode = true;
            window.dashboardInstance.config.setTheme(id);
            await window.dashboardInstance.saveSettings?.();
        }, customId);

        await page.locator('[data-appearance-toggle-icons="on"]').click();
        await expect(page.locator('[data-appearance-toggle-icons="on"]')).toHaveAttribute('aria-pressed', 'true');
        await expect.poll(() => page.evaluate((id) =>
            window.dashboardInstance.config.iconStylingEntry()?.enabled === true)).toBe(true);

        await page.locator('[data-appearance-goto="custom-themes"]').click();
        await expect(page.locator('[data-theme-add]')).toBeVisible();

        await page.locator('[data-appearance-tab="general"]').click();
        await expect(page.locator('[data-appearance-toggle-icons="on"]')).toHaveAttribute('aria-pressed', 'true');
        expect(await page.evaluate((id) =>
            window.dashboardInstance.config.iconStylingEntry()?.enabled === true)).toBe(true);
    });

    test('favicon harmonization targets the custom theme being edited before Apply', async ({ page }) => {
        await openCustomThemes(page);
        await page.locator('[data-theme-add]').click();
        const customId = await page.evaluate(() => Object.keys(window.dashboardInstance.config._colorsData.custom)[0]);

        // Stay on custom themes with the editor open; do not click Apply yet.
        await expect(page.locator('#config-theme-editor')).toBeVisible();

        await page.locator('[data-appearance-tab="general"]').click();
        await expect.poll(() => page.evaluate((id) =>
            window.dashboardInstance.settings.theme === id, customId)).toBe(true);

        await page.locator('[data-appearance-toggle-icons="on"]').click();
        await expect(page.locator('[data-appearance-toggle-icons="on"]')).toHaveAttribute('aria-pressed', 'true');

        await expect.poll(() => page.evaluate((id) =>
            window.dashboardInstance.config.iconStylingEntry()?.enabled === true)).toBe(true);

        await page.reload();
        await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
        await dismissOnboardingIfPresent(page);
        await dismissBlockingOverlays(page);

        expect(await page.evaluate((id) => ({
            theme: window.dashboardInstance.settings.theme,
            enabled: window.dashboardInstance.config.iconStylingEntry()?.enabled === true,
        }), customId)).toEqual({ theme: customId, enabled: true });
    });

    test('favicon harmonization persists when enabled before colors finish saving', async ({ page }) => {
        await openCustomThemes(page);
        await page.locator('[data-theme-add]').click();
        const customId = await page.evaluate(() => {
            const ids = Object.keys(window.dashboardInstance.config._colorsData.custom);
            return ids[ids.length - 1];
        });

        // Switch to General immediately — do not wait for the colours POST.
        await page.locator('[data-appearance-tab="general"]').click();
        await expect.poll(() => page.evaluate((id) =>
            window.dashboardInstance.settings.theme === id, customId)).toBe(true);

        await page.locator('[data-appearance-toggle-icons="on"]').click();
        await expect(page.locator('[data-appearance-toggle-icons="on"]')).toHaveAttribute('aria-pressed', 'true');
        await expect.poll(() => page.evaluate((id) =>
            window.dashboardInstance.config.iconStylingEntry()?.enabled === true)).toBe(true);

        await page.reload();
        await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
        await dismissOnboardingIfPresent(page);
        await dismissBlockingOverlays(page);

        expect(await page.evaluate((id) => ({
            theme: window.dashboardInstance.settings.theme,
            enabled: window.dashboardInstance.config.iconStylingEntry()?.enabled === true,
        }), customId)).toEqual({ theme: customId, enabled: true });

        await page.evaluate(() => (window.dashboardInstance.config.appearanceTab = window.dashboardInstance.config.appearanceTab || 'general', window.dashboardInstance.config).openConfigView('appearance'));
        await expect(page.locator('[data-appearance-toggle-icons="on"]')).toHaveAttribute('aria-pressed', 'true');
    });
});

// A failed read of /api/colors (server restarting, a proxy's 502) used to be
// kept as an empty colour document for the session; the next Add custom theme
// posted it, deleting every own theme and both palettes.
test('a failed colour read is never saved back over the stored themes', async ({ page }) => {
    await openCustomThemes(page);
    await page.evaluate(async () => {
        const cfg = window.dashboardInstance.config;
        const colors = await (await fetch('/api/colors')).json();
        colors.custom = { 'theme-keepme-0001': { ...(colors.dark || {}), name: 'Keep me' } };
        await cfg.writeFetch('/api/colors', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(colors),
        });
        cfg._colorsData = null;
    });
    await page.route('**/api/colors', (route) => (route.request().method() === 'GET'
        ? route.fulfill({ status: 502, body: 'Bad Gateway' })
        : route.continue()));
    await page.evaluate(() => window.dashboardInstance.config.openCustomThemes());
    await page.locator('[data-theme-add]').click();
    await page.waitForTimeout(500);
    await page.unroute('**/api/colors');
    const stored = await page.evaluate(async () => Object.values((await (await fetch('/api/colors')).json()).custom || {}).map((t) => t.name));
    expect(stored, 'the stored own themes after Add on a failed read').toEqual(['Keep me']);
});

// The server keeps own themes in a map it writes sorted: ↑/↓ lasted until a
// reload.
test('the order of your own themes survives a read back from the server', async ({ page }) => {
    await openCustomThemes(page);
    await page.locator('[data-theme-add]').click();
    await expect(page.locator('[data-theme-row]')).toHaveCount(1);
    await page.locator('[data-theme-add]').click();
    await expect(page.locator('[data-theme-row]')).toHaveCount(2);
    const order = () => page.locator('[data-theme-row]').evaluateAll((rows) => rows.map((r) => r.getAttribute('data-theme-row')));
    const before = await order();
    await page.locator(`[data-theme-move="down"][data-id="${before[0]}"]`).click();
    await expect.poll(order).toEqual([before[1], before[0]]);
    await page.waitForTimeout(800);
    // Read back from the server as a fresh page would.
    const stored = await page.evaluate(async () => {
        const cfg = window.dashboardInstance.config;
        cfg._colorsData = null;
        await cfg.loadColorsData();
        return Object.keys(cfg._colorsData.custom || {});
    });
    expect(stored).toEqual([before[1], before[0]]);
});

// A theme made in another tab or on another device: the settings sync noticed
// (colors.json is in the revision) but never fetched the theme CSS again, so
// picking it drew no colours, and this tab's stale colour document deleted it
// on its next save.
test('a theme made elsewhere reaches this tab with the settings sync', async ({ page }) => {
    await openCustomThemes(page);
    const id = `theme-elsewhere-${Date.now().toString(36)}`;
    await page.evaluate(async (themeId) => {
        const cfg = window.dashboardInstance.config;
        await cfg.loadColorsData();
        // Another tab's write, straight to the server.
        const colors = await (await fetch('/api/colors')).json();
        colors.custom = { ...(colors.custom || {}), [themeId]: { ...(colors.dark || {}), name: 'Elsewhere' } };
        await cfg.writeFetch('/api/colors', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(colors),
        });
        await window.dashboardInstance.data.refreshIfDataRevisionChanged();
    }, id);
    await expect.poll(() => page.evaluate((themeId) =>
        [...document.styleSheets]
            .filter((sheet) => (sheet.href || '').includes('/api/theme.css'))
            .some((sheet) => [...sheet.cssRules].some((rule) => rule.cssText.includes(themeId))), id), { timeout: 10_000 }).toBe(true);
    await expect.poll(() => page.evaluate((themeId) =>
        Boolean(window.dashboardInstance.config._colorsData?.custom?.[themeId]), id), { timeout: 10_000 }).toBe(true);
});
