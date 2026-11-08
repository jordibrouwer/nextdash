// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissBlockingOverlays, dismissOnboardingIfPresent, ensureBookmarksDashboardView } = require('./e2e-helpers');

/**
 * Shift+S switches the mode strip off and on, in every view at once, and says
 * so with a toast. One stored setting, showModeStrip.
 */

async function load(page) {
    await page.setViewportSize({ width: 1400, height: 900 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('.bookmark-link', { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await ensureBookmarksDashboardView(page);
    await page.evaluate(() => { window.dashboardInstance.settings.showModeStrip = true; });
}

const enabled = (page) => page.evaluate(() => window.dashboardInstance.settings.showModeStrip);
const strip = (page) => page.locator('#mode-strip');

test('Shift+S turns the strip off with a cursor on a row, says so, and turns it on again', async ({ page }) => {
    await load(page);
    await page.keyboard.press('ArrowDown');
    await expect(strip(page)).toBeVisible();
    await page.keyboard.press('Shift+S');
    await expect.poll(() => enabled(page)).toBe(false);
    await expect(page.locator('.app-notification', { hasText: 'Mode strip off' })).toBeVisible();
    await expect(strip(page)).toBeHidden();
    // The cursor is still on the row: moving does not bring the strip back.
    await page.keyboard.press('ArrowDown');
    await expect(strip(page)).toBeHidden();
    await page.keyboard.press('Shift+S');
    await expect.poll(() => enabled(page)).toBe(true);
    await expect(page.locator('.app-notification', { hasText: 'Mode strip on' })).toBeVisible();
    await expect(strip(page)).toBeVisible();
    // Leave the stored value as the other specs expect it.
    expect(await enabled(page)).toBe(true);
});

test('it works in the Bookmarks view too, and one setting covers both', async ({ page }) => {
    await load(page);
    await page.keyboard.press('Shift+B');
    await expect.poll(() => page.evaluate(() => window.dashboardInstance.activeView)).toBe('library');
    await page.waitForSelector('#config-bm-list .config-bm-row', { timeout: 15_000 });
    await page.keyboard.press('Shift+S');
    await expect.poll(() => enabled(page)).toBe(false);
    await page.keyboard.press('Escape');
    await expect.poll(() => page.evaluate(() => window.dashboardInstance.activeView)).not.toBe('library');
    await page.waitForSelector('.bookmark-link');
    await page.keyboard.press('ArrowDown');
    await expect(strip(page)).toBeHidden();
    await page.keyboard.press('Shift+S');
    await expect.poll(() => enabled(page)).toBe(true);
});

test('a capital S typed into a field stays a letter', async ({ page }) => {
    await load(page);
    await page.evaluate(() => {
        const input = document.createElement('input');
        input.id = 'probe-field';
        document.body.appendChild(input);
        input.focus();
    });
    await page.keyboard.press('Shift+S');
    await expect(page.locator('#probe-field')).toHaveValue('S');
    expect(await enabled(page)).toBe(true);
});

test('with no cursor the strip says which mode the keys are in, without the cursor letters', async ({ page }) => {
    await load(page);
    await expect(strip(page)).toContainText('Search');
    await expect(strip(page).locator('kbd')).toHaveCount(0);
    await page.keyboard.press('ArrowDown');
    await expect(strip(page)).toContainText('Cursor');
    await page.keyboard.press('Escape');
    await expect(strip(page)).toContainText('Search');
    await page.keyboard.press('Shift+B');
    await expect.poll(() => page.evaluate(() => window.dashboardInstance.activeView)).toBe('library');
    await expect(strip(page)).toContainText('Browse');
    await expect(strip(page).locator('kbd')).toHaveCount(0);
});

test('the legends of the views that carry the strip list Shift+S', async ({ page }) => {
    await load(page);
    await page.keyboard.press('ArrowDown');
    await expect(page.locator('.dashboard-legend-line kbd', { hasText: 'Shift+S' })).toHaveCount(1);
    await page.keyboard.press('Shift+B');
    await expect.poll(() => page.evaluate(() => window.dashboardInstance.activeView)).toBe('library');
    await expect(page.locator('.config-bm-keyboard-legend kbd', { hasText: 'Shift+S' })).toHaveCount(1);
});

test('after five quiet seconds the strip fades away; any key brings it back', async ({ page }) => {
    await load(page);
    await expect(strip(page)).toBeVisible();
    await expect(strip(page)).toHaveClass(/is-idle/, { timeout: 9_000 });
    await expect.poll(() => strip(page).evaluate((el) => getComputedStyle(el).visibility), { timeout: 3_000 }).toBe('hidden');
    await page.keyboard.press('ArrowDown');
    await expect(strip(page)).not.toHaveClass(/is-idle/);
    await expect(strip(page)).toBeVisible();
    await expect(strip(page)).toContainText('Cursor');
});

test('it fades with a transition, and rises in when it comes back from hidden', async ({ page }) => {
    await load(page);
    const css = await strip(page).evaluate((el) => {
        const idle = el.cloneNode(false);
        idle.className = 'mode-strip is-idle';
        el.parentElement.appendChild(idle);
        const s = getComputedStyle(idle);
        const out = { transition: s.transitionProperty, duration: s.transitionDuration };
        idle.remove();
        return out;
    });
    expect(css.transition).toContain('opacity');
    expect(parseFloat(css.duration)).toBeGreaterThan(0.3);
    // Off and on again: the strip comes back through the entering animation.
    await page.keyboard.press('Shift+S');
    await expect.poll(() => enabled(page)).toBe(false);
    await page.keyboard.press('Shift+S');
    await expect.poll(() => enabled(page)).toBe(true);
    await expect.poll(() => strip(page).evaluate((el) => el.getAnimations().map((a) => a.animationName)), { timeout: 3_000 }).toContain('mode-strip-in');
});
