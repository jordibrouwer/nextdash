const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissBlockingOverlays, dismissOnboardingIfPresent, resetDashboardData } = require('./e2e-helpers');

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
    await resetDashboardData(page);
    await page.reload();
    await page.waitForSelector('.bookmark-link', { timeout: 15_000 });
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => (window.dashboardInstance?.bookmarks || []).length > 2,
        null, { timeout: 15_000 });
}

/*
 * Tag the rows that are on the grid, rather than the first three entries of a
 * list that may not be the one being rendered.
 *
 * This indexed into `dashboard.bookmarks`, which is not always the array the
 * grid draws from -- `allBookmarks` is a second one, and the two hold the same
 * objects only while the data is the shipped set. Run alone this file gets that
 * set and passed; run beside other files, which share the worker's data
 * directory, whatever they left behind pushed the two apart and the tags landed
 * on bookmarks nobody was looking at. The failure showed the seeded examples'
 * own tags, which is exactly what an un-mutated row looks like.
 *
 * Reading the URLs off the rendered rows removes the assumption entirely: the
 * three that get tags are by definition the three at the top of the grid, and
 * writing through both lists means the render sees it whichever one it uses.
 */
const seed = (page, max = 2) => page.evaluate((m) => {
    const d = window.dashboardInstance;
    d.settings.showRowTags = true;
    d.settings.rowTagsMax = m;

    const urls = [...document.querySelectorAll('.bookmark-link')]
        .map((el) => el.getAttribute('data-bookmark-url'))
        .filter((url, i, all) => url && all.indexOf(url) === i);
    const wanted = new Map([
        [urls[0], ['dev']],
        [urls[1], ['docs', 'reference']],
        [urls[2], ['one', 'two', 'three', 'four']],
    ]);

    const done = new Set();
    [d.bookmarks, d.allBookmarks].forEach((list) => {
        if (!Array.isArray(list)) return;
        list.forEach((b) => {
            if (done.has(b)) return;
            done.add(b);
            b.tags = wanted.get(b.url) || [];
        });
    });
    d.renderDashboard({ animate: false });
}, max);

const shortcutLefts = (page) => page.evaluate(() =>
    [...document.querySelectorAll('.bookmark-link')].slice(0, 6).map((r) => {
        const s = r.querySelector('.bookmark-shortcut');
        return s ? Math.round(s.getBoundingClientRect().left) : null;
    }));

// This file counts rows and indexes into the bookmark list, so what an earlier
// spec left behind changes its answers. The suite shares one data directory.
// Folded into load() rather than a beforeEach of its own: the reset needs a
// loaded page, and a second navigation afterwards raced the seeding below.

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
        // --text-2xs, the smallest step on the shared type scale. It was
        // pinned at 10.88px (0.68rem) before that scale existed; the chip now
        // reads the token like everything else its size, so this follows it
        // rather than freezing a value the stylesheet no longer contains.
        expect(chip.fs).toBe('10.4px');
        expect(chip.radius).toBe('999px');
    });
});
