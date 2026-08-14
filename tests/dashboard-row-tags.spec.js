const { test, expect } = require('@playwright/test');
const { markWhatsNewSeen, dismissBlockingOverlays, dismissOnboardingIfPresent } = require('./e2e-helpers');

/**
 * Tags were on every row as a data attribute and rendered nowhere. The chips go
 * inside the link rather than into a column of their own: .bookmark-link is a
 * subgrid whose columns line up across every category, so a new column would
 * move every row on the page.
 */
async function load(page) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('.bookmark-link', { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => (window.dashboardInstance?.bookmarks || []).length > 2,
        null, { timeout: 15_000 });
}

const seed = (page, max = 2) => page.evaluate((m) => {
    const d = window.dashboardInstance;
    d.settings.showRowTags = true;
    d.settings.rowTagsMax = m;
    (d.bookmarks || []).forEach((b, i) => {
        b.tags = i === 0 ? ['dev'] : i === 1 ? ['docs', 'reference'] : i === 2 ? ['one', 'two', 'three', 'four'] : [];
    });
    d.renderDashboard({ animate: false });
}, max);

const shortcutLefts = (page) => page.evaluate(() =>
    [...document.querySelectorAll('.bookmark-link')].slice(0, 6).map((r) => {
        const s = r.querySelector('.bookmark-shortcut');
        return s ? Math.round(s.getBoundingClientRect().left) : null;
    }));

test.describe('tag chips on the grid', () => {
    test('off by default', async ({ page }) => {
        await load(page);
        await page.evaluate(() => {
            const d = window.dashboardInstance;
            d.settings.showRowTags = false;
            (d.bookmarks || []).forEach((b) => { b.tags = ['dev']; });
            d.renderDashboard({ animate: false });
        });
        await expect(page.locator('.bookmark-tag-strip')).toHaveCount(0);
    });

    // The whole reason the chips live inside the link.
    test('turning them on does not move the subgrid columns', async ({ page }) => {
        await load(page);
        const before = await shortcutLefts(page);
        await seed(page);
        await page.waitForTimeout(300);
        expect(await shortcutLefts(page)).toEqual(before);
    });

    test('chips render, and the rest collapse into +N', async ({ page }) => {
        await load(page);
        await seed(page, 2);
        await expect.poll(() => page.evaluate(() =>
            [...document.querySelectorAll('.bookmark-tag-strip')].map((s) => s.textContent)),
        { timeout: 10_000 }).toContain('onetwo+2');
    });

    test('the cap is the setting, not a constant', async ({ page }) => {
        await load(page);
        await seed(page, 3);
        await expect.poll(() => page.evaluate(() =>
            [...document.querySelectorAll('.bookmark-tag-strip')].map((s) => s.textContent)),
        { timeout: 10_000 }).toContain('onetwothree+1');
    });

    test('the chip matches the inbox chip it was copied from', async ({ page }) => {
        await load(page);
        await seed(page);
        const chip = await page.evaluate(() => {
            const el = document.querySelector('.bookmark-tag-chip');
            const c = getComputedStyle(el);
            return { bg: c.backgroundColor, border: c.borderColor, fs: c.fontSize, radius: c.borderRadius };
        });
        expect(chip.fs).toBe('10.88px');
        expect(chip.radius).toBe('999px');
    });
});
