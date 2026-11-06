// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissBlockingOverlays, dismissOnboardingIfPresent } = require('./e2e-helpers');

/**
 * The mode keys : and ! open commands and finders, and the badge in front of
 * the field says which mode it is. The key itself is not printed in the field
 * (as > never was); what is typed after it is.
 */

async function dashboard(page) {
    await page.setViewportSize({ width: 1400, height: 900 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => window.dashboardInstance?.searchComponent?.findersComponent != null, null, { timeout: 20_000 });
    await page.evaluate(() => {
        const f = window.dashboardInstance.searchComponent.findersComponent;
        const list = [{ name: 'Brave Search', shortcut: 'b', searchUrl: 'https://search.brave.com/search?q=%s' },
            { name: 'Google', shortcut: 'g', searchUrl: 'https://www.google.com/search?q=%s' }];
        f.finders = list;
        f.shortcuts = new Map(list.map((x) => [x.shortcut, x]));
        window.dashboardInstance.searchComponent.finders = list;
    });
}

const field = (page) => page.locator('#search-query');
const badge = (page) => page.locator('#shortcut-search .search-chevron, #shortcut-search [class*="chevron"]').first();
const internal = (page) => page.evaluate(() => window.dashboardInstance.searchComponent.currentQuery);

test('the : opens commands and is not printed in the field', async ({ page }) => {
    await dashboard(page);
    await page.keyboard.type(':');
    await expect.poll(() => internal(page)).toBe(':');
    await expect(page.locator('#shortcut-search.show')).toBeVisible();
    await expect(field(page)).toHaveText('');
    await expect(badge(page)).toHaveText(':');
    await page.keyboard.type('new');
    await expect(field(page)).toHaveText('new');
    expect(await internal(page)).toBe(':new');
});

test('the ! opens finders and is not printed in the field', async ({ page }) => {
    await dashboard(page);
    await page.keyboard.type('!');
    await expect.poll(() => internal(page)).toBe('!');
    await expect(page.locator('#shortcut-search.show')).toBeVisible();
    await expect(field(page)).toHaveText('');
    await expect(badge(page)).toHaveText('!');
    await page.keyboard.type('g');
    await expect(field(page)).toHaveText('G');
    await page.keyboard.type('nextdash');
    await expect(field(page)).toHaveText('G nextdash');
    expect(await internal(page)).toBe('!G nextdash');
});

test('the > shows nothing in the field, as before', async ({ page }) => {
    await dashboard(page);
    await page.keyboard.type('>');
    await page.keyboard.type('jordi');
    await expect(field(page)).toHaveText('jordi');
});

test('backspace on the empty field leaves the mode, and the panel stays open', async ({ page }) => {
    await dashboard(page);
    await page.keyboard.type(':');
    await expect.poll(() => internal(page)).toBe(':');
    await page.keyboard.press('Backspace');
    await expect.poll(() => internal(page)).toBe('');
    await expect(page.locator('#shortcut-search.show')).toBeVisible();
    await expect(badge(page)).toHaveText('>');
});

test('the = opens the assistant and is not printed in the field', async ({ page }) => {
    await dashboard(page);
    await page.keyboard.type('=');
    await expect.poll(() => internal(page)).toBe('=');
    await expect(page.locator('#shortcut-search.show')).toBeVisible();
    await expect(field(page)).toHaveText('');
    await expect(badge(page)).toHaveText('=');
    await page.keyboard.type('what is a bookmark');
    await expect(field(page)).toHaveText('what is a bookmark');
    expect(await internal(page)).toBe('=what is a bookmark');
    // Backspace past the text and the empty field leaves the mode.
    for (let i = 0; i < 'what is a bookmark'.length; i += 1) await page.keyboard.press('Backspace');
    await page.keyboard.press('Backspace');
    await expect.poll(() => internal(page)).toBe('');
});

test('the * in the open palette switches to recents and is not printed in the field', async ({ page }) => {
    await dashboard(page);
    await page.keyboard.type('>');
    await expect(page.locator('#shortcut-search.show')).toBeVisible();
    await page.keyboard.type('*');
    await expect.poll(() => internal(page)).toBe('*');
    await expect(field(page)).toHaveText('');
    await expect(badge(page)).toHaveText('*');
});
