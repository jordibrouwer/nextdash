// @ts-check
const { test, expect } = require('./fixtures');
const { dismissOnboardingIfPresent, dismissBlockingOverlays, markWhatsNewSeen } = require('./e2e-helpers');

/**
 * A theme choice shows what was chosen: Automatic on a packaged theme means as
 * shipped, :theme pairs with the OS, the studio shows its pick under Random
 * theme, and a duplicate is not filed under the packaged set.
 */
async function open(page) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => !!window.dashboardInstance?.config, null, { timeout: 15_000 });
    await page.evaluate(() => window.dashboardInstance.config.loadColorsData());
}

test('Automatic on a packaged theme writes the shipped value back', async ({ page }) => {
    await open(page);
    const out = await page.evaluate(async () => {
        const cfg = window.dashboardInstance.config;
        let id = null; let shipped;
        for (const key of Object.keys(cfg._colorsData.builtIn || {})) {
            const res = await (await fetch(`/api/themes/defaults?id=${encodeURIComponent(key)}`)).json();
            if (Number(res?.defaults?.radiusScale) > 0) { id = key; shipped = res.defaults.radiusScale; break; }
        }
        if (!id) return 'no packaged theme with a corner setting';
        const theme = { ...cfg.themeById(id), radiusScale: 0.01 };
        let saved = 0;
        const was = { save: cfg.saveColorsData, repaint: cfg.repaintAppearanceBody, preview: cfg.previewThemeColors };
        cfg.saveColorsData = async () => { saved++; };
        cfg.repaintAppearanceBody = () => {};
        cfg.previewThemeColors = () => {};
        const box = document.createElement('div');
        box.innerHTML = '<button data-theme-char-reset="radiusScale"></button>';
        try {
            cfg.bindThemeCharacter(box, id, theme);
            box.querySelector('button').click();
            for (let i = 0; i < 50 && !saved; i++) await new Promise((r) => setTimeout(r, 20));
            return { value: theme.radiusScale, shipped, saved };
        } finally {
            Object.assign(cfg, { saveColorsData: was.save, repaintAppearanceBody: was.repaint, previewThemeColors: was.preview });
        }
    });
    expect(typeof out).toBe('object');
    expect(out.value).toBe(out.shipped);
});

test(':theme draws the half Follow system wants', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await open(page);
    const out = await page.evaluate(async () => {
        const d = window.dashboardInstance;
        await window.SearchLoader?.ensureReady?.();
        const before = { theme: d.settings.theme, auto: d.settings.autoDarkMode };
        const light = 'cherry-graphite-light';
        d.settings.autoDarkMode = true;
        const cmd = new SearchCommandTheme(d.language);
        try {
            await cmd.applyTheme(light);
            return document.documentElement.getAttribute('data-theme');
        } finally {
            d.settings.autoDarkMode = before.auto;
            d.settings.theme = before.theme;
            await d.saveSettings?.();
        }
    });
    expect(out).toBe('cherry-graphite-dark');
});

test('with Random theme on, the studio shows the theme you pick', async ({ page }) => {
    await open(page);
    const shown = await page.evaluate(() => {
        const d = window.dashboardInstance;
        const was = { mode: d.settings.randomThemeMode, theme: d.settings.theme, auto: d.settings.autoDarkMode };
        Object.assign(d.settings, { randomThemeMode: 'refresh', theme: 'cherry-graphite-dark', autoDarkMode: false });
        try {
            return typeof d.config.studioShownTheme === 'function' ? d.config.studioShownTheme() : d.config.displayTheme();
        } finally {
            Object.assign(d.settings, { randomThemeMode: was.mode, theme: was.theme, autoDarkMode: was.auto });
        }
    });
    expect(shown).toBe('cherry-graphite-dark');
});

test('a duplicate of a packaged theme is not filed under its collection', async ({ page }) => {
    await open(page);
    const out = await page.evaluate(async () => {
        const cfg = window.dashboardInstance.config;
        const builtIn = cfg._colorsData.builtIn || {};
        let id = Object.keys(builtIn).find((k) => builtIn[k]?.collection);
        if (!id) {
            id = Object.keys(builtIn)[0];
            builtIn[id] = { ...builtIn[id], collection: 'neutrals' };
        }
        const before = new Set(Object.keys(cfg._colorsData.custom || {}));
        const was = { save: cfg.saveColorsData, repaint: cfg.repaintAppearanceBody };
        cfg.saveColorsData = async () => {};
        cfg.repaintAppearanceBody = () => {};
        try {
            await cfg.handleThemeAction('duplicate', id);
        } finally {
            Object.assign(cfg, { saveColorsData: was.save, repaintAppearanceBody: was.repaint });
        }
        const copyId = Object.keys(cfg._colorsData.custom).find((k) => !before.has(k));
        const copy = cfg._colorsData.custom[copyId];
        delete cfg._colorsData.custom[copyId];
        return { made: Boolean(copy), collection: copy?.collection };
    });
    expect(out).toEqual({ made: true, collection: undefined });
});
