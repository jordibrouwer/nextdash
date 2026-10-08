// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/*
 * Help → Structure & bookmarks has a panel of its own on moving blocks, opened
 * by three drawings that move: the landing box, the column line that makes a
 * block wide, and a block sent to another page. They rest on where the block
 * ended up, so a reader who asked for less motion still sees the result.
 */
test.describe('help on moving categories and widgets', () => {
    test.beforeEach(async ({ page }) => {
        await markWhatsNewSeen(page);
        await page.goto('/');
        await page.waitForSelector('.bookmark-link', { timeout: 15_000 });
        await dismissOnboardingIfPresent(page);
        await dismissBlockingOverlays(page);
    });

    test('the panel opens with the three moves and the keys', async ({ page }) => {
        await page.goto('/#config/help/organizing');
        const panel = page.locator('.config-help-panel').filter({ has: page.locator('.setting-art-move') });
        await expect(panel).toHaveCount(1);
        await expect(panel.locator('.setting-art-move.is-place')).toHaveCount(1);
        await expect(panel.locator('.setting-art-move.is-wide')).toHaveCount(1);
        await expect(panel.locator('.setting-art-move.is-page')).toHaveCount(1);
        await expect(panel).toContainText('Moving categories and widgets');
        await expect(panel).toContainText('Shift + Alt + ←');
        // The moving block runs a loop.
        const running = await panel.locator('.setting-art-move.is-place .is-moving')
            .evaluate((el) => el.getAnimations().some((a) => a.playState === 'running'));
        expect(running).toBe(true);
    });

    test('with less motion the drawing rests where the block landed', async ({ page }) => {
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await page.goto('/#config/help/organizing');
        const moving = page.locator('.setting-art-move.is-place .is-moving');
        await expect(moving).toHaveCount(1);
        await page.waitForTimeout(200);
        const transform = await moving.evaluate((el) => getComputedStyle(el).transform);
        expect(['none', 'matrix(1, 0, 0, 1, 0, 0)']).toContain(transform);
    });
});
