// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays, waitForConfigReady } = require('./e2e-helpers');

/**
 * The theme editor opens inside the look studio. A colour change shows on the
 * page at once and lands on Apply like the rest of the look; Cancel puts it
 * back without anything having been stored.
 */

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
        const cfg = window.dashboardInstance.config;
        const c = await (await fetch('/api/colors')).json();
        c.custom = { 'theme-edit-1': { ...c.dark, name: 'Edit Me', accentSuccess: '#22aa55' } };
        await cfg.writeFetch('/api/colors', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(c) });
    });
    await page.reload();
    await ready(page);
}

const colors = (page) => page.evaluate(async () => (await fetch('/api/colors')).json());
const cssVar = (page, name) => page.evaluate((n) =>
    getComputedStyle(document.documentElement).getPropertyValue(n).trim().toLowerCase(), name);

async function openStudio(page) {
    await page.locator('body').click({ position: { x: 5, y: 5 } }).catch(() => {});
    await page.keyboard.press('Shift+A');
    await expect(page.locator('[data-look-studio]')).toBeVisible({ timeout: 15_000 });
}

async function openEditorInStudio(page) {
    await openStudio(page);
    await page.locator('[data-theme-card][data-theme-id="theme-edit-1"] [data-theme-edit]').click();
    await expect(page.locator('[data-look-studio] #config-theme-editor')).toBeVisible();
}

test('✎ opens the editor in the panel; ← Themes goes back to the grid', async ({ page }) => {
    await setup(page);
    await openEditorInStudio(page);
    await expect(page.locator('[data-studio-tab="themes"]')).toHaveAttribute('aria-selected', 'true');
    // Editing a theme chooses it, so the page shows what is being edited.
    await expect.poll(() => page.evaluate(() => window.dashboardInstance.settings.theme)).toBe('theme-edit-1');
    await page.locator('[data-studio-edit-back]').click();
    await expect(page.locator('[data-theme-grid]')).toBeVisible();
});

test('e on a focused card opens the editor', async ({ page }) => {
    await setup(page);
    await openStudio(page);
    await page.locator('[data-theme-card][data-theme-id="theme-edit-1"]').focus();
    await page.keyboard.press('e');
    await expect(page.locator('[data-look-studio] #config-theme-editor')).toBeVisible();
});

test('a colour previews live; Cancel puts it back and nothing was stored', async ({ page }) => {
    await setup(page);
    await openEditorInStudio(page);
    const posts = [];
    page.on('request', (r) => { if (r.method() === 'POST' && r.url().endsWith('/api/colors')) posts.push(r.url()); });
    const field = page.locator('[data-look-studio] [data-theme-color="accentSuccess"]');
    await field.fill('#ff00ff');
    await field.blur();
    await expect.poll(() => cssVar(page, '--accent-success')).toBe('#ff00ff');
    await expect(page.locator('[data-studio-tab="themes"]')).toHaveClass(/is-dirty/);
    await page.locator('[data-studio-cancel]').click();
    await expect(page.locator('[data-look-studio]')).toHaveCount(0);
    expect(posts, 'colours were posted before Apply').toHaveLength(0);
    expect((await colors(page)).custom['theme-edit-1'].accentSuccess).toBe('#22aa55');
    await expect.poll(() => cssVar(page, '--accent-success')).not.toBe('#ff00ff');
});

test('Apply stores the edited colour', async ({ page }) => {
    await setup(page);
    await openEditorInStudio(page);
    const field = page.locator('[data-look-studio] [data-theme-color="accentSuccess"]');
    await field.fill('#ff00ff');
    await field.blur();
    await page.locator('[data-studio-apply]').click();
    await expect.poll(async () => (await colors(page)).custom['theme-edit-1'].accentSuccess).toBe('#ff00ff');
    await expect.poll(async () => (await (await page.request.get('/api/settings')).json()).theme).toBe('theme-edit-1');
});

test('Reset tab in the editor puts the colours back', async ({ page }) => {
    await setup(page);
    await openEditorInStudio(page);
    const field = page.locator('[data-look-studio] [data-theme-color="accentSuccess"]');
    await field.fill('#ff00ff');
    await field.blur();
    await page.locator('[data-studio-reset]').click();
    await expect(page.locator('[data-look-studio] [data-theme-color="accentSuccess"]')).toHaveValue('#22aa55');
    await expect(page.locator('[data-studio-tab="themes"]')).not.toHaveClass(/is-dirty/);
});

test('Take the look on screen stores it on the theme after Apply', async ({ page }) => {
    await setup(page);
    await openEditorInStudio(page);
    await page.locator('[data-studio-tab="looks"]').click();
    await page.locator('[data-studio-use-look="terminal"]').click();
    await page.locator('[data-studio-edit-link]').click();
    await page.locator('[data-theme-look-take]').click();
    await expect(page.locator('[data-theme-look-parts]')).toContainText('scanlines');
    await page.locator('[data-studio-apply]').click();
    await expect.poll(async () => (await colors(page)).custom['theme-edit-1'].look?.backdrop).toBe('scanlines');
});
