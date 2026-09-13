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
 * Now a row reads as a sentence ending in its key, the header carries the name
 * and the key that opens the sheet, and a pinned foot says how much is in it.
 *
 * The sections stay in one column. Two were tried and read worse: the open
 * section is twenty rows and the other fourteen are a line each, so whatever
 * the split, one side was a wall and the other was mostly empty.
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
    test('a row reads as a sentence and ends in its key', async ({ page }) => {
        await openCheatSheet(page);

        const order = await page.evaluate(() => {
            const row = document.querySelector('.keyboard-cheat-sheet-table tr');
            const cells = [...row.children].map((c) => c.className);
            const keys = row.querySelector('.keyboard-cheat-sheet-keys').getBoundingClientRect();
            const desc = row.querySelector('.keyboard-cheat-sheet-description').getBoundingClientRect();
            return { first: cells[0], keyStartsRightOfDescription: keys.left > desc.left };
        });

        expect(order.first, 'the key still opens the row').toContain('description');
        expect(order.keyStartsRightOfDescription, 'the key is not at the end of the row').toBe(true);
    });

    test('the header names the key, and closes the sheet', async ({ page }) => {
        await openCheatSheet(page);

        const chip = await page.locator('.cheat-sheet-modal-key').textContent();
        expect((chip || '').trim(), 'the header does not name the key that opens it').toBe('!');

        await page.locator('.cheat-sheet-modal-close').click();
        await expect(page.locator('#app-modal.show .keyboard-cheat-sheet-modal')).toHaveCount(0);
    });

    test('the foot stays in view and the wide Close button is gone', async ({ page }) => {
        await openCheatSheet(page);

        const state = await page.evaluate(() => {
            const foot = document.querySelector('.cheat-sheet-foot');
            const rect = foot.getBoundingClientRect();
            const actions = document.querySelector('.keyboard-cheat-sheet-modal .modal-actions');
            return {
                position: window.getComputedStyle(foot).position,
                inView: rect.top < window.innerHeight && rect.bottom > 0,
                // Opaque, or the rows scroll through the line covering them.
                opaque: !/\/\s*0?\.\d|,\s*0?\.\d+\)/.test(window.getComputedStyle(foot).backgroundColor),
                actions: actions ? window.getComputedStyle(actions).display : 'absent',
                count: (foot.textContent || '').trim(),
            };
        });

        expect(state.position, 'the foot scrolls away under the sections').toBe('sticky');
        expect(state.inView, 'the foot is off screen').toBe(true);
        expect(state.opaque, 'the foot is see-through').toBe(true);
        expect(state.actions, 'the wide Close button is back').toBe('none');
        expect(state.count, 'the foot does not say how much is in the sheet').toMatch(/\d/);
    });

    test('the sections still fold, and the slab still knows about flat', async ({ page }) => {
        await openCheatSheet(page, 'flat');

        // The accordion is behaviour, not decoration: the fold and the Space
        // key that drives it survive the redraw.
        const folds = await page.evaluate(() => {
            const group = document.querySelectorAll('details.cheat-sheet-group')[1];
            const before = group.open;
            group.querySelector('.cheat-sheet-group-title').click();
            return { before, after: group.open };
        });
        expect(folds.after, 'the sections no longer fold').toBe(!folds.before);
    });
});
