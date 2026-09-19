// @ts-check
const { test, expect } = require('./fixtures');
const { dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * A custom theme can say everything a packaged one can: the theme colour and
 * the info accent, and its character -- corners, glass, glow, category titles
 * and backdrop. It can be a light/dark pair, and a file carries all of it.
 */

const colors = (page) => page.evaluate(async () => (await fetch('/api/colors')).json());

async function openEditor(page) {
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.evaluate(async () => {
        const cfg = window.dashboardInstance.config;
        const c = await (await fetch('/api/colors')).json();
        c.custom = {};
        await cfg.writeFetch('/api/colors', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(c),
        });
        const d = window.dashboardInstance;
        if (String(d.settings.theme || '').startsWith('theme-')) {
            d.settings.theme = 'cherry-graphite-dark';
            await d.saveSettings?.();
        }
        cfg._colorsData = null;
        cfg._themeSelected = null;
        cfg.appearanceTab = 'general';
        await cfg.openConfigView('appearance');
    });
    await page.locator('[data-appearance-goto="custom-themes"]').click();
    await page.locator('[data-theme-add]').click();
    await expect(page.locator('#config-theme-editor')).toBeVisible();
    await page.locator('[data-theme-character] > summary').click();
    return page.evaluate(() => window.dashboardInstance.config._themeSelected);
}

const cssVar = (page, name) => page.evaluate((n) =>
    getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name);

test('a corner setting previews live, saves, and survives a reload', async ({ page }) => {
    const id = await openEditor(page);
    const range = page.locator('[data-theme-char="radiusScale"]');
    await range.fill('0.05');
    await expect.poll(() => cssVar(page, '--theme-radius-scale')).toBe('0.05');
    await expect.poll(async () => (await colors(page)).custom[id].radiusScale).toBe(0.05);

    // Served back by /api/theme.css once applied, not only by the preview.
    await page.locator('[data-theme-action="apply"]').click();
    await page.reload();
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await expect.poll(() => cssVar(page, '--theme-radius-scale')).toBe('0.05');
});

test('glow can be switched off, and back to automatic', async ({ page }) => {
    const id = await openEditor(page);
    await page.locator('[data-theme-glow-mode]').selectOption('none');
    await expect.poll(async () => (await colors(page)).custom[id].surfaceGlow).toBe(-1);
    await page.locator('[data-theme-char-reset="surfaceGlow"]').click();
    await expect.poll(async () => (await colors(page)).custom[id].surfaceGlow).toBeUndefined();
});

test('titles, weight and backdrop are kept', async ({ page }) => {
    const id = await openEditor(page);
    await page.locator('[data-theme-char-choice="labelTransform"][data-value="uppercase"]').click();
    await page.locator('[data-theme-char-select="labelWeight"]').selectOption('800');
    await page.locator('[data-theme-char-select="backdrop"]').selectOption('rings');
    await expect.poll(async () => {
        const t = (await colors(page)).custom[id];
        return [t.labelTransform, t.labelWeight, t.backdrop];
    }).toEqual(['uppercase', 800, 'rings']);
    await expect.poll(() => cssVar(page, '--theme-label-transform')).toBe('uppercase');
});

test('the theme colour is optional: empty goes back to derived', async ({ page }) => {
    const id = await openEditor(page);
    const field = page.locator('[data-theme-color="accentPrimary"]');
    await field.fill('#aa2255');
    await field.blur();
    await expect.poll(async () => (await colors(page)).custom[id].accentPrimary).toBe('#aa2255');
    await expect.poll(() => cssVar(page, '--accent-primary')).toBe('#aa2255');

    await field.fill('');
    await field.blur();
    await expect.poll(async () => (await colors(page)).custom[id].accentPrimary || '').toBe('');
});

test('editing a custom theme leaves the packaged themes their character', async ({ page }) => {
    const before = (await page.request.get('/api/colors').then((r) => r.json())).builtIn;
    const withCharacter = Object.entries(before).filter(([, t]) => t.radiusScale || t.labelTransform || t.surfaceAlpha);
    expect(withCharacter.length).toBeGreaterThan(0);

    await openEditor(page);
    await page.locator('[data-theme-char="radiusScale"]').fill('1.2');
    await page.waitForTimeout(600);

    const after = (await colors(page)).builtIn;
    for (const [themeId, t] of withCharacter) {
        expect([after[themeId].radiusScale, after[themeId].labelTransform, after[themeId].surfaceAlpha],
            `${themeId} lost its character`).toEqual([t.radiusScale, t.labelTransform, t.surfaceAlpha]);
    }
});

test('a theme file carries the character there and back', async ({ page }) => {
    const id = await openEditor(page);
    await page.locator('[data-theme-char="radiusScale"]').fill('0.4');
    await page.locator('[data-theme-char-select="backdrop"]').selectOption('scanlines');
    await expect.poll(async () => (await colors(page)).custom[id].backdrop).toBe('scanlines');

    const download = page.waitForEvent('download');
    await page.locator(`[data-theme-export="${id}"]`).click();
    const file = await (await download).path();

    await page.locator('#config-theme-import-input').setInputFiles(file);
    await expect.poll(async () => Object.keys((await colors(page)).custom).length).toBe(2);
    const imported = Object.entries((await colors(page)).custom).find(([key]) => key !== id)[1];
    expect([imported.radiusScale, imported.backdrop]).toEqual([0.4, 'scanlines']);
});

test('a light/dark pair is made, and Quick mode switches between its halves', async ({ page }) => {
    const id = await openEditor(page);
    await page.locator('[data-theme-action="apply"]').click();
    await expect.poll(() => page.evaluate(() => window.dashboardInstance.settings.theme)).toBe(id);

    // Applying repaints the tab; open the editor again if that closed it.
    const pair = page.locator('[data-theme-action="pair"]');
    if (!(await pair.isVisible())) {
        if (!(await page.locator('[data-theme-add]').isVisible())) {
            await page.evaluate(() => window.dashboardInstance.config.switchAppearanceTab('custom-themes'));
        }
        if (!(await pair.isVisible())) await page.locator(`[data-theme-edit="${id}"]`).click();
    }
    await pair.click();
    await expect.poll(async () => Object.keys((await colors(page)).custom).sort()).toEqual([`${id}-dark`, `${id}-light`]);

    // The theme in use was renamed with it, so nothing points at the old id.
    const half = await page.evaluate(() => window.dashboardInstance.settings.theme);
    expect([`${id}-dark`, `${id}-light`]).toContain(half);
    const serverTheme = await page.evaluate(async () => (await (await fetch('/api/settings')).json()).theme);
    expect(serverTheme).toBe(half);

    const other = half.endsWith('-dark') ? 'light' : 'dark';
    await page.evaluate((mode) => window.dashboardInstance.config.setQuickMode(mode), other);
    await expect.poll(() => page.evaluate(() => window.dashboardInstance.settings.theme)).toBe(`${id}-${other}`);
});

test('a custom theme can have gloss', async ({ page }) => {
    const id = await openEditor(page);
    await page.locator('[data-theme-char="sheen"]').fill('0.8');
    await expect.poll(() => cssVar(page, '--theme-sheen')).toBe('0.8');
    await expect.poll(async () => (await colors(page)).custom[id].sheen).toBe(0.8);
});
