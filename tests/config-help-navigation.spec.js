// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissBlockingOverlays, dismissOnboardingIfPresent } = require('./e2e-helpers');

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
    await page.click(`[data-help-tab="${tab}"]`);
    await page.waitForTimeout(500);
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
