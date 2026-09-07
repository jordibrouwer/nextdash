// @ts-check
const { test, expect } = require('./fixtures');
const { dismissOnboardingIfPresent, dismissBlockingOverlays, markWhatsNewSeen, openHealthToolbarMenu } = require('./e2e-helpers');

/**
 * Every button in the health toolbar has to look like a button in the health
 * toolbar.
 *
 * "Rot report" was added to the markup and to the click handler, and never to
 * the rule its neighbours share — so it rendered as a bare browser button
 * beside them: different height, different radius, system colours. The rule
 * lists its buttons by class, which is exactly the kind of list a new button
 * gets left out of, so this compares the whole row rather than one class.
 *
 * d4e22e33 emptied that row: everything but Work through and Rot report moved
 * behind `⋯`, where .health-view-menu restyles them as menu items — flat, no
 * border, menu type. Comparing Export to Rot report now compares two things
 * deliberately drawn differently, so the row this guards is the row that is
 * left: Rot report against the overflow button standing beside it.
 */

async function openHealth(page) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 20_000 });
    await page.evaluate(() => window.dashboardInstance.health.openHealthView());
    await page.waitForSelector('.lvs-header-actions', { timeout: 20_000 });
}

const boxOf = (locator) => locator.evaluate((el) => {
    const s = getComputedStyle(el);
    return {
        borderRadius: s.borderTopLeftRadius,
        borderWidth: s.borderTopWidth,
        fontSize: s.fontSize,
        padding: `${s.paddingTop} ${s.paddingRight}`,
    };
});

test('the secondary toolbar buttons are shaped alike', async ({ page }) => {
    await openHealth(page);

    const rotBtn = page.locator('.lvs-header-actions .health-view-rot-btn');
    const moreBtn = page.locator('.lvs-header-actions [data-health-toolbar-more]');
    await expect(rotBtn).toBeVisible();
    await expect(moreBtn).toBeVisible();

    // The overflow button carries its own rule, written to match the buttons it
    // stands among rather than itself. Rot report is the one that was left out
    // of the shared rule once already.
    const rot = await boxOf(rotBtn);
    const more = await boxOf(moreBtn);
    expect(rot.borderRadius).toBe(more.borderRadius);
    expect(rot.borderWidth).toBe(more.borderWidth);
    expect(rot.padding.split(' ')[0]).toBe(more.padding.split(' ')[0]);

    // And it is styled at all — a bare button keeps the user-agent's own border.
    const border = await rotBtn.evaluate((el) => getComputedStyle(el).borderTopColor);
    const bare = await page.evaluate(() => {
        const probe = document.createElement('button');
        document.body.appendChild(probe);
        const colour = getComputedStyle(probe).borderTopColor;
        probe.remove();
        return colour;
    });
    expect(border).not.toBe(bare);
});


/*
 * Opening the view shows the top of the view.
 *
 * The filter row can scroll sideways, and the active pill was brought back with
 * scrollIntoView on every render -- which moves every scrollable ancestor, the
 * page included. So opening health scrolled the header off the top to bring a
 * pill a few pixels nearer the middle of a row that was often not overflowing
 * at all. The inbox does not do this, which is the comparison that surfaced it.
 */
/*
 * Opening the view shows the top of the view.
 *
 * The filter row can scroll sideways, and the active pill was brought back with
 * scrollIntoView on every render -- which moves every scrollable ancestor, the
 * page included. So opening health scrolled the header off the top to bring a
 * pill nearer the middle of a row that was often not overflowing at all.
 *
 * This asserts the outcome and not the mechanism. Headless Chromium does not
 * scroll for this at the sizes the runner uses, so it passed with the bug
 * present -- it is a guard against a future regression that does reproduce
 * here, not evidence the reported one is fixed. That was checked by hand
 * against the code path instead.
 */
test('opening the health view leaves the page at the top', async ({ page }) => {
    await openHealth(page);

    await expect(page.locator('.lvs-title')).toBeVisible();

    const placement = await page.evaluate(() => ({
        pageY: Math.round(window.scrollY),
        titleTop: Math.round(document.querySelector('.lvs-title').getBoundingClientRect().top),
    }));

    expect(placement.pageY).toBe(0);
    // On screen rather than above it: the heading is what the reader came to.
    expect(placement.titleTop).toBeGreaterThan(0);
});

test('picking a filter does not move the page either', async ({ page }) => {
    await openHealth(page);

    // A filter towards the right-hand end, which is the one the old code
    // scrolled the whole page to reach. Hidden rows (zero count) are still in
    // the DOM, so this picks the last one actually on screen. The rail's
    // vertical column now puts that row where the quickstart card can still
    // be showing, so it is dismissed again right before the click rather
    // than only once, back when openHealth() first opened the dashboard.
    await dismissOnboardingIfPresent(page);
    const pill = page.locator('.health-view-filter-btn:not([hidden])').last();
    await pill.click();
    await expect(pill).toHaveClass(/is-active/);

    const after = await page.evaluate(() => ({
        pageY: Math.round(window.scrollY),
        titleTop: Math.round(document.querySelector('.lvs-title').getBoundingClientRect().top),
        // And the pill it selected is still readable, which is what the
        // scrolling was for in the first place.
        pillInView: (() => {
            const active = document.querySelector('.health-view-filter-btn.is-active');
            const group = active?.closest('.health-view-filter-group');
            if (!active || !group) return null;
            const a = active.getBoundingClientRect();
            const g = group.getBoundingClientRect();
            return a.left >= g.left - 2 && a.right <= g.right + 2;
        })(),
    }));

    // The rail is its own scroll container now (.lvs-rail, overflow-y: auto),
    // stacked below a sticky header; bringing a row near the bottom of it into
    // view can nudge the outer page by a rounding pixel even though the rail
    // itself did the scrolling. That is not the bug this guards: the
    // scrollIntoView regression moved the page by hundreds of pixels to
    // recentre a pill, which this still catches.
    expect(after.pageY).toBeLessThanOrEqual(1);
    expect(after.titleTop).toBeGreaterThan(0);
    expect(after.pillInView).toBe(true);
});
