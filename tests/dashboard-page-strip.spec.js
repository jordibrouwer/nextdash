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
    // The strip on the centre of the band is what this file measures; the
    // default draws the pages at the right instead (page-switcher-styles.spec.js).
    await page.evaluate(async () => {
        const d = window.dashboardInstance;
        d.settings.pageSwitcherStyle = 'text';
        await d.saveSettings?.();
        d.setupDOM?.();
    });
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
    const centre = (el) => {
        const r = el.getBoundingClientRect();
        return r.top + r.height / 2;
    };
    const track = document.querySelector('.page-navigation');
    const rect = track.getBoundingClientRect();
    const chip = track.querySelector('.page-nav-overflow');
    return {
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        visible: [...track.querySelectorAll('.page-nav-btn')].filter((b) => !b.hidden).length,
        // The chip carries its count, a caret and the key that opens the
        // panel; the count is the part that says how many are folded away.
        chip: chip ? chip.querySelector('.page-nav-overflow-count').textContent.trim() : null,
        // The band has padding of its own, so "one row" is a shared centre
        // line, not a shared top edge.
        actionsY: Math.round(centre(document.querySelector('.header-actions'))),
        headerY: Math.round(centre(document.querySelector('.header-top'))),
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
    // 800: the desktop header still applies (the phone scroller starts at 767)
    // and nine named tabs cannot fit in the middle zone at that width.
    await page.setViewportSize({ width: 800, height: 900 });
    await page.waitForTimeout(500);
    // Polled: the fit runs on a frame after the resize, and under parallel load
    // that frame lands well after a fixed wait.
    await expect.poll(async () => (await strip(page)).visible, { timeout: 10_000 })
        .toBeLessThan(wide.visible);
    const narrow = await strip(page);

    expect(narrow.width, 'the track did not shrink').toBeLessThan(wide.width);
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
    // Wide enough that five tabs are a choice rather than what happens to fit:
    // the header folds by measurement now, so a narrower window answers with
    // the width instead of the cap.
    await openWithPages(page, 14, 1800);
    // The store is reset per spec file, not per test, so an earlier test's cap
    // is still in it. Zero is what a settings file written before this setting
    // existed carries, which is the state "nobody asked for a number".
    await setCap(page, 0);
    const s = await strip(page);

    /*
     * A ceiling, not a target. The header folds by measurement as well, so a
     * window that cannot hold five shows fewer -- what the cap promises is
     * that it never shows more, and that the rest are counted rather than
     * dropped.
     */
    expect(s.visible, 'the strip drew more than the default cap').toBeLessThanOrEqual(5);
    expect(s.visible, 'the strip folded to nothing').toBeGreaterThan(0);
    expect(Number(s.chip.slice(1)) + s.visible, 'the chip does not account for every page').toBe(14);
});

test('the cap holds whether tabs are named or numbered', async ({ page }) => {
    await openWithPages(page, 14, 1800);
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

    // Named tabs are wider, so the width may fold one away where numbers fit;
    // what the cap holds is the ceiling, which is the same either way.
    expect(named.visible, 'names lifted the cap').toBeLessThanOrEqual(numbered.visible);
    expect(named.visible, 'names folded the strip to nothing').toBeGreaterThan(0);
});

test('raising the cap shows more tabs, lowering it shows fewer', async ({ page }) => {
    // Wide enough that nine numbered tabs genuinely fit in the middle zone --
    // this is the cap being read, not the width running out. Numbers, not
    // names: the store is shared across this file and a sibling leaves names
    // on, which are wide enough that the header folds before the cap does.
    await openWithPages(page, 14, 1800);
    await page.evaluate(async () => {
        const d = window.dashboardInstance;
        d.settings.showPageNamesInTabs = false;
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        await api('/api/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(d.settings),
        });
        d.pageNav?.renderPageNavigation?.();
    });
    await page.waitForTimeout(400);

    /*
     * Polled rather than read once: raising the cap re-renders the strip and
     * the header re-fits itself around it, so the count settles a frame or two
     * after the setting lands.
     */
    await setCap(page, 9);
    await expect.poll(async () => (await strip(page)).visible,
        { timeout: 10_000 }).toBe(9);

    await setCap(page, 3);
    await expect.poll(async () => (await strip(page)).visible,
        { timeout: 10_000 }).toBe(3);
});

