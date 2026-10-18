// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissBlockingOverlays, dismissOnboardingIfPresent, openHelpTab } = require('./e2e-helpers');

/**
 * Two things a reader does inside Help that it did not answer.
 *
 * Tips is fifty-odd lines in nine groups, and the search in the header returns
 * whole panels — the wrong grain when you are after the one key that does the
 * thing. And Health and Monitoring answer different questions on purpose, but
 * nothing said the topic continued a tab further along.
 */

async function openHelp(page, tab) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.evaluate(() => window.dashboardInstance.config.openConfigView('help'));
    await page.waitForSelector('#config-help-body', { timeout: 15_000 });
    await openHelpTab(page, tab);
}

test.describe('the Tips tab filters itself', () => {
    test('a query narrows to the line, and empty groups go with their rows', async ({ page }) => {
        await openHelp(page, 'tips');

        const rows = page.locator('#config-help-body [data-tip-row]');
        const total = await rows.count();
        expect(total).toBeGreaterThan(20);

        await page.fill('#config-tips-filter', 'inbox');
        await expect.poll(async () => rows.evaluateAll((els) => els.filter((e) => !e.hidden).length))
            .toBeLessThan(total);
        const shown = await rows.evaluateAll((els) => els.filter((e) => !e.hidden).length);
        expect(shown).toBeGreaterThan(0);

        // A group with nothing left is hidden too, or the page fills with
        // headings standing over nothing.
        const groupsWithNothing = await page.locator('#config-help-body [data-tip-group]')
            .evaluateAll((els) => els.filter((g) => !g.hidden
                && [...g.querySelectorAll('[data-tip-row]')].every((r) => r.hidden)).length);
        expect(groupsWithNothing).toBe(0);

        await expect(page.locator('[data-tips-count]')).toHaveText(new RegExp(`${shown}\\D+${total}`));

        // Nothing matching says so rather than showing a blank page.
        await page.fill('#config-tips-filter', 'zzzzzz');
        await expect(page.locator('[data-tips-empty]')).toBeVisible();

        // Clearing brings every row back.
        await page.fill('#config-tips-filter', '');
        await expect.poll(async () => rows.evaluateAll((els) => els.filter((e) => !e.hidden).length))
            .toBe(total);
    });
});

test.describe('a topic that continues on another tab says so', () => {
    test('the link switches tab and lands on the panel', async ({ page }) => {
        await openHelp(page, 'health');

        const seeAlso = page.locator('#config-help-body .config-help-see-also').first();
        await expect(seeAlso).toBeVisible();

        await seeAlso.locator('.config-help-see-also-link').first().click();
        await expect.poll(() => page.evaluate(() => window.dashboardInstance.config.helpTab), { timeout: 5_000 })
            .toBe('monitoring');
        // The hash carries the destination panel, so a link shared from here
        // and this button land in the same place.
        await expect.poll(() => page.evaluate(() => window.location.hash))
            .toMatch(/#config\/help\/monitoring\/health-stats$/);
        await expect(page.locator('#help-panel-health-stats')).toBeVisible();
    });
});

test.describe('a link to a panel that moved tab still arrives', () => {
    test('an old server-log link opens the Logs tab on that panel', async ({ page }) => {
        await markWhatsNewSeen(page);
        await page.goto('/#config/help/data/server-log');
        await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
        await dismissOnboardingIfPresent(page);
        await dismissBlockingOverlays(page);

        await expect.poll(() => page.evaluate(() => window.dashboardInstance.config.helpTab), { timeout: 10_000 })
            .toBe('logs');
        await expect(page.locator('#help-panel-server-log')).toBeVisible();
        await expect.poll(() => page.evaluate(() => window.location.hash))
            .toMatch(/#config\/help\/logs\/server-log$/);
    });
});

test.describe('the version panel reads its own version', () => {
    test('the heading follows the release index, not a translated string', async ({ page }) => {
        await openHelp(page, 'start');

        const tag = await page.evaluate(async () => {
            const res = await fetch('/static/data/whats-new/index.json');
            const index = await res.json();
            return String(index[0].tag).replace(/^v/i, '');
        });

        await expect(page.locator('#help-panel-version .config-panel-title'))
            .toHaveText(`nextDash ${tag}`, { timeout: 10_000 });
    });
});

test.describe('the Help strip is one row and a menu', () => {
    const row = (page) => page.locator('.config-subtabs--more [data-help-tab]');
    const toggle = (page) => page.locator('[data-help-more-toggle]');
    const menu = (page) => page.locator('#config-help-more-menu');

    test('Basics on the row, the rest under More topics in their groups', async ({ page }) => {
        await page.setViewportSize({ width: 1000, height: 900 });
        await openHelp(page, 'start');
        await expect(row(page)).toHaveText(['Getting started', 'Tips', 'Configuring', 'Search & keyboard']);
        const strip = page.locator('.config-subtabs--more');
        expect(await strip.evaluate((el) => el.scrollWidth > el.clientWidth + 1)).toBe(false);

        await toggle(page).click();
        await expect(toggle(page)).toHaveAttribute('aria-expanded', 'true');
        await expect(menu(page).locator('.move-popover-section-label')).toHaveText(['Dashboard', 'Status & checks', 'Data']);
        await expect(menu(page).locator('[data-help-more]')).toHaveCount(11);

        // Picking a topic opens it and puts it on the row, marked.
        await menu(page).locator('[data-help-more="widgets"]').click();
        await expect(menu(page)).toHaveCount(0);
        await expect(row(page)).toHaveText(['Getting started', 'Tips', 'Configuring', 'Search & keyboard', 'Widgets']);
        await expect(page.locator('[data-help-tab="widgets"]')).toHaveAttribute('aria-selected', 'true');
        await expect(page).toHaveURL(/#config\/help\/widgets/);

        // Back to a Basics tab, and the extra one leaves the row.
        await page.click('[data-help-tab="tips"]');
        await expect(row(page)).toHaveCount(4);
    });

    test('Escape closes the menu and leaves config open', async ({ page }) => {
        await openHelp(page, 'start');
        await toggle(page).click();
        await expect(menu(page)).toBeVisible();
        await page.keyboard.press('ArrowDown');
        await page.keyboard.press('Escape');
        await expect(menu(page)).toHaveCount(0);
        await expect(toggle(page)).toBeFocused();
        expect(await page.evaluate(() => window.dashboardInstance.activeView)).toBe('config');
    });

    test('] walks on into the menu topics and shows them on the row', async ({ page }) => {
        await openHelp(page, 'search');
        await page.locator('#config-section-panel').focus();
        await page.keyboard.press(']');
        await expect(page.locator('[data-help-tab="appearance"]')).toHaveAttribute('aria-selected', 'true');
        await page.keyboard.press(']');
        await expect(page.locator('[data-help-tab="organizing"]')).toHaveAttribute('aria-selected', 'true');
        await expect(page.locator('[data-help-tab="appearance"]')).toHaveCount(0);
    });
});
