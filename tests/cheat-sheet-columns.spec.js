// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays, prepareDashboardInteraction } = require('./e2e-helpers');

/**
 * The cheat sheet as columns: one small card per section, a row per shortcut
 * showing only what it does, and a dock under the columns that shows the keys
 * of the row you chose.
 */

async function openSheet(page, view = '') {
    await page.setViewportSize({ width: 1280, height: 800 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 20_000 });
    await prepareDashboardInteraction(page);
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    if (view === 'inbox') {
        await page.keyboard.press('Shift+I');
        await expect.poll(() => page.evaluate(() => window.dashboardInstance?.activeView)).toBe('inbox');
    }
    // Through the key someone presses, not through the renderer.
    await page.keyboard.press('Shift+Digit1');
    await page.waitForSelector('.keyboard-cheat-sheet .cheat-sheet-group', { timeout: 20_000 });
}

test.describe('cheat sheet columns', () => {
    test('sections render as cards and rows carry no keys until chosen', async ({ page }) => {
        await openSheet(page);
        const cards = page.locator('.keyboard-cheat-sheet .cheat-sheet-group');
        expect(await cards.count()).toBeGreaterThanOrEqual(3);
        await expect(page.locator('.cheat-sheet-row').first()).toBeVisible();
        await expect(page.locator('.cheat-sheet-row kbd, .cheat-sheet-row .keyboard-cheat-sheet-keys')).toHaveCount(0);
        await expect(page.locator('.cheat-sheet-dock kbd')).toHaveCount(0);
        // Several cards stand side by side.
        const lefts = await cards.evaluateAll((els) => new Set(els.filter((e) => e.getBoundingClientRect().height > 0).map((e) => Math.round(e.getBoundingClientRect().left))).size);
        expect(lefts, 'the cards are in one column').toBeGreaterThanOrEqual(3);
    });

    test('clicking a row shows its keys and description in the dock', async ({ page }) => {
        await openSheet(page);
        const row = page.locator('.cheat-sheet-row').nth(2);
        const text = ((await row.textContent()) || '').trim();
        await row.click();
        await expect(row).toHaveAttribute('aria-pressed', 'true');
        const dock = page.locator('#cheat-sheet-dock');
        await expect(dock).toHaveAttribute('aria-live', 'polite');
        await expect(dock.locator('.cheat-sheet-dock-text')).toHaveText(text);
        expect(await dock.locator('.keyboard-cheat-sheet-keys').innerText()).toMatch(/\S/);
    });

    test('Enter on a focused row does the same', async ({ page }) => {
        await openSheet(page);
        const row = page.locator('.cheat-sheet-row').nth(3);
        const text = ((await row.textContent()) || '').trim();
        await row.focus();
        await page.keyboard.press('Enter');
        await expect(row).toHaveAttribute('aria-pressed', 'true');
        await expect(page.locator('#cheat-sheet-dock .cheat-sheet-dock-text')).toHaveText(text);
        await expect(page.locator('#cheat-sheet-dock .keyboard-cheat-sheet-keys')).toBeVisible();
    });

    test('arrow keys walk the rows', async ({ page }) => {
        await openSheet(page);
        await page.locator('#cheat-sheet-filter').focus();
        await page.keyboard.press('ArrowDown');
        const first = await page.evaluate(() => document.activeElement?.className);
        expect(first).toContain('cheat-sheet-row');
        const id1 = await page.evaluate(() => document.activeElement?.getAttribute('data-shortcut-id'));
        await page.keyboard.press('ArrowDown');
        const id2 = await page.evaluate(() => document.activeElement?.getAttribute('data-shortcut-id'));
        expect(id2).not.toBe(id1);
    });

    test('typing filters across all columns and hides empty ones', async ({ page }) => {
        await openSheet(page);
        const cards = page.locator('.keyboard-cheat-sheet .cheat-sheet-group');
        const before = await cards.evaluateAll((els) => els.filter((e) => !e.hidden).length);
        await page.locator('#cheat-sheet-filter').fill('inbox');
        const after = await cards.evaluateAll((els) => els.filter((e) => !e.hidden).length);
        expect(after).toBeGreaterThan(0);
        expect(after).toBeLessThan(before);
        // Every visible row sits in a visible card.
        const stray = await page.evaluate(() => [...document.querySelectorAll('.cheat-sheet-row:not([hidden])')]
            .filter((r) => r.closest('.cheat-sheet-group')?.hidden).length);
        expect(stray).toBe(0);
        await expect(page.locator('#cheat-sheet-no-results')).toBeHidden();
    });

    test('a nonsense filter shows the no-results message', async ({ page }) => {
        await openSheet(page);
        await page.locator('#cheat-sheet-filter').fill('zzzqqqxxx');
        await expect(page.locator('#cheat-sheet-no-results')).toBeVisible();
        expect(await page.locator('.cheat-sheet-row:not([hidden])').count()).toBe(0);
        await page.locator('#cheat-sheet-filter').fill('');
        await expect(page.locator('#cheat-sheet-no-results')).toBeHidden();
    });

    test('the view\'s own section comes first', async ({ page }) => {
        await openSheet(page, 'inbox');
        const first = page.locator('.keyboard-cheat-sheet .cheat-sheet-group').first();
        await expect(first).toHaveAttribute('data-context-section', 'true');
        await expect(first.locator('.cheat-sheet-group-label')).toHaveText(/inbox/i);
    });

    test('Escape closes the sheet', async ({ page }) => {
        await openSheet(page);
        await page.keyboard.press('Escape');
        await expect(page.locator('#app-modal.show .keyboard-cheat-sheet-modal')).toHaveCount(0);
    });
});
