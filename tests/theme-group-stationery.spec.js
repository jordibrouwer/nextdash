// @ts-check
const { test, expect } = require('./fixtures');
const {
    WRITE_TOKEN, markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays,
} = require('./e2e-helpers');

/**
 * The Stationery group: one bookmark per line, with the white between the lines
 * as the only separator. These specs measure what a reader sees and does with
 * the rows, not how they are painted: the gap between lines, the register
 * numbers, the lens that dims the other lines, the margin the heading hangs
 * in, and that the rows settings still work underneath.
 */

async function openWith(page, theme, settings = {}) {
    await markWhatsNewSeen(page);
    const response = await page.request.post('/api/settings', {
        data: { theme, layoutPreset: 'masonry', ...settings },
        headers: { 'X-NextDash-Token': WRITE_TOKEN },
    });
    if (!response.ok()) throw new Error(`settings failed: HTTP ${response.status()}`);
    await page.goto('/');
    await page.waitForSelector('.bookmark-link', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.evaluate(() => {
        ['inboxTutorialV3', 'bookmarksTutorialV1', 'containersTutorialV3', 'dashboardTutorialV3', 'changesTourV1', 'widgetsTutorialV2']
            .forEach((id) => window.DiscoverabilityState?.markTipSeen?.(id, { persist: true }));
    });
}

/** A category that is a plain list, with at least three rows to compare. */
const LIST = '.category:not([data-view="tiles"]):not(.dashboard-widget):has(.bookmarks-list > .bookmark-link:nth-child(3)) .bookmarks-list';

/** The CSS only draws for these themes, so the page has to have taken the id. */
async function expectTheme(page, theme) {
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
}

test.describe('Stationery group', () => {
    test('ledger: a numbered register with room between the lines', async ({ page }) => {
        await openWith(page, 'stationery-ledger-light');
        await expectTheme(page, 'stationery-ledger-light');
        const list = page.locator(LIST).first();
        await expect(list).toBeVisible();

        const gap = await list.evaluate((el) => parseFloat(getComputedStyle(el).rowGap));
        expect(gap, 'the gap is the separator').toBeGreaterThan(10);

        // Computed style reports a counter as its expression, not its value, so
        // this checks that every line carries the register mark.
        const marks = await list.evaluate((el) => [...el.children].slice(0, 3).map(
            (row) => getComputedStyle(row.querySelector('.bookmark-lead'), '::before').content));
        expect(marks.every((m) => m.includes('counter(st-row'))).toBe(true);

        // No rule under a line: the paper material draws one, this group removes it.
        const shadow = await list.locator('> .bookmark-link:not(.status-offline)').first()
            .evaluate((el) => getComputedStyle(el).boxShadow);
        expect(shadow).toBe('none');
    });

    test('ledger: the register stays with icons off and a keyboard selection stays visible', async ({ page }) => {
        await openWith(page, 'stationery-ledger-dark', { showIcons: false });
        const list = page.locator(LIST).first();
        const second = list.locator('> .bookmark-link').nth(1);
        await expect(second.locator('.bookmark-icon-slot')).toHaveCount(0);
        expect(await second.locator('.bookmark-lead').evaluate(
            (el) => getComputedStyle(el, '::before').content)).toContain('counter(st-row');

        await second.evaluate((el) => el.classList.add('keyboard-selected'));
        const marked = await second.evaluate((el) => {
            const cs = getComputedStyle(el);
            return cs.boxShadow !== 'none' && cs.backgroundColor !== 'rgba(0, 0, 0, 0)';
        });
        expect(marked, 'the selected line has to differ from the rest').toBe(true);
    });

    test('swiss poster (gallery id): numbered categories and lines, the keyboard line inverted', async ({ page }) => {
        await openWith(page, 'stationery-gallery-light');
        await expectTheme(page, 'stationery-gallery-light');
        const category = page.locator('.category:not([data-view="tiles"]):not(.dashboard-widget)').first();
        // The huge numeral is the category's ::before; computed style reports the counter expression.
        const numeral = await category.evaluate((el) => {
            const cs = getComputedStyle(el, '::before');
            return { content: cs.content, size: parseFloat(cs.fontSize) };
        });
        expect(numeral.content, 'a two-digit numeral').toMatch(/\d\d|counter\(st-cat/);
        expect(numeral.size, 'a poster numeral').toBeGreaterThan(40);

        // Numerals run 01, 02, 03 across the masonry columns, widgets included.
        await expect.poll(() => page.evaluate(() => [...document.querySelectorAll('#dashboard-layout .category:not([data-view="tiles"])')]
            .map((el) => el.getAttribute('data-st-n')).filter(Boolean).join(','))).toMatch(/^01,02,03,04/);
        // A widget has the page's own colour, like a category.
        const grounds = await page.evaluate(() => ['.category:not([data-view="tiles"]):not(.dashboard-widget)', '.category.dashboard-widget']
            .map((q) => getComputedStyle(document.querySelector(q)).backgroundColor));
        expect(grounds[1]).toBe(grounds[0]);
        // And the numbers come off again when the theme changes.
        await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'look-ocean-dark'));
        await expect.poll(() => page.locator('[data-st-n]').count()).toBe(0);
        await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'stationery-gallery-light'));
        await expect.poll(() => page.locator('[data-st-n]').count()).toBeGreaterThan(2);

        const list = page.locator(LIST).first();
        const second = list.locator('> .bookmark-link').nth(1);
        expect(await second.locator('.bookmark-lead').evaluate(
            (el) => getComputedStyle(el, '::before').content)).toContain('counter(st-row');

        await second.evaluate((el) => el.classList.add('keyboard-selected'));
        const colours = () => second.evaluate((el) => ({
            bg: getComputedStyle(el).backgroundColor,
            fg: getComputedStyle(el.querySelector('.bookmark-text')).color,
        }));
        // The row's colour transitions, so wait for it to settle.
        await expect.poll(async () => (await colours()).bg, { message: 'the selected line is a solid block' }).not.toBe('rgba(0, 0, 0, 0)');
        await expect.poll(async () => { const c = await colours(); return c.fg === c.bg; }, { message: 'its text is reversed out of it' }).toBe(false);
    });

    test('typewriter: the heading is a ribbon across the top of an index card', async ({ page }) => {
        await page.setViewportSize({ width: 1400, height: 900 });
        await openWith(page, 'stationery-typewriter-dark', { columnsPerRow: 2 });
        await expectTheme(page, 'stationery-typewriter-dark');
        const category = page.locator('.category:not([data-view="tiles"]):not(.dashboard-widget)').first();
        const title = await category.locator('> .category-title').boundingBox();
        const body = await category.locator('> .category-body').boundingBox();
        const card = await category.boundingBox();
        expect(title && body && card).toBeTruthy();
        expect(title.y + title.height, 'ribbon sits above the lines').toBeLessThanOrEqual(body.y + 1);
        expect(title.width, 'ribbon spans the card').toBeGreaterThan(card.width - 4);

        // A widget is the same card: same paper, same ribbon colour.
        const look = await page.evaluate(() => {
            const pick = (el) => ({
                paper: getComputedStyle(el).backgroundColor,
                ribbon: getComputedStyle(el.querySelector(':scope > .category-title')).backgroundColor,
            });
            return [pick(document.querySelector('.category:not([data-view="tiles"]):not(.dashboard-widget)')), pick(document.querySelector('.category.dashboard-widget'))];
        });
        expect(look[1]).toEqual(look[0]);

        // Offline lines are typed over.
        const struck = await page.evaluate(() => {
            const row = document.querySelector('.category:not([data-view="tiles"]) .bookmark-link');
            row.classList.add('status-offline');
            return getComputedStyle(row.querySelector('.bookmark-text')).textDecorationLine;
        });
        expect(struck).toContain('line-through');

        // The reading line: a hovered row gets a bar on its left edge.
        const row = category.locator('.bookmarks-list > .bookmark-link').nth(1);
        await row.hover();
        await expect.poll(() => row.evaluate((el) => getComputedStyle(el).boxShadow)).not.toBe('none');
    });

    test('zen: the heading is a vertical stamp on a scroll, at every width', async ({ page }) => {
        await page.setViewportSize({ width: 1400, height: 900 });
        await openWith(page, 'stationery-zen-dark', { columnsPerRow: 2 });
        const title = page.locator('.category:not([data-view="tiles"]):not(.dashboard-widget) > .category-title').first();
        expect(await title.locator('.category-title-label').evaluate((el) => getComputedStyle(el).writingMode)).toBe('vertical-rl');
        expect(await title.evaluate((el) => getComputedStyle(el).position)).toBe('absolute');

        // A widget hangs on the same paper as a category.
        const paper = await page.evaluate(() => {
            const bg = (el) => el && getComputedStyle(el).backgroundColor;
            return [bg(document.querySelector('.category:not([data-view="tiles"]):not(.dashboard-widget)')), bg(document.querySelector('.category.dashboard-widget'))];
        });
        expect(paper[1]).toBe(paper[0]);

        await page.setViewportSize({ width: 390, height: 800 });
        expect(await title.locator('.category-title-label').evaluate((el) => getComputedStyle(el).writingMode)).toBe('vertical-rl');
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    });

    test('the launcher layout keeps its own rows', async ({ page }) => {
        await openWith(page, 'stationery-ledger-light', { layoutPreset: 'launcher' });
        const content = await page.locator('.bookmark-link .bookmark-lead').first()
            .evaluate((el) => getComputedStyle(el, '::before').content);
        expect(content === 'none' || content === 'normal').toBe(true);
    });
});
