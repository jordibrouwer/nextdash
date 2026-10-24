// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * The cheat sheet, drawn the way the overlays spec draws a panel.
 *
 * Each row opened with its key in a column 40% of the width, so the reader
 * scanned a list of keys to find the thing they wanted to do rather than the
 * other way round. Underneath sat a full-width Close button and, under that, a
 * line saying Esc closes it: the third way of saying the same thing, on a
 * panel whose header said nothing at all.
 *
 * Now the sections are columns of cards, a row is only what it does, the keys
 * show in a dock under the columns once a row is chosen, the header carries the
 * name and the key that opens the sheet, and a foot says how much is in it.
 */

async function openCheatSheet(page, depth) {
    await page.setViewportSize({ width: 1500, height: 1000 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('.bookmark-link', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    if (depth) await page.evaluate((d) => document.body.setAttribute('data-depth', d), depth);

    // Through the key someone presses, not through the renderer.
    await page.keyboard.press('Shift+Digit1');
    await page.waitForSelector('.keyboard-cheat-sheet', { timeout: 20_000 });
}

test.describe('the cheat sheet panel', () => {
    test('a row shows only what it does; the keys wait in the dock', async ({ page }) => {
        await openCheatSheet(page);

        const row = page.locator('.cheat-sheet-row').first();
        await expect(row.locator('kbd, .keyboard-cheat-sheet-keys'), 'a row shows its keys before it is chosen').toHaveCount(0);
        await row.click();

        const order = await page.evaluate(() => {
            const dock = document.getElementById('cheat-sheet-dock');
            const keys = dock.querySelector('.keyboard-cheat-sheet-keys').getBoundingClientRect();
            const text = dock.querySelector('.cheat-sheet-dock-text').getBoundingClientRect();
            return { keysFirst: keys.left < text.left };
        });
        expect(order.keysFirst, 'the dock does not lead with the keys').toBe(true);
    });

    test('the header names the key, and closes the sheet', async ({ page }) => {
        await openCheatSheet(page);

        const chip = await page.locator('.cheat-sheet-modal-key').textContent();
        expect((chip || '').trim(), 'the header does not name the key that opens it').toBe('!');

        await page.locator('.cheat-sheet-modal-close').click();
        await expect(page.locator('#app-modal.show .keyboard-cheat-sheet-modal')).toHaveCount(0);
    });

    test('the dock and foot stay in view and the wide Close button is gone', async ({ page }) => {
        await openCheatSheet(page);

        const state = await page.evaluate(() => {
            const panel = document.querySelector('.keyboard-cheat-sheet-modal').getBoundingClientRect();
            const foot = document.querySelector('.cheat-sheet-foot').getBoundingClientRect();
            const dock = document.querySelector('.cheat-sheet-dock').getBoundingClientRect();
            const actions = document.querySelector('.keyboard-cheat-sheet-modal .modal-actions');
            return {
                footInPanel: foot.bottom <= panel.bottom && foot.top >= panel.top,
                dockAboveFoot: dock.bottom <= foot.top + 1,
                actions: actions ? window.getComputedStyle(actions).display : 'absent',
                count: (document.querySelector('.cheat-sheet-foot').textContent || '').trim(),
            };
        });

        expect(state.footInPanel, 'the foot is outside the panel').toBe(true);
        expect(state.dockAboveFoot, 'the dock overlaps the foot').toBe(true);
        expect(state.actions, 'the wide Close button is back').toBe('none');
        expect(state.count, 'the foot does not say how much is in the sheet').toMatch(/\d/);
    });

    test('the cards keep their ring on flat too', async ({ page }) => {
        await openCheatSheet(page, 'flat');
        const shadow = await page.evaluate(() => window.getComputedStyle(document.querySelector('.cheat-sheet-group')).boxShadow);
        expect(shadow, 'the card lost its ring').toContain('inset');
    });
});
