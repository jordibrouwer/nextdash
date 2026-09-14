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

/** Label the tabs with page names, which are several times wider than a digit. */
async function showPageNames(page) {
    await page.evaluate(async () => {
        const dash = window.dashboardInstance;
        dash.settings.showPageNamesInTabs = true;
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        await api('/api/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(dash.settings),
        });
        dash.pageNav?.renderPageNavigation?.();
    });
    await page.waitForTimeout(400);
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
    // Raised past the default cap, so what the two measurements differ by is
    // the width and nothing else -- and with names on a tab is wide enough that
    // the width is what runs out first, whatever else is in the header.
    await setCap(page, 9);
    await showPageNames(page);
    const wide = await strip(page);
    await page.setViewportSize({ width: 900, height: 900 });
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

/**
 * Width was never enough of a limit on its own.
 *
 * A tab labelled "7" measures 28px where one labelled "websites" measures
 * 87px, so the same header carried ten tabs with page names off and four with
 * them on — the count followed a toggle that has nothing to do with how many
 * pages belong in a header. `maxPageTabs` is the count, and the width pass
 * still applies underneath it: a narrow window shows fewer, never more.
 */

/** Set the cap the way config does, and let the strip re-measure. */
async function setCap(page, n) {
    await page.evaluate(async (value) => {
        const dash = window.dashboardInstance;
        dash.settings.maxPageTabs = value;
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        const saved = await api('/api/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(dash.settings),
        });
        if (!saved.ok) throw new Error(`saving settings failed: ${saved.status}`);
        dash.pageNav?.renderPageNavigation?.();
    }, n);
    await page.waitForTimeout(400);
}

test('the header draws five tabs by default, not every page that fits', async ({ page }) => {
    await openWithPages(page, 14);
    // The store is reset per spec file, not per test, so an earlier test's cap
    // is still in it. Zero is what a settings file written before this setting
    // existed carries, which is the state "nobody asked for a number".
    await setCap(page, 0);
    const s = await strip(page);

    expect(s.visible, 'the strip drew more than the default cap').toBe(5);
    expect(s.chip, 'the rest were dropped rather than counted').toBe('+9');
});

test('the cap holds whether tabs are named or numbered', async ({ page }) => {
    await openWithPages(page, 14);
    const numbered = await strip(page);

    await page.evaluate(async () => {
        const dash = window.dashboardInstance;
        dash.settings.showPageNamesInTabs = true;
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        await api('/api/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(dash.settings),
        });
        dash.pageNav?.renderPageNavigation?.();
    });
    await page.waitForTimeout(400);
    const named = await strip(page);

    expect(named.visible, 'names and numbers gave two different headers')
        .toBe(numbered.visible);
});

test('raising the cap shows more tabs, lowering it shows fewer', async ({ page }) => {
    await openWithPages(page, 14);

    await setCap(page, 9);
    expect((await strip(page)).visible, 'the cap of 9 was not honoured').toBe(9);

    await setCap(page, 3);
    expect((await strip(page)).visible, 'the cap of 3 was not honoured').toBe(3);
});

test('a narrow window still shows fewer than the cap allows', async ({ page }) => {
    // 880px: the desktop header still applies, the phone scroller starts at 767.
    await openWithPages(page, 14, 880);
    await setCap(page, 9);
    const s = await strip(page);

    expect(s.visible, 'the cap overruled the width measurement').toBeLessThan(9);
    expect(s.actionsY, 'the header wrapped').toBe(s.headerY);
});

test('the server refuses a cap outside 3-9', async ({ page }) => {
    await openWithPages(page, 14);

    const stored = await page.evaluate(async () => {
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        const dash = window.dashboardInstance;
        const send = async (value) => {
            await api('/api/settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ...dash.settings, maxPageTabs: value }),
            });
            const read = await (await api('/api/settings')).json();
            return read.maxPageTabs;
        };
        return { high: await send(40), low: await send(1), zero: await send(0) };
    });

    expect(stored.high, '40 tabs were accepted').toBe(9);
    expect(stored.low, '1 tab was accepted').toBe(3);
    // An older settings file carries no value at all, which arrives as 0.
    expect(stored.zero, 'a settings file without the field lost its tabs').toBe(5);
});

test('a folded-away page takes the slot right before the chip', async ({ page }) => {
    await openWithPages(page, 14);
    await setCap(page, 3);
    // The last page is far outside the first three, so it can only appear by
    // being swapped in.
    await page.evaluate(() => {
        const dash = window.dashboardInstance;
        return dash.pageNav.requestPageNavigation(dash.pages[dash.pages.length - 1].id);
    });
    await page.waitForTimeout(400);

    const where = await page.evaluate(() => {
        const track = document.querySelector('.page-navigation');
        const shown = [...track.querySelectorAll('.page-nav-btn')].filter((b) => !b.hidden);
        const chip = track.querySelector('.page-nav-overflow');
        const active = track.querySelector('.page-nav-btn.active');
        return {
            count: shown.length,
            activeIsLast: shown[shown.length - 1] === active,
            // The chip stands after the tabs, so the active tab is the last
            // thing before it — the slot the strip keeps for "where you are".
            chipFollowsActive: chip ? chip.previousElementSibling === active : 'no chip',
        };
    });

    expect(where.count, 'the cap slipped when the active page was swapped in').toBe(3);
    expect(where.activeIsLast, 'the active page is not in the slot before the chip').toBe(true);
    expect(where.chipFollowsActive, 'something stands between the active tab and the chip').toBe(true);
});
