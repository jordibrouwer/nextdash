// @ts-check
const { test, expect } = require('./fixtures');
const { dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * Tags is a Bookmarks tab, and the section it left is Structure.
 *
 * A tag is something a bookmark carries; pages, categories, finders and
 * collections are the structure it is filed in. The tab sat with the second
 * group for as long as the section was called Pages & tags, which is also why
 * the section was called that.
 *
 * The links handed out before the move are the reason half of this file
 * exists: `#config/pages-tags` still has to land somewhere sensible, and
 * `#config/pages-tags/tags` has to land on the tab in its new home.
 */

async function openConfig(page, section) {
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.config?.openConfigView, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.evaluate((s) => window.dashboardInstance.config.openConfigView(s), section);
}

const tabNames = (page, attr) => page.evaluate((a) =>
    [...document.querySelectorAll(`[${a}]`)].map((b) => b.getAttribute(a)), attr);

test.describe('where Tags lives', () => {
    test('Bookmarks carries it, between List and Tag suggestions', async ({ page }) => {
        await openConfig(page, 'bookmarks');
        const tabs = await tabNames(page, 'data-bm-tab');

        expect(tabs).toContain('tags');
        // The order is the point: the list, then the words on it, then what the
        // app proposes adding to them.
        expect(tabs.indexOf('tags')).toBe(tabs.indexOf('list') + 1);
        expect(tabs.indexOf('tags')).toBe(tabs.indexOf('tag-suggestions') - 1);
    });

    test('Structure no longer does, and says so in the rail', async ({ page }) => {
        await openConfig(page, 'structure');
        expect(await tabNames(page, 'data-pt-tab')).toEqual(['categories', 'pages', 'finders', 'collections']);

        const rail = await page.evaluate(() =>
            [...document.querySelectorAll('[data-config-section]')].map((n) => n.textContent.trim()));
        expect(rail).toContain('Structure');
        expect(rail).not.toContain('Pages & tags');
    });

    test('the tab works where it landed: cloud, filter and rows', async ({ page }) => {
        await openConfig(page, 'bookmarks');
        await page.locator('[data-bm-tab="tags"]').click();

        await expect(page.locator('#config-tag-filter')).toBeVisible();
        await expect(page.locator('[data-tag-cloud]').first()).toBeVisible();
        await expect(page.locator('[data-tag-row]').first()).toBeVisible();
        // The filter repaints the body it sits in — the Bookmarks one now, not
        // the Structure one it was written against.
        const tag = await page.locator('[data-tag-rename]').first().inputValue();
        await page.locator('#config-tag-filter').fill(tag);
        await expect(page.locator('#config-tag-filter')).toBeFocused();
        await expect(page.locator('[data-tag-row]').first()).toBeVisible();
    });

    test('an old link to the tab lands on it in its new home', async ({ page }) => {
        await page.goto('/#config/pages-tags/tags');
        await page.waitForFunction(() => window.dashboardInstance?.config?.section === 'bookmarks', null, { timeout: 15_000 });
        await dismissOnboardingIfPresent(page);

        await expect.poll(() => page.evaluate(() => window.dashboardInstance.config.bmTab)).toBe('tags');
        // And the address bar is rewritten to the name the section has now, so
        // the link that gets copied next is the current one.
        await expect.poll(() => page.evaluate(() => window.location.hash)).toBe('#config/bookmarks/tags');
    });

    test('an old link to the section lands on its new name', async ({ page }) => {
        await page.goto('/#config/pages-tags/finders');
        await page.waitForFunction(() => window.dashboardInstance?.config?.section === 'structure', null, { timeout: 15_000 });
        await dismissOnboardingIfPresent(page);

        await expect.poll(() => page.evaluate(() => window.dashboardInstance.config.ptTab)).toBe('finders');
        await expect.poll(() => page.evaluate(() => window.location.hash)).toBe('#config/structure/finders');
    });

    test('a Bookmarks tab survives a reload, which it never used to', async ({ page }) => {
        await page.goto('/#config/bookmarks/tags');
        await page.waitForFunction(() => window.dashboardInstance?.config?.section === 'bookmarks', null, { timeout: 15_000 });
        await dismissOnboardingIfPresent(page);

        // subTabFromHash refused every Bookmarks tab, because the segment after
        // /bookmarks/ is usually a page filter. A page id is a number and a tab
        // is a word, so the two can be told apart — and until they were, every
        // deep link into a Bookmarks tab opened List.
        await expect.poll(() => page.evaluate(() => window.dashboardInstance.config.bmTab)).toBe('tags');
        await expect(page.locator('#config-tag-filter')).toBeVisible();
    });
});
