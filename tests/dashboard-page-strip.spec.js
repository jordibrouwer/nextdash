// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * The page track keeps a footprint, however many pages there are.
 *
 * It was `flex-wrap: wrap`, so a page that did not fit added a second row to
 * the header and carried the toolbar icons down with it — the one part of the
 * bar that should never move was the part that moved most, and it moved
 * because of something happening at the other end of the row.
 *
 * The track is one line now. It shrinks before anything else in the header
 * does, and the tabs it can no longer show are counted on a chip that opens
 * the page overview, where the whole list lives.
 *
 * Below 767px the phone rules take over and turn the track into a horizontal
 * scroller; that behaviour predates this and is left alone. These tests stay
 * in the range where the desktop header applies.
 */

/** Give the dashboard enough pages that the track has to make a choice. */
async function seedPages(page, count) {
    await page.evaluate(async (n) => {
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        const dash = window.dashboardInstance;
        const pages = [...dash.pages];
        for (let i = pages.length; i < n; i += 1) {
            pages.push({ id: 1000 + i, name: `page-${i}` });
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

async function openWithPages(page, count, width = 1500) {
    await page.setViewportSize({ width, height: 900 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('.bookmark-link', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await seedPages(page, count);
    await page.waitForTimeout(600);
}

const strip = (page) => page.evaluate(() => {
    const track = document.querySelector('.page-navigation');
    const rect = track.getBoundingClientRect();
    const chip = track.querySelector('.page-nav-overflow');
    return {
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        visible: [...track.querySelectorAll('.page-nav-btn')].filter((b) => !b.hidden).length,
        chip: chip ? chip.textContent.trim() : null,
        actionsY: Math.round(document.querySelector('.header-actions').getBoundingClientRect().top),
        headerY: Math.round(document.querySelector('.header-top').getBoundingClientRect().top),
    };
});

test('fourteen pages do not give the header a second row', async ({ page }) => {
    await openWithPages(page, 14);
    const s = await strip(page);

    // One line of tabs: the wrap is what used to push the toolbar down.
    expect(s.height, `the track is ${s.height}px tall`).toBeLessThan(48);
    expect(s.actionsY, 'the toolbar dropped onto a second row').toBe(s.headerY);
});

test('what the track cannot show is counted, not dropped', async ({ page }) => {
    await openWithPages(page, 14, 880);
    const s = await strip(page);

    expect(s.chip, 'no overflow chip at a width where the tabs do not fit').toMatch(/^\+\d+$/);
    const hidden = Number(s.chip.slice(1));
    expect(s.visible + hidden, 'the chip does not account for every page')
        .toBeGreaterThanOrEqual(14);
    // Still one row, still one line.
    expect(s.actionsY).toBe(s.headerY);
});

test('the track gives up width before the toolbar does', async ({ page }) => {
    await openWithPages(page, 14);
    const wide = await strip(page);
    await page.setViewportSize({ width: 880, height: 900 });
    await page.waitForTimeout(500);
    const narrow = await strip(page);

    expect(narrow.width, 'the track did not shrink').toBeLessThan(wide.width);
    expect(narrow.visible, 'the track kept every tab in less room').toBeLessThan(wide.visible);
    expect(narrow.actionsY, 'the header wrapped instead of the track shrinking').toBe(narrow.headerY);
});

test('the page you are on is never the one folded away', async ({ page }) => {
    await openWithPages(page, 14, 800);

    const activeShown = await page.evaluate(() => {
        const active = document.querySelector('.page-navigation .page-nav-btn.active');
        return active ? !active.hidden : 'no active tab';
    });
    expect(activeShown, 'the active page was folded into the chip').toBe(true);
});

test('the chip opens the list it stands for', async ({ page }) => {
    await openWithPages(page, 14, 880);

    await page.locator('.page-nav-overflow').click();
    // The overview is where every page lives; the chip is a way to it. It is
    // an AppModal with its own class, not an overlay element of its own.
    await expect(page.locator('#app-modal.show .page-overview-modal'))
        .toBeVisible({ timeout: 10_000 });
});
