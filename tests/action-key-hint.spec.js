// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * With the key chips switched off, resting on an action button shows its key.
 *
 * The chips go, the keys stay -- so the key has to be findable somewhere. A
 * short rest on the button brings it up; passing over the bar does not.
 */

const hint = (page) => page.locator('.action-key-hint:not([hidden])');

async function openDashboard(page, settings) {
    await page.setViewportSize({ width: 1500, height: 900 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('.bookmark-link', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.mouse.move(750, 450);
    await page.evaluate(async (next) => {
        const d = window.dashboardInstance;
        Object.assign(d.settings, { actionBarEnabled: true, actionBarAutoHideSeconds: 0, showActionKeys: true }, next);
        await d.saveSettings?.();
        d.setupDOM?.();
    }, settings);
}

/** Moves onto the button once the bar has finished sliding into its dock. */
const hover = async (page, selector) => {
    let box = await page.locator(selector).boundingBox();
    await expect.poll(async () => {
        const prev = box;
        await page.waitForTimeout(100);
        box = await page.locator(selector).boundingBox();
        return JSON.stringify(prev) === JSON.stringify(box);
    }).toBe(true);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    return box;
};

test('chips off: resting on a button shows its key after a moment', async ({ page }) => {
    await openDashboard(page, { actionBarPosition: 'bottom', showActionKeys: false });
    const button = await hover(page, '#search-button');

    // Not at once: a pointer passing by must not raise it.
    await page.waitForTimeout(100);
    await expect(hint(page)).toHaveCount(0);

    await expect(hint(page)).toBeVisible();
    await expect(hint(page)).toHaveText('>');

    // Docked at the bottom, so it stands above the button.
    const box = await hint(page).boundingBox();
    expect(box.y + box.height).toBeLessThanOrEqual(button.y);

    // Leaving the button takes it away.
    await page.mouse.move(750, 450);
    await expect(hint(page)).toHaveCount(0);
});

test('the key follows the button', async ({ page }) => {
    await openDashboard(page, { actionBarPosition: 'left', showActionKeys: false });
    const button = await hover(page, '#help-button');
    await expect(hint(page)).toHaveText('!');
    // Docked on the left, so it stands to the right.
    const box = await hint(page).boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(button.x + button.width);
});

test('a click takes it away', async ({ page }) => {
    await openDashboard(page, { actionBarPosition: 'bottom', showActionKeys: false });
    await hover(page, '#collapse-all-button');
    await expect(hint(page)).toBeVisible();
    await page.mouse.down();
    await expect(hint(page)).toHaveCount(0);
    await page.mouse.up();
});

test('chips on: no popover, the chip already says it', async ({ page }) => {
    await openDashboard(page, { actionBarPosition: 'bottom', showActionKeys: true });
    await hover(page, '#search-button');
    await page.waitForTimeout(600);
    await expect(hint(page)).toHaveCount(0);
});
