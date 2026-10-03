// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays, waitForConfigReady } = require('./e2e-helpers');

/**
 * A theme of your own can bring a look along. Picking it shows that look
 * (saved on Apply in the studio, at once elsewhere); switching halves of the
 * pair does not, and the studio's switch picks a theme without it.
 */

const LOOK = {
    backdrop: 'stars',
    glass: { alpha: 0.5, blur: 9 },
    depth: 'glass',
    heads: { categoryHeaderStyle: 'boxed', showCategoryCount: true },
    text: { fontPreset: 'inter', densityMode: 'compact', categorySpacing: 'airy' },
};

async function ready(page) {
    await page.waitForSelector('.bookmark-link', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await waitForConfigReady(page);
}

async function setup(page) {
    await page.setViewportSize({ width: 1500, height: 900 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await ready(page);
    await page.evaluate(async (look) => {
        try { localStorage.removeItem('nextdash:studio-use-theme-look'); } catch (_) { /* private mode */ }
        const d = window.dashboardInstance;
        const cfg = d.config;
        const c = await (await fetch('/api/colors')).json();
        c.custom = {
            'theme-look-dark': { ...c.dark, name: 'Looker [dark]', look },
            'theme-look-light': { ...c.light, name: 'Looker [light]', look },
        };
        await cfg.writeFetch('/api/colors', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(c) });
        Object.assign(d.settings, { theme: 'cherry-graphite-dark', categoryHeaderStyle: 'clean', fontPreset: 'source-code-pro', densityMode: 'comfortable' });
        await d.saveSettings();
    }, LOOK);
    await page.reload();
    await ready(page);
}

const stored = (page) => page.evaluate(async () => (await fetch('/api/settings')).json());

async function openStudio(page) {
    await page.locator('body').click({ position: { x: 5, y: 5 } }).catch(() => {});
    await page.keyboard.press('Shift+A');
    await expect(page.locator('[data-look-studio]')).toBeVisible({ timeout: 15_000 });
}

test('picking a theme with a look in the studio shows it, and Apply keeps it', async ({ page }) => {
    await setup(page);
    await openStudio(page);
    await page.locator('[data-theme-card][data-theme-id="theme-look-dark"]').click();
    await expect.poll(() => page.evaluate(() => document.body.getAttribute('data-cat-head'))).toBe('boxed');
    expect((await stored(page)).categoryHeaderStyle, 'saved before Apply').toBe('clean');
    await page.locator('[data-studio-apply]').click();
    await expect.poll(async () => (await stored(page)).categoryHeaderStyle).toBe('boxed');
    const s = await stored(page);
    expect(s.fontPreset).toBe('inter');
    expect(s.densityMode).toBe('compact');
    expect(s.categorySpacing).toBe('airy');
});

test('with "Use this theme\'s look" off, picking keeps the look you have', async ({ page }) => {
    await setup(page);
    await openStudio(page);
    await page.locator('[data-studio-theme-look]').uncheck();
    await page.locator('[data-theme-card][data-theme-id="theme-look-dark"]').click();
    await page.locator('[data-studio-apply]').click();
    await expect.poll(async () => (await stored(page)).theme).toBe('theme-look-dark');
    expect((await stored(page)).categoryHeaderStyle).toBe('clean');
});

test('the Appearance picker brings the look and saves it at once', async ({ page }) => {
    await setup(page);
    await page.evaluate(() => window.dashboardInstance.config.openConfigView('appearance'));
    await page.locator('[data-theme-picker-button]').click();
    await page.locator('[data-theme-option="theme-look-dark"]').click();
    await expect.poll(async () => (await stored(page)).categoryHeaderStyle).toBe('boxed');
    expect((await stored(page)).fontPreset).toBe('inter');
});

test('switching halves with Quick mode does not reapply the look', async ({ page }) => {
    await setup(page);
    await page.evaluate(async () => {
        const d = window.dashboardInstance;
        Object.assign(d.settings, { theme: 'theme-look-dark', categoryHeaderStyle: 'underlined' });
        await d.saveSettings();
        await d.config.setQuickMode('light');
    });
    await expect.poll(async () => (await stored(page)).theme).toBe('theme-look-light');
    expect((await stored(page)).categoryHeaderStyle).toBe('underlined');
});

test(':theme brings the look too', async ({ page }) => {
    await setup(page);
    await page.waitForFunction(() => window.dashboardInstance?.searchComponent != null, null, { timeout: 20_000 });
    await page.keyboard.press('Shift+Semicolon');
    await page.keyboard.type('theme looker [dark]');
    const row = page.locator('#search-matches .search-match', { hasText: 'Looker [dark]' });
    await expect(row).toHaveCount(1);
    await page.keyboard.press('Enter');
    await expect.poll(async () => (await stored(page)).theme).toBe('theme-look-dark');
    await expect.poll(async () => (await stored(page)).categoryHeaderStyle).toBe('boxed');
});
