// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * "Find tags for this category": the header menu hands the tag search only the
 * bookmarks of that page and category, and the tag-suggestions card names the
 * category with the largest pile of untagged bookmarks.
 */

async function openDashboard(page) {
    await page.setViewportSize({ width: 1400, height: 900 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });
}

/** A category that is on screen, its id, and the page it is on. */
async function shownCategory(page) {
    return page.evaluate(() => {
        const d = window.dashboardInstance;
        const el = [...document.querySelectorAll('.category')].find((e) => e.getAttribute('data-category-id')
            && (d.categories || []).some((c) => String(c.id) === e.getAttribute('data-category-id')));
        const id = el.getAttribute('data-category-id');
        const cat = d.categories.find((c) => String(c.id) === id);
        return { id, name: cat.name, pageId: d.currentPageId };
    });
}

async function pickFindTags(page, id) {
    const title = page.locator(`.category[data-category-id="${id}"] .category-title`).first();
    await title.scrollIntoViewIfNeeded();
    await title.click({ button: 'right' });
    const entry = page.locator('#category-context-menu [role="menuitem"]', { hasText: 'Find tags for this category' });
    await expect(entry).toBeVisible();
    await entry.click();
}

const spy = (page) => page.evaluate(() => {
    window.__tagSearches = [];
    window.dashboardInstance.config.runTagSearch = async (list) => { window.__tagSearches.push(list); };
});

test('the category menu searches only that page and category', async ({ page }) => {
    await openDashboard(page);
    const cat = await shownCategory(page);
    await spy(page);
    await page.evaluate(({ id, pageId }) => {
        const d = window.dashboardInstance;
        // Same category id and name on another page, plus another category here.
        d.allBookmarks = d.allBookmarks.filter((b) => !(String(b.category) === String(id)))
            .concat([
                { name: 'mine-a', url: 'https://mine-a.example', pageId, category: id, tags: [] },
                { name: 'mine-b', url: 'https://mine-b.example', pageId, category: id, tags: [] },
                { name: 'other', url: 'https://other.example', pageId: Number(pageId) + 99, category: id, tags: [] },
            ]);
    }, cat);
    await pickFindTags(page, cat.id);
    await expect.poll(() => page.evaluate(() => window.__tagSearches.length)).toBe(1);
    const names = await page.evaluate(() => window.__tagSearches[0].map((b) => b.name).sort());
    expect(names).toEqual(['mine-a', 'mine-b']);
});

test('an empty category says so instead of searching', async ({ page }) => {
    await openDashboard(page);
    const cat = await shownCategory(page);
    await spy(page);
    await page.evaluate(({ id }) => {
        const d = window.dashboardInstance;
        d.allBookmarks = d.allBookmarks.filter((b) => String(b.category) !== String(id));
    }, cat);
    await pickFindTags(page, cat.id);
    await expect(page.getByText('There are no bookmarks in this category to look for tags for.').first())
        .toBeVisible();
    expect(await page.evaluate(() => window.__tagSearches.length)).toBe(0);
});

test('the tag card names the category with the most untagged bookmarks', async ({ page }) => {
    await openDashboard(page);
    const cat = await shownCategory(page);
    const result = await page.evaluate(({ id, pageId }) => {
        const d = window.dashboardInstance;
        const N = window.TagSuggestionsNotice;
        const rest = d.allBookmarks.map((b) => ({ ...b, tags: ['x'] }));
        const make = (n, page_) => Array.from({ length: n }, (_, i) => ({
            name: `u${i}`, url: `https://u${i}.example`, pageId: page_, category: id, tags: [],
        }));
        d.allBookmarks = rest.concat(make(6, pageId));
        const six = N.topUntaggedCategory();
        d.allBookmarks = rest.concat(make(4, pageId));
        const four = N.topUntaggedCategory();
        return { six, four };
    }, cat);
    expect(result.six).toEqual({ name: cat.name, count: 6 });
    expect(result.four).toBeNull();
});
