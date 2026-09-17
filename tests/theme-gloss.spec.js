// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays, waitForFaviconPrefetch } = require('./e2e-helpers');

/**
 * Gloss: themes that catch the light. They set `sheen`, which puts a lit band
 * and a brighter edge on raised surfaces; the browser marks them, and picking
 * one while the glow is off offers to turn it on.
 */

const GLOSS = 'gloss-obsidian-mirror-dark';

async function openBrowser(page, settings = {}) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await waitForFaviconPrefetch(page);
    await page.evaluate(async (next) => {
        const d = window.dashboardInstance;
        Object.assign(d.settings, { glowStrength: 'off', themeDepth: 'rich', randomThemeMode: 'off' }, next);
        await d.saveSettings?.();
        // Start on a matte theme, applied rather than only stored.
        await d.config.applyThemeChoice('moss-stone-dark');
        window.ThemeLoader?.applyGlowStrength?.('off');
        window.ThemeLoader?.applyThemeDepth?.('rich');
        d.config.appearanceTab = 'general';
        await d.config.openConfigView('appearance');
    }, settings);
    await page.locator('[data-appearance-action="browse-themes"]').first().click();
    await expect(page.locator(`[data-theme-id="${GLOSS}"]`).first()).toBeAttached();
    await page.waitForFunction(() => Array.isArray(window.CustomThemeIds), null, { timeout: 15_000 });
}

const sheen = (page) => page.evaluate(() =>
    getComputedStyle(document.body).getPropertyValue('--theme-sheen').trim());

test('gloss themes carry a badge, and have a segment of their own', async ({ page }) => {
    await openBrowser(page);
    const card = page.locator(`[data-theme-id="${GLOSS}"]`).first();
    await expect(card.locator('[data-theme-badge="gloss"]')).toBeVisible();
    // A matte theme has none.
    await expect(page.locator('[data-theme-id="moss-stone-dark"] [data-theme-badge="gloss"]')).toHaveCount(0);

    await page.locator('[data-theme-segment="gloss"]').click();
    const cards = page.locator('[data-theme-card]');
    await expect.poll(() => cards.count()).toBeGreaterThanOrEqual(10);
    expect(await page.locator('[data-theme-card]:not(.is-gloss)').count(), 'a matte theme under Gloss').toBe(0);
});

test('picking a gloss theme with the glow off offers to turn it on', async ({ page }) => {
    await openBrowser(page);
    await page.locator(`[data-theme-id="${GLOSS}"]`).first().click();
    await page.keyboard.press('Enter').catch(() => {});
    await expect.poll(() => page.evaluate(() => window.dashboardInstance.settings.theme)).toBe(GLOSS);

    const offer = page.locator('#app-notification.show');
    await expect(offer).toContainText(/gloss/i);
    await offer.locator('button, .app-notification-action').filter({ hasText: /turn on/i }).first().click();
    await expect.poll(() => page.evaluate(() => window.dashboardInstance.settings.glowStrength)).toBe('soft');
});

test('a gloss theme lights its surfaces; a matte one does not', async ({ page }) => {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    const apply = (id) => page.evaluate(async (theme) => {
        await window.dashboardInstance.config.applyThemeChoice(theme);
    }, id);

    await apply('moss-stone-dark');
    await expect.poll(async () => Number(await sheen(page))).toBe(0);
    await apply(GLOSS);
    await expect.poll(async () => Number(await sheen(page))).toBeGreaterThan(0);
});