test('a narrow window still shows fewer than the cap allows', async ({ page }) => {
    // 800px: the desktop header still applies, the phone scroller starts at 767.
    // With names on, a tab is wide enough that the zone runs out first.
    await openWithPages(page, 14, 800);
    await setCap(page, 9);
    await showPageNames(page);
    await expect.poll(async () => (await strip(page)).visible, { timeout: 10_000 })
        .toBeLessThan(9);
    const s = await strip(page);
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
    expect(stored.zero, 'a settings file without the field lost its tabs').toBe(4);
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

/*
 * What the header gives up, and in which order.
 *
 * The row is one line by design and every zone in it has a natural width; once
 * they no longer add up, something has to go. Left to the browser that
 * "something" is whatever happens to be last in the markup. The order is set
 * instead, cheapest first: the destinations, then the actions, then the pages
 * button, then the strip folds to the page you are on plus the chip, and last
 * the clock — leaving the name and a switcher.
 *
 * Measured rather than pinned to fixed widths: the zones depend on the page
 * name, the font size, how many actions are on and which language the labels
 * are in, so a breakpoint that fits one install crops another.
 */
const zones = (page) => page.evaluate(() => {
    const shown = (sel) => {
        const el = document.querySelector(sel);
        return Boolean(el) && window.getComputedStyle(el).display !== 'none'
            && el.getBoundingClientRect().width > 0;
    };
    return {
        step: Number(document.body.getAttribute('data-header-fit')),
        destinations: shown('.header-destinations'),
        actions: shown('.header-shortcuts'),
        clock: shown('.date-time-line'),
        height: Math.round(document.querySelector('.header-top').getBoundingClientRect().height),
    };
});

test('the header gives things up in one order, and never grows a second row', async ({ page }) => {
    await openWithPages(page, 8, 1600);
    await showPageNames(page);

    await expect.poll(async () => (await zones(page)).step, { timeout: 10_000 }).toBe(0);
    const wide = await zones(page);
    expect(wide.destinations && wide.actions && wide.clock,
        'something is missing before anything needs to be').toBe(true);

    const seen = [wide];
    for (const width of [1300, 1150, 1000, 900, 820, 780]) {
        await page.setViewportSize({ width, height: 950 });
        await page.waitForTimeout(500);
        seen.push(await zones(page));
    }

    // One line at every width.
    for (const state of seen) {
        expect(state.height, `the header is ${state.height}px tall at step ${state.step}`)
            .toBeLessThan(80);
    }

    // The ladder only ever goes one way, and each rung means what it says.
    for (let i = 1; i < seen.length; i += 1) {
        expect(seen[i].step, 'the header un-folded as the window narrowed')
            .toBeGreaterThanOrEqual(seen[i - 1].step);
    }
    for (const state of seen) {
        if (state.step >= 1) expect(state.destinations, `step ${state.step} still shows the destinations`).toBe(false);
        if (state.step >= 2) expect(state.actions, `step ${state.step} still shows the actions`).toBe(false);
        if (state.step >= 4) expect(state.clock, `step ${state.step} still shows the clock`).toBe(false);
        // And nothing goes before its turn.
        if (state.step < 1) expect(state.destinations, 'the destinations went first at step 0').toBe(true);
        if (state.step < 2) expect(state.actions, 'the actions went before the destinations').toBe(true);
        if (state.step < 4) expect(state.clock, 'the clock went before everything else').toBe(true);
    }

    // The narrowest state still switches pages: the active tab and the chip.
    const narrow = await page.evaluate(() => ({
        tabs: [...document.querySelectorAll('#page-navigation .page-nav-btn')].filter((b) => !b.hidden).length,
        chip: Boolean(document.querySelector('.page-nav-overflow')),
    }));
    expect(narrow.tabs, 'no page to stand on').toBeGreaterThanOrEqual(1);
    expect(narrow.chip, 'nothing left to switch pages with').toBe(true);
});

/*
 * The narrowest window: the name, and one switcher.
 *
 * Three things said the time at once there — the compact date chip the narrow
 * layout draws, the clock line itself, and the mini status beside it — stacked
 * one under the other while the page tabs ran off the edge. Below the phone
 * breakpoint the row carries the page you are on and the chip that opens the
 * rest, and nothing else.
 */
test('the narrow header is the name and a page switcher', async ({ page }) => {
    await openWithPages(page, 8, 1400);

    for (const width of [520, 420, 360]) {
        await page.setViewportSize({ width, height: 950 });
        // Polled rather than slept through: crossing the breakpoint re-fits the
        // row, and the strip settles a frame or two after the resize.
        await expect.poll(() => page.evaluate(
            () => [...document.querySelectorAll('#page-navigation .page-nav-btn')]
                .filter((b) => !b.hidden).length,
        ), { timeout: 5_000 }).toBe(1);

        const seen = await page.evaluate(() => {
            const shown = (sel) => {
                const el = document.querySelector(sel);
                return Boolean(el) && window.getComputedStyle(el).display !== 'none'
                    && el.getBoundingClientRect().width > 0;
            };
            const row = document.querySelector('.header-top');
            const track = document.querySelector('.header-track');
            const title = document.querySelector('.title');
            return {
                clock: shown('.date-time-line'),
                badge: shown('#date-badge-mobile'),
                mini: shown('#dashboard-mini-status'),
                name: shown('.title'),
                tabs: [...document.querySelectorAll('#page-navigation .page-nav-btn')]
                    .filter((b) => !b.hidden).length,
                chip: Boolean(document.querySelector('.page-nav-overflow')),
                overflow: Math.max(0, Math.round(row.scrollWidth - row.clientWidth)),
                height: Math.round(row.getBoundingClientRect().height),
                // The switcher moves left, straight after the name, rather than
                // holding the place of the zones that are gone.
                afterName: track.getBoundingClientRect().left
                    < title.getBoundingClientRect().right + 80,
            };
        });

        expect(seen.name, `the page name went at ${width}px`).toBe(true);
        expect(seen.clock, `the clock is still drawn at ${width}px`).toBe(false);
        expect(seen.badge, `the date chip is still drawn at ${width}px`).toBe(false);
        expect(seen.mini, `the mini status is still drawn at ${width}px`).toBe(false);
        expect(seen.tabs, `${seen.tabs} tabs at ${width}px`).toBe(1);
        expect(seen.chip, `no switcher at ${width}px`).toBe(true);
        expect(seen.afterName, `the switcher did not move left at ${width}px`).toBe(true);
        expect(seen.overflow, `the header overflows by ${seen.overflow}px at ${width}px`).toBe(0);
        expect(seen.height, `the header is ${seen.height}px tall at ${width}px`).toBeLessThan(80);
    }
});

/*
 * The two keys beside the strip are buttons as well.
 *
 * They have always said what Shift+Left and Shift+Right do, and a reader with a
 * pointer could only read them. They walk one page now, and they stop at the
 * ends rather than wrapping: a control that looks pressable and does nothing is
 * worse than one that says it cannot.
 */
test('the walk hints move a page, and go dead at the ends', async ({ page }) => {
    await openWithPages(page, 3);
    // The text switcher hides the walk buttons; they belong to the boxed styles.
    await page.evaluate(() => {
        const d = window.dashboardInstance;
        d.settings.pageSwitcherStyle = 'segmented';
        d.setupDOM?.();
    });

    const prev = page.locator('.header-track .page-walk-hint[data-page-walk="prev"]');
    const next = page.locator('.header-track .page-walk-hint[data-page-walk="next"]');
    const current = () => page.evaluate(() => Number(window.dashboardInstance.currentPageId));
    const ids = await page.evaluate(() => window.dashboardInstance.pages.map((p) => Number(p.id)));

    // On the first page there is nothing to the left.
    await expect.poll(() => current(), { timeout: 10_000 }).toBe(ids[0]);
    await expect(prev).toBeDisabled();
    await expect(next).toBeEnabled();

    await next.click();
    await expect.poll(() => current(), { timeout: 10_000 }).toBe(ids[1]);
    await expect(prev).toBeEnabled();

    // Walk to the end -- the store may carry pages an earlier test left behind,
    // so the last one is wherever the button stops rather than the third.
    for (let i = 0; i < ids.length + 2 && await next.isEnabled(); i += 1) {
        await next.click();
        await page.waitForTimeout(150);
    }
    // Nothing to the right of the last one: the keys wrap, these do not.
    await expect(next).toBeDisabled();
    expect(await current()).toBe(ids[ids.length - 1]);

    await prev.click();
    await expect.poll(() => current(), { timeout: 10_000 }).toBe(ids[ids.length - 2]);
});

test('with one page both hints are dead', async ({ page }) => {
    await openWithPages(page, 1);
    // Trimmed through the route that removes a page: seeding only ever adds,
    // and the pages an earlier test made are still in the store.
    await page.evaluate(async () => {
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        const d = window.dashboardInstance;
        for (const id of d.pages.slice(1).map((p) => p.id)) {
            await api(`/api/pages/${id}`, { method: 'DELETE' });
        }
        await d.loadData();
        await d.pageNav?.requestPageNavigation?.(d.pages[0].id);
        d.pageNav?.renderPageNavigation?.();
    });
    await expect.poll(() => page.evaluate(
        () => window.dashboardInstance.pages.length), { timeout: 10_000 }).toBe(1);

    await expect(page.locator('.header-track .page-walk-hint[data-page-walk="prev"]')).toBeDisabled();
    await expect(page.locator('.header-track .page-walk-hint[data-page-walk="next"]')).toBeDisabled();
});

/*
 * And it keeps its place, whatever stands to the left of it.
 *
 * The left zone was `auto`, so its width was whatever the identity happened to
 * be: "config" against "main", the clock beside the name against the clock in
 * a column of its own. Every one of those moved the strip sideways -- a change
 * of clock placement in Behavior shifted the pages by 40px, and switching to a
 * view with a longer name shifted them again. The zone is a width now, and a
 * name too long for it is cut rather than paid for by the strip.
 */
test('the strip stands in the same place whatever the name and the clock do', async ({ page }) => {
    await openWithPages(page, 4);

    const at = () => page.evaluate(() => {
        const r = document.querySelector('.header-track').getBoundingClientRect();
        return Math.round(r.x);
    });
    const placeClock = async (value) => {
        await page.evaluate(async (v) => {
            const d = window.dashboardInstance;
            d.settings.headerClockPlacement = v;
            d.setupDOM?.();
            await d.saveSettings?.();
        }, value);
        await page.waitForTimeout(300);
    };
    const rename = async (name) => {
        await page.evaluate((value) => {
            document.querySelector('.header-identity .title').textContent = value;
        }, name);
        await page.waitForTimeout(200);
    };

    await placeClock('beside-name');
    const beside = await at();

    await placeClock('own-zone');
    expect(await at(), 'the clock placement moved the strip').toBe(beside);

    await rename('infrastructure-and-monitoring');
    expect(await at(), 'a long name pushed the strip').toBe(beside);

    await placeClock('beside-name');
    await rename('x');
    expect(await at(), 'a short name pulled the strip back').toBe(beside);

    /*
     * And the place it stands still in is the middle of the row.
     *
     * Holding it still was the first half: with a fixed left zone the strip
     * stopped moving, but the zone was wider than the actions on the other
     * side, so what it stood still on was 77px right of centre. The two outer
     * columns are equal now, which is what makes the middle one the middle.
     */
    const centred = await page.evaluate(() => {
        const mid = (el) => { const r = el.getBoundingClientRect(); return r.x + r.width / 2; };
        return Math.round(
            mid(document.querySelector('.header-track')) - mid(document.querySelector('.header-top')),
        );
    });
    expect(Math.abs(centred), `the strip sits ${centred}px off the centre of the row`).toBe(0);

    // What gives: the name is cut inside the zone it was given.
    const title = await page.evaluate(() => {
        const el = document.querySelector('.header-identity .title');
        el.textContent = 'infrastructure-and-monitoring-and-everything-else';
        const cs = window.getComputedStyle(el);
        return { overflow: cs.textOverflow, wrap: cs.whiteSpace };
    });
    expect(title.overflow, 'a name too long for the zone is not cut').toBe('ellipsis');
    expect(title.wrap, 'a long name wraps the header to two lines').toBe('nowrap');
});
