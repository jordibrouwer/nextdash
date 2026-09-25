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

test('gloss themes carry their character as a badge and a chip', async ({ page }) => {
    await openBrowser(page);
    const card = page.locator(`[data-theme-id="${GLOSS}"]`).first();
    // Gloss is the Lacquer character now, so the badge names it and the
    // filter is one chip in a row of twelve rather than a segment of its own.
    await expect(card.locator('[data-theme-badge="lacquer"]')).toBeVisible();
    // A matte theme carries a different one.
    await expect(page.locator('[data-theme-id="moss-stone-dark"] [data-theme-badge="lacquer"]')).toHaveCount(0);

    await page.locator('[data-theme-character="lacquer"]').click();
    const cards = page.locator('[data-theme-card]');
    await expect.poll(() => cards.count()).toBeGreaterThanOrEqual(8);
    expect(await page.locator('[data-theme-card]:not(.is-lacquer)').count(),
        'a theme of another character under Lacquer').toBe(0);
});

test('picking a gloss theme with the glow off offers to turn it on', async ({ page }) => {
    await openBrowser(page);
    await page.locator(`[data-theme-id="${GLOSS}"]`).first().click();
    await page.keyboard.press('Enter').catch(() => {});
    await expect.poll(() => page.evaluate(() => window.dashboardInstance.settings.theme)).toBe(GLOSS);

    const offer = page.locator('#app-notification.show');
    // Says what the theme has, not which group it came from: the offer fires
    // for any theme that shines, most of which are not named Gloss.
    await expect(offer).toContainText(/shine/i);
    await offer.locator('button, .app-notification-action').filter({ hasText: /turn on/i }).first().click();
    // What the page is drawn with: the answer belongs to this theme unless
    // the reader has asked for one glow across every theme, so the setting
    // itself stays on "follow".
    await expect.poll(() => page.evaluate(
        () => document.body.getAttribute('data-glow'))).toBe('soft');
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
