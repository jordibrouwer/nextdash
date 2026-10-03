// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays, waitForConfigReady } = require('./e2e-helpers');

/**
 * Save as theme… turns what is on screen into a theme of your own: the colours
 * of the theme in use, the look when asked, both halves when it has two. The
 * theme is saved at once; picking it waits for Apply like any card.
 */

const colors = (page) => page.evaluate(async () => (await fetch('/api/colors')).json());
const stored = (page) => page.evaluate(async () => (await fetch('/api/settings')).json());

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
    await page.evaluate(async () => {
        const d = window.dashboardInstance;
        const c = await (await fetch('/api/colors')).json();
        c.custom = {};
        await d.config.writeFetch('/api/colors', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(c) });
        d.settings.theme = 'deep-lagoon-dark';
        await d.saveSettings();
    });
    await page.reload();
    await ready(page);
}

async function openStudio(page) {
    await page.locator('body').click({ position: { x: 5, y: 5 } }).catch(() => {});
    await page.keyboard.press('Shift+A');
    await expect(page.locator('[data-look-studio]')).toBeVisible({ timeout: 15_000 });
}

test('Save as theme makes both halves with the look on screen, picks it and opens the editor', async ({ page }) => {
    await setup(page);
    await openStudio(page);
    await page.locator('[data-studio-tab="looks"]').click();
    await page.locator('[data-studio-use-look="night-sky"]').click();
    await page.locator('[data-studio-save-theme]').click();
    const dialog = page.locator('[data-save-theme-dialog]');
    await expect(dialog).toBeVisible();
    await dialog.locator('[data-save-theme-name]').fill('Lagoon Mine');
    await expect(dialog.locator('[data-save-theme-look]')).toBeChecked();
    await expect(dialog.locator('[data-save-theme-pair]')).toBeChecked();
    await dialog.locator('[data-save-theme-submit]').click();
    await expect(page.locator('[data-look-studio] #config-theme-editor')).toBeVisible();
    await expect(dialog).toHaveCount(0);

    const c = await colors(page);
    const mine = Object.entries(c.custom).filter(([, t]) => String(t.name).startsWith('Lagoon Mine'));
    expect(mine.length, 'two halves').toBe(2);
    mine.forEach(([, t]) => expect(t.look?.backdrop).toBe('stars'));
    // The light half is the packaged light half's palette, not one made up.
    const light = mine.find(([id]) => id.endsWith('-light'))[1];
    expect(light.backgroundPrimary).toBe(c.builtIn['deep-lagoon-light'].backgroundPrimary);

    // The pick is gated like any other: stored on Apply.
    expect((await stored(page)).theme).toBe('deep-lagoon-dark');
    await page.locator('[data-studio-apply]').click();
    await expect.poll(async () => (await stored(page)).theme).toMatch(/^theme-.*-dark$/);
});

test('Cancel after Save as theme keeps the theme but puts the previous one back', async ({ page }) => {
    await setup(page);
    await openStudio(page);
    await page.locator('[data-studio-save-theme]').click();
    await page.locator('[data-save-theme-dialog] [data-save-theme-submit]').click();
    await expect(page.locator('[data-look-studio] #config-theme-editor')).toBeVisible();
    await page.locator('[data-studio-cancel]').click();
    await expect(page.locator('[data-look-studio]')).toHaveCount(0);
    expect(Object.keys((await colors(page)).custom).length).toBeGreaterThan(0);
    expect((await stored(page)).theme).toBe('deep-lagoon-dark');
});

test('Escape closes the dialog and leaves the studio open', async ({ page }) => {
    await setup(page);
    await openStudio(page);
    await page.locator('[data-studio-save-theme]').click();
    await expect(page.locator('[data-save-theme-dialog]')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-save-theme-dialog]')).toHaveCount(0);
    await expect(page.locator('[data-look-studio]')).toBeVisible();
    expect(Object.keys((await colors(page)).custom)).toHaveLength(0);
});
