// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * Compact answers "which page am I going to" where the question is asked.
 *
 * It used to be one tab that opened the full pages panel: a modal over the
 * page, with its own scroll, its own filter and its own way out, to pick from
 * a list that is usually four items long. The control names the page you are
 * on and opens a menu under itself -- the same surface the context menus stand
 * on -- with the pages, a row that adds one, and a row into the full panel for
 * everything the menu deliberately does not do.
 */

async function seedPages(page, count) {
    await page.evaluate(async (n) => {
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        const dash = window.dashboardInstance;
        const pages = [...dash.pages];
        for (let i = pages.length; i < n; i += 1) {
            pages.push({ id: 700 + i, name: `page-${i}` });
        }
        const saved = await api('/api/pages', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(pages),
        });
        if (!saved.ok) throw new Error(`seeding pages failed: ${saved.status}`);
        await dash.loadData();
        dash.pageNav?.renderPageNavigation?.();
    }, count);
}

async function openCompact(page, pageCount = 4) {
    await page.setViewportSize({ width: 1500, height: 900 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('.bookmark-link', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await seedPages(page, pageCount);
    await page.evaluate(async () => {
        const d = window.dashboardInstance;
        d.settings.pageSwitcherStyle = 'compact';
        d.settings.showPageTabs = true;
        d.setupDOM?.();
        d.renderPageNavigation?.();
        await d.saveSettings?.();
    });
    await page.waitForTimeout(500);
}

const trigger = (page) => page.locator('.header-track .page-nav-btn.active');

test('the control names the page you are on and opens the list under itself', async ({ page }) => {
    await openCompact(page);

    await expect(trigger(page), 'the compact control is not on the row').toBeVisible();
    expect(await trigger(page).getAttribute('aria-haspopup'),
        'the control does not say it opens something').toBe('menu');
    // The count chip belongs to a strip that had to hide tabs; here there is
    // nothing to count.
    expect(await page.locator('.page-nav-overflow').count(), 'the overflow chip is back').toBe(0);

    await trigger(page).click();
    await page.waitForSelector('.page-switcher-menu', { timeout: 10_000 });

    const menu = await page.evaluate(() => {
        const el = document.querySelector('.page-switcher-menu');
        const anchor = document.querySelector('.header-track .page-nav-btn.active');
        const r = el.getBoundingClientRect();
        const a = anchor.getBoundingClientRect();
        return {
            role: el.getAttribute('role'),
            expanded: anchor.getAttribute('aria-expanded'),
            // Under the control that opened it, not over the middle of the page.
            below: Math.round(r.top) >= Math.round(a.bottom),
            pages: [...el.querySelectorAll('.page-switcher-list .page-switcher-item')].length,
            current: el.querySelector('.page-switcher-item.is-current')?.textContent?.trim(),
            foot: [...el.querySelectorAll('.page-switcher-foot .page-switcher-item')]
                .map((row) => row.querySelector('.page-switcher-item-key')?.textContent?.trim()),
            // The one surface every menu in the product stands on.
            surface: el.classList.contains('move-popover'),
            focused: document.activeElement?.className || '',
        };
    });

    expect(menu.role, 'the list is not a menu').toBe('menu');
    expect(menu.expanded, 'the control does not say it is open').toBe('true');
    expect(menu.below, 'the menu does not hang from the control').toBe(true);
    expect(menu.pages, 'the menu does not list every page').toBe(4);
    expect(menu.current, 'the page you are on is not marked').toBeTruthy();
    // Add a page, and the way to everything the menu does not do.
    expect(menu.foot, 'the two rows under the list are not there').toEqual(['⇧N', ',']);
    expect(menu.surface, 'the menu brought a surface of its own').toBe(true);
    expect(menu.focused, 'the keyboard was left on the trigger').toContain('page-switcher-item');
});

test('the arrows walk it, enter switches page, escape hands the focus back', async ({ page }) => {
    await openCompact(page);
    await trigger(page).click();
    await page.waitForSelector('.page-switcher-menu');

    const before = await page.evaluate(() => window.dashboardInstance.currentPageId);
    // The menu takes the focus on the frame after it opens, so that the click
    // that opened it cannot hand it straight back to the button.
    await expect.poll(() => page.evaluate(
        () => document.activeElement?.className || ''), { timeout: 5_000 })
        .toContain('page-switcher-item');

    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect.poll(() => page.evaluate(() => window.dashboardInstance.currentPageId), { timeout: 10_000 })
        .not.toBe(before);
    expect(await page.locator('.page-switcher-menu').count(), 'the menu stayed open after picking').toBe(0);

    // And Escape puts the reader back on the control they opened.
    await trigger(page).click();
    await page.waitForSelector('.page-switcher-menu');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);

    const after = await page.evaluate(() => ({
        open: !!document.querySelector('.page-switcher-menu'),
        focused: document.activeElement?.className || '',
        expanded: document.querySelector('.header-track .page-nav-btn.active')?.getAttribute('aria-expanded'),
    }));
    expect(after.open, 'escape left the menu open').toBe(false);
    expect(after.focused, 'the focus was dropped somewhere else').toContain('page-nav-btn');
    expect(after.expanded, 'the control still says it is open').toBe('false');
});

test('past a handful of pages the menu filters', async ({ page }) => {
    await openCompact(page, 11);
    await trigger(page).click();
    await page.waitForSelector('.page-switcher-menu');

    const filter = page.locator('.page-switcher-filter-input');
    await expect(filter, 'a long list has no filter').toBeVisible();

    await filter.fill('page-9');
    await page.waitForTimeout(200);

    const left = await page.evaluate(() => [...document.querySelectorAll('.page-switcher-list .page-switcher-item')]
        .filter((row) => !row.hidden)
        .map((row) => row.querySelector('.page-switcher-item-name')?.textContent?.trim()));

    expect(left, 'the filter left the wrong rows standing').toEqual(['page-9']);

    // The rows under the list are about the list, so the filter leaves them.
    await expect(page.locator('.page-switcher-foot .page-switcher-item').first()).toBeVisible();
});

test('the menu adds a page without sending you to the panel', async ({ page }) => {
    await openCompact(page);
    await trigger(page).click();
    await page.waitForSelector('.page-switcher-menu');

    await page.locator('.page-switcher-add').click();
    await page.waitForTimeout(300);

    const box = page.locator('.page-switcher-menu .inline-create-row, .page-switcher-create');
    await expect(box.first(), 'no way to name the new page').toBeVisible();

    await page.keyboard.type('from-the-menu');
    await page.keyboard.press('Enter');

    await expect.poll(() => page.evaluate(
        () => window.dashboardInstance.pages.map((p) => p.name)), { timeout: 15_000 })
        .toContain('from-the-menu');
    // And it takes you there, the way the panel does.
    await expect.poll(() => page.evaluate(() => {
        const d = window.dashboardInstance;
        return d.pages.find((p) => d.samePageId(p.id, d.currentPageId))?.name;
    }), { timeout: 10_000 }).toBe('from-the-menu');
});
