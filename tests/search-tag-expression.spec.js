// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissBlockingOverlays, dismissOnboardingIfPresent } = require('./e2e-helpers');

/**
 * Tag mode: # opens it from the palette, and tags are joined with AND / OR,
 * written the same in every language.
 */

const LIST = [
    { name: 'Compose', url: 'https://compose.test', tags: ['docker', 'linux'] },
    { name: 'Hub', url: 'https://hub.test', tags: ['docker'] },
    { name: 'Kernel', url: 'https://kernel.test', tags: ['linux', 'news'] },
    { name: 'Daily', url: 'https://daily.test', tags: ['news'] },
];

async function dashboard(page) {
    await page.setViewportSize({ width: 1400, height: 900 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => window.dashboardInstance?.searchComponent != null, null, { timeout: 20_000 });
    await page.evaluate((list) => {
        window.dashboardInstance.searchComponent._collectFilterBookmarkPool = () => list;
    }, LIST);
}

const internal = (page) => page.evaluate(() => window.dashboardInstance.searchComponent.currentQuery);
const names = (page) => page.evaluate(() => window.dashboardInstance.searchComponent.searchMatches
    .filter((m) => m.type === 'bookmark').map((m) => m.bookmark.name).sort());
const rows = (page) => page.evaluate(() => window.dashboardInstance.searchComponent.searchMatches
    .filter((m) => m.type === 'filter-completion').map((m) => m.completion));

async function openTags(page) {
    await dashboard(page);
    await page.keyboard.type('>');
    await expect(page.locator('#shortcut-search.show')).toBeVisible();
    await page.keyboard.type('#');
    await expect.poll(() => internal(page)).toBe('tag:');
}

test('# in the palette goes straight to tags, and the field stays empty', async ({ page }) => {
    await openTags(page);
    await expect(page.locator('#search-query')).toHaveText('');
});

test('AND wants both tags', async ({ page }) => {
    await openTags(page);
    await page.keyboard.type('docker AND linux');
    await expect.poll(() => names(page)).toEqual(['Compose']);
});

test('OR takes either tag', async ({ page }) => {
    await openTags(page);
    await page.keyboard.type('docker OR news');
    await expect.poll(() => names(page)).toEqual(['Compose', 'Daily', 'Hub', 'Kernel']);
});

test('AND binds tighter than OR', async ({ page }) => {
    await openTags(page);
    await page.keyboard.type('docker AND linux OR news');
    await expect.poll(() => names(page)).toEqual(['Compose', 'Daily', 'Kernel']);
});

test('two tags with no operator mean AND', async ({ page }) => {
    await openTags(page);
    await page.keyboard.type('linux news');
    await expect.poll(() => names(page)).toEqual(['Kernel']);
});

test('after a tag and a space AND and OR are offered; after AND the tags are', async ({ page }) => {
    await openTags(page);
    await page.keyboard.type('docker ');
    // The Filters group is closed once the bookmarks are there; its rows are still what is offered.
    await expect.poll(() => page.evaluate(() => window.dashboardInstance.searchComponent._tagModeCompletions().map((m) => m.completion)))
        .toEqual(['tag:docker AND ', 'tag:docker OR ']);
    await page.keyboard.type('AND ');
    await expect.poll(async () => (await rows(page)).includes('tag:docker AND linux ')).toBe(true);
});

test('a half-typed tag completes in place, after an operator too', async ({ page }) => {
    await openTags(page);
    await page.keyboard.type('docker OR li');
    await expect.poll(() => rows(page)).toEqual(['tag:docker OR linux ']);
});

test('a # in front of a tag changes nothing, one or two of them', async ({ page }) => {
    await openTags(page);
    await page.keyboard.type('#docker AND ##linux');
    await expect.poll(() => names(page)).toEqual(['Compose']);
});

test('#tag in a plain search is the tag filter', async ({ page }) => {
    await dashboard(page);
    await page.keyboard.type('>');
    await expect(page.locator('#shortcut-search.show')).toBeVisible();
    await page.keyboard.type('x #news');
    // "x" is a search word no bookmark here has; the tag alone narrows to news.
    const filters = await page.evaluate(() => {
        const s = window.dashboardInstance.searchComponent;
        return s.parseSearchFilters('mail #news ##linux').filters.tag + '|' + s.parseSearchFilters('-#docker').filters.not.tag + '|' + s.parseSearchFilters('mail #').query;
    });
    expect(filters).toBe('linux|docker|mail');
});

test('# on the dashboard opens the palette on the tags', async ({ page }) => {
    await dashboard(page);
    await page.keyboard.press('Shift+Digit3');
    await expect.poll(() => internal(page)).toBe('tag:');
    await expect(page.locator('#shortcut-search.show')).toBeVisible();
    await expect(page.locator('#shortcut-search')).toContainText('#');
    await expect(page.locator('.search-chevron').first()).toHaveText('#');
});

const firstSelectable = (page) => page.evaluate(() => {
    const m = window.dashboardInstance.searchComponent.searchMatches.find((x) => x.type !== 'command-group-header');
    return m ? m.type : null;
});

test('a finished expression lists bookmarks first, so Enter opens one instead of filling AND in', async ({ page }) => {
    await openTags(page);
    await page.keyboard.type('docker ');
    await expect.poll(() => firstSelectable(page)).toBe('bookmark');
});

test('a word that is not yet a whole tag still offers its completions first', async ({ page }) => {
    await openTags(page);
    await page.keyboard.type('doc');
    await expect.poll(() => firstSelectable(page)).toBe('filter-completion');
});

test('a minus leaves a tag out, as -tag: and -#tag do', async ({ page }) => {
    await openTags(page);
    await page.keyboard.type('docker -linux');
    await expect.poll(() => names(page)).toEqual(['Hub']);
    for (let i = 0; i < 'docker -linux'.length; i += 1) await page.keyboard.press('Backspace');
    await page.keyboard.type('docker -tag:linux');
    await expect.poll(() => names(page)).toEqual(['Hub']);
    for (let i = 0; i < 'docker -tag:linux'.length; i += 1) await page.keyboard.press('Backspace');
    await page.keyboard.type('docker -#linux');
    await expect.poll(() => names(page)).toEqual(['Hub']);
});

test(':save after a tag search keeps that search', async ({ page }) => {
    await openTags(page);
    await page.keyboard.type('docker AND linux');
    await expect.poll(() => page.evaluate(() => window.dashboardInstance.searchComponent.lastNonCommandQuery)).toBe('tag:docker AND linux');
});

test('#123 and a colour stay text; a real tag after # is a filter', async ({ page }) => {
    await dashboard(page);
    const out = await page.evaluate(() => {
        const s = window.dashboardInstance.searchComponent;
        const a = s.parseSearchFilters('issue #123');
        const b = s.parseSearchFilters('css #ff0000');
        const c = s.parseSearchFilters('#add');
        return [a.query, a.filters.tag, b.query, b.filters.tag, c.query, c.filters.tag].join('|');
    });
    expect(out).toBe('issue #123||css #ff0000|||add');
});

test('a # starting a finder query is text, not the tag mode', async ({ page }) => {
    await dashboard(page);
    await page.keyboard.type('>');
    await expect(page.locator('#shortcut-search.show')).toBeVisible();
    await page.keyboard.type('!');
    await page.keyboard.type('g #');
    await expect.poll(() => internal(page)).toMatch(/^!G? ?#?/);
    expect(await internal(page)).not.toBe('tag:');
});
