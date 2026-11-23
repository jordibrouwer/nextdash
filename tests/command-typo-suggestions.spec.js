// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * A slip of the fingers in a command name still finds the command.
 *
 * ":dokcer" has no command that starts with it, so the palette used to show
 * nothing. It now offers the nearest names, marked as a guess.
 */

async function dashboard(page) {
    await page.setViewportSize({ width: 1400, height: 900 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('.bookmark-link', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => window.dashboardInstance?.searchComponent != null, null, { timeout: 20_000 });
}

const ask = (page, query) => page.evaluate((q) => {
    const c = window.dashboardInstance.searchComponent.commandsComponent;
    return c.handleCommand(q).map((r) => ({ shortcut: r.shortcut, meta: r.meta || null }));
}, query);

test('a swapped or missing letter offers the real command', async ({ page }) => {
    await dashboard(page);
    const swapped = await ask(page, ':dokcer');
    expect(swapped.map((r) => r.shortcut)).toContain(':DOCKER');
    expect(swapped[0].meta).toBeTruthy();
    const missing = await ask(page, ':helth');
    expect(missing.map((r) => r.shortcut)).toContain(':HEALTH');
});

test('a plain prefix and an exact name are untouched', async ({ page }) => {
    await dashboard(page);
    const prefix = await ask(page, ':doc');
    expect(prefix.every((r) => r.meta === null)).toBe(true);
    expect((await ask(page, ':zzzzzz'))).toEqual([]);
    expect((await ask(page, ':ab'))).toEqual([]);
});

test('an alias is suggested under its listed name, once', async ({ page }) => {
    await dashboard(page);
    // "language" and "feeds" are only spelled in the alias chain.
    expect((await ask(page, ':langauge')).map((r) => r.shortcut)).toContain(':LANG');
    expect((await ask(page, ':fedds')).map((r) => r.shortcut)).toContain(':NEWS');
    // "previews" is a table key too: one row for the command, not two.
    const shortcuts = (await ask(page, ':prevew')).map((r) => r.shortcut);
    expect(shortcuts.filter((s) => s === ':PREVIEW' || s === ':PREVIEWS')).toEqual([':PREVIEW']);
});

test('arguments typed after the slip survive on the completion', async ({ page }) => {
    await dashboard(page);
    const completion = await page.evaluate(() => {
        const c = window.dashboardInstance.searchComponent.commandsComponent;
        return c.handleCommand(':dokcer ps').map((r) => r.completion);
    });
    expect(completion).toContain(':DOCKER ps');
});

test('typed into the palette, the guess shows with its label and Enter completes it', async ({ page }) => {
    await dashboard(page);
    await page.evaluate(() => window.dashboardInstance.searchComponent.closeSearch());
    await page.keyboard.press('Shift+Semicolon');
    await page.keyboard.type(':dokcer');
    const row = page.locator('#search-matches .search-match:has-text(":DOCKER")');
    await expect(row).toHaveCount(1);
    await expect(row).toContainText('Did you mean');
    await page.keyboard.press('Enter');
    await expect.poll(() => page.evaluate(() => window.dashboardInstance.searchComponent.currentQuery)).toMatch(/^:docker\s/i);
});
