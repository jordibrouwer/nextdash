// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * A docked action bar can slide into its edge after a delay, come back when
 * the pointer touches that edge or on ' / Shift+O, and can be switched off.
 * What is checked is the state on <body> and whether the bar can be reached,
 * not how far it moved.
 */

const hidden = (page) => page.evaluate(() => document.body.hasAttribute('data-action-bar-hidden'));
const bar = (page) => page.locator('.dashboard-section.section-controls .header-shortcuts');

async function openDashboard(page, settings) {
    await page.setViewportSize({ width: 1500, height: 900 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('.bookmark-link', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    // Park the pointer in the middle, away from every edge and the bar.
    await page.mouse.move(750, 450);
    await page.evaluate(async (next) => {
        const d = window.dashboardInstance;
        // The store is shared by a file's tests, so every one starts from the same bar.
        Object.assign(d.settings, { actionBarEnabled: true, actionBarAutoHideSeconds: 0, showActionKeys: true }, next);
        await d.saveSettings?.();
        d.setupDOM?.();
    }, settings);
}

test('a left column slides away after the chosen delay', async ({ page }) => {
    await openDashboard(page, { actionBarPosition: 'left', actionBarAutoHideSeconds: 2 });
    await page.waitForTimeout(800);
    expect(await hidden(page), 'gone before its time').toBe(false);
    await expect.poll(() => hidden(page), { timeout: 4000 }).toBe(true);
    // Out of view is out of reach.
    await expect(bar(page)).toHaveAttribute('inert', '');
});

test('always in view never slides', async ({ page }) => {
    await openDashboard(page, { actionBarPosition: 'left', actionBarAutoHideSeconds: 0 });
    await page.waitForTimeout(2500);
    expect(await hidden(page)).toBe(false);
});

test('touching the edge beside the bar brings it back', async ({ page }) => {
    await openDashboard(page, { actionBarPosition: 'left', actionBarAutoHideSeconds: 2 });
    await expect.poll(() => hidden(page), { timeout: 4000 }).toBe(true);

    await page.mouse.move(1, 450);
    await expect.poll(() => hidden(page)).toBe(false);
    await expect(bar(page)).not.toHaveAttribute('inert', '');
});

test('a right column comes back at the page edge, scrollbar or not', async ({ page }) => {
    await openDashboard(page, { actionBarPosition: 'right', actionBarAutoHideSeconds: 2 });
    await expect.poll(() => hidden(page), { timeout: 4000 }).toBe(true);
    // Just inside the page, where a classic scrollbar would begin.
    const edge = await page.evaluate(() => document.documentElement.clientWidth - 2);
    await page.mouse.move(edge, 450);
    await expect.poll(() => hidden(page)).toBe(false);
});

test('the far edge does nothing for a left column', async ({ page }) => {
    await openDashboard(page, { actionBarPosition: 'left', actionBarAutoHideSeconds: 2 });
    await expect.poll(() => hidden(page), { timeout: 4000 }).toBe(true);
    await page.mouse.move(1499, 450);
    await page.waitForTimeout(300);
    expect(await hidden(page)).toBe(true);
});

test('a bar in use stays where it is', async ({ page }) => {
    await openDashboard(page, { actionBarPosition: 'bottom', actionBarAutoHideSeconds: 2 });
    // Moving to the bottom is itself a slide; measure where it came to rest.
    await page.waitForTimeout(400);
    const box = await bar(page).boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(3000);
    expect(await hidden(page), 'slid away under the pointer').toBe(false);

    // Leaving it starts the wait again.
    await page.mouse.move(750, 300);
    await expect.poll(() => hidden(page), { timeout: 4000 }).toBe(true);

    // And the bottom edge beside it brings it back.
    await page.mouse.move(box.x + box.width / 2, 899);
    await expect.poll(() => hidden(page)).toBe(false);
});

test("' and Shift+O move a docked bar out and back", async ({ page }) => {
    await openDashboard(page, { actionBarPosition: 'right', actionBarAutoHideSeconds: 0 });
    await page.locator('body').press("'");
    await expect.poll(() => hidden(page)).toBe(true);
    await page.keyboard.press('Shift+O');
    await expect.poll(() => hidden(page)).toBe(false);
    await page.keyboard.press('Shift+O');
    await expect.poll(() => hidden(page)).toBe(true);
    await page.keyboard.press("'");
    await expect.poll(() => hidden(page)).toBe(false);
});

test('in the header the keys leave the bar alone', async ({ page }) => {
    await openDashboard(page, { actionBarPosition: 'header', actionBarAutoHideSeconds: 2 });
    await page.locator('body').press("'");
    await page.waitForTimeout(2500);
    expect(await hidden(page)).toBe(false);
    await expect(bar(page)).toBeVisible();
});

test('switched off draws no actions, and their keys still work', async ({ page }) => {
    await openDashboard(page, { actionBarPosition: 'bottom', actionBarEnabled: false });
    await expect(bar(page)).toBeHidden();
    await page.locator('body').press('!');
    await expect(page.locator('.keyboard-cheat-sheet-modal')).toBeVisible();
});

test('the delay is chosen in config and survives a reload', async ({ page }) => {
    await openDashboard(page, { actionBarPosition: 'left', actionBarAutoHideSeconds: 0 });
    await page.keyboard.press('Shift+S');
    await page.click('[data-config-section="appearance"]');
    await page.locator('[data-hub-group="header"] [data-appearance-tab="buttonbar"]').click();
    await page.locator('[data-hub-field="actionBarAutoHideSeconds"][data-hub-value="5"]').click();
    await expect.poll(() => page.evaluate(() => window.dashboardInstance.settings.actionBarAutoHideSeconds)).toBe(5);
    await expect(page.locator('.hub-preview')).toHaveAttribute('data-preview-bar', 'sliding');

    await page.goto('/');
    await page.waitForSelector('.bookmark-link', { timeout: 20_000 });
    expect(await page.evaluate(() => window.dashboardInstance.settings.actionBarAutoHideSeconds)).toBe(5);
});

test('the key chips switch off in config, and the keys keep working', async ({ page }) => {
    await openDashboard(page, { actionBarPosition: 'bottom', showActionKeys: true });
    const chip = page.locator('#search-button .search-button-icon');
    await expect(chip).toBeVisible();

    await page.keyboard.press('Shift+S');
    await page.click('[data-config-section="appearance"]');
    await page.locator('[data-hub-group="header"] [data-appearance-tab="buttonbar"]').click();
    await page.locator('[data-behavior-field="showActionKeys"]').uncheck();
    await expect.poll(() => page.evaluate(() => window.dashboardInstance.settings.showActionKeys)).toBe(false);

    await page.goto('/');
    await page.waitForSelector('.bookmark-link', { timeout: 20_000 });
    await expect(page.locator('#search-button .search-button-icon')).toBeHidden();
    await page.locator('body').press('!');
    await expect(page.locator('.keyboard-cheat-sheet-modal')).toBeVisible();
});

/*
 * A handle on the edge while the bar is away: where it comes back from, larger
 * as the pointer nears, and a click on it brings the bar back.
 */
const handle = (page) => page.locator('.action-bar-edge-handle');
const handleSize = (page) => handle(page).evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { width: r.width, height: r.height, right: r.right, bottom: r.bottom, left: r.left };
});

test('a handle stands on the edge the bar slid into, and only then', async ({ page }) => {
    await openDashboard(page, { actionBarPosition: 'right', actionBarAutoHideSeconds: 2 });
    await expect(handle(page)).toBeHidden();
    await expect.poll(() => hidden(page), { timeout: 4000 }).toBe(true);
    await expect(handle(page)).toBeVisible();

    const box = await handleSize(page);
    // The page's edge, which is the body's: a scrollbar gutter stands beyond
    // it, and the bar itself is placed against the same edge.
    const edge = await page.evaluate(() => document.body.getBoundingClientRect().right);
    expect(box.right, 'the handle is not on the right edge').toBeGreaterThanOrEqual(edge - 1);

    await page.keyboard.press("'");
    await expect.poll(() => hidden(page)).toBe(false);
    await expect(handle(page)).toBeHidden();
});

test('the handle grows as the pointer nears the edge', async ({ page }) => {
    await openDashboard(page, { actionBarPosition: 'bottom', actionBarAutoHideSeconds: 2 });
    await expect.poll(() => hidden(page), { timeout: 4000 }).toBe(true);
    const far = await handleSize(page);
    expect(far.bottom, 'the handle is not on the bottom edge').toBeGreaterThanOrEqual(899);

    await page.mouse.move(750, 900 - 60);
    await expect.poll(async () => (await handleSize(page)).height).toBeGreaterThan(far.height);
    const near = await handleSize(page);
    expect(near.width).toBeGreaterThan(far.width);
});

test('a click on the handle brings the bar back', async ({ page }) => {
    await openDashboard(page, { actionBarPosition: 'left', actionBarAutoHideSeconds: 2 });
    await expect.poll(() => hidden(page), { timeout: 4000 }).toBe(true);
    await handle(page).click();
    await expect.poll(() => hidden(page)).toBe(false);
});

test('no handle for a bar in the header', async ({ page }) => {
    await openDashboard(page, { actionBarPosition: 'header', actionBarAutoHideSeconds: 2 });
    await page.waitForTimeout(2500);
    await expect(handle(page)).toBeHidden();
});
