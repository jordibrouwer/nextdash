// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays,
    prepareDashboardInteraction, markInboxTutorialSeen } = require('./e2e-helpers');

/**
 * Poll `window.scrollY` until it has stopped changing for several
 * consecutive reads, then resolve. Copied from list-view-shell-sticky.spec.js
 * rather than a fixed `setTimeout`: a timer is a guess about how long the
 * scroll and the sticky header take to settle, and what this file cares
 * about is the settled position, not the delay.
 */
async function waitForScrollSettled(page) {
    await page.evaluate(() => {
        window.__lvsScrollStable = 0;
        window.__lvsScrollLast = NaN;
    });
    await page.waitForFunction(() => {
        if (window.scrollY === window.__lvsScrollLast) {
            window.__lvsScrollStable += 1;
        } else {
            window.__lvsScrollStable = 0;
            window.__lvsScrollLast = window.scrollY;
        }
        return window.__lvsScrollStable >= 4;
    }, null, { timeout: 5_000, polling: 50 });
}

/**
 * The inbox on the shared shell. Everything here drives the real view through
 * the controls a person would use, not through render functions.
 */
async function openInbox(page, titles = ['Alpha', 'Beta', 'Gamma']) {
    await markWhatsNewSeen(page);
    await markInboxTutorialSeen(page);
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.inbox != null, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await prepareDashboardInteraction(page);
    await page.evaluate(() => { window.dashboardInstance.settings.inboxEnabled = true; });
    await page.evaluate(async (list) => {
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        for (const title of list) {
            await api('/api/inbox', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url: `https://s-${title}-${Date.now()}.example/x`, title }),
            });
        }
    }, titles);
    await page.locator('#page-nav-inbox-btn').click();
    await expect(page.locator('.inbox-layout')).toBeVisible();
    await page.evaluate(() => window.dashboardInstance.inbox.loadAndRender({ refresh: true }));
    await expect.poll(() => page.evaluate(
        () => (window.dashboardInstance.inbox.items || []).length)).toBeGreaterThan(0);
}

test('the inbox renders inside the shared shell', async ({ page }) => {
    await openInbox(page);
    await expect(page.locator('#dashboard-layout.inbox-layout .lvs')).toHaveCount(1);
    await expect(page.locator('.lvs-rail')).toBeVisible();
    await expect(page.locator('.lvs-header .lvs-title')).toHaveText(/inbox/i);
    // The feed lives in the shell's body, not loose in the container.
    await expect(page.locator('.lvs-body .inbox-feed')).toHaveCount(1);
});

test('the filters live in the rail and still answer to their data attributes', async ({ page }) => {
    await openInbox(page);
    const railFilters = page.locator('.lvs-rail [data-inbox-filter]');
    await expect(railFilters).not.toHaveCount(0);

    // The old selectors still resolve — this is the contract the other specs rely on.
    await page.locator('[data-inbox-filter="unread"]').click();
    await expect(page.locator('.lvs-rail [data-inbox-filter="unread"]')).toHaveClass(/is-active/);
});

test('the tiles are gone as a separate row and folded into the filters', async ({ page }) => {
    await openInbox(page);

    // No second copy of the same control.
    await expect(page.locator('.inbox-tiles')).toHaveCount(0);

    // But the tile hooks still resolve, on the merged rail rows. A row that
    // hides at zero count stays in the DOM with the `hidden` property set
    // rather than disappearing, so the skip below has to check that, not
    // `count()` — `count()` is 1 either way.
    for (const key of ['all', 'unread', 'snoozed']) {
        const merged = page.locator(`.lvs-rail [data-inbox-tile="${key}"]`);
        if (await merged.isHidden()) continue; // snoozed hides at zero, as before
        await expect(merged).toHaveAttribute('data-inbox-filter', key);
    }
});

test('the snoozed rail row hides at zero and reappears once something is snoozed', async ({ page }) => {
    await openInbox(page);

    const snoozedRow = page.locator('.lvs-rail [data-inbox-filter="snoozed"]');
    await expect(snoozedRow).toHaveCount(1);
    // `hidden` alone would be inert if the shell's own `display: flex` beat
    // the UA sheet's `[hidden]` rule, so check both the property and that the
    // row actually occupies no layout space.
    expect(await snoozedRow.evaluate((el) => el.hidden),
        'snoozed row should carry the hidden property at zero count').toBe(true);
    const boxAtZero = await snoozedRow.boundingBox();
    expect(boxAtZero?.height ?? 0, 'a hidden row must not occupy layout height').toBe(0);

    // Snooze the way a user does: the action strip only appears on hover.
    const card = page.locator('.inbox-item').first();
    await card.hover();
    const snoozeBtn = card.locator('[data-inbox-action="snooze"]');
    await expect(snoozeBtn).toBeVisible();
    await snoozeBtn.click();
    await expect(page.locator('.inbox-snooze-menu')).toBeVisible();
    await page.locator('.inbox-snooze-option').first().click();
    await expect(page.locator('.inbox-snooze-menu')).toHaveCount(0);

    await expect(snoozedRow).toBeVisible();
    expect(await snoozedRow.evaluate((el) => el.hidden)).toBe(false);
    const boxAfter = await snoozedRow.boundingBox();
    expect(boxAfter?.height ?? 0).toBeGreaterThan(0);
});

test('"this week" is a readout in the summary, not a filter', async ({ page }) => {
    await openInbox(page);
    await expect(page.locator('.lvs-summary')).toBeVisible();
    await expect(page.locator('[data-inbox-tile="week"]'),
        '"this week" must not pretend to be a filter').toHaveCount(0);
});

test('search, sort and the overflow menu keep their hooks', async ({ page }) => {
    await openInbox(page);
    await expect(page.locator('[data-inbox-search]')).toBeVisible();
    await expect(page.locator('[data-inbox-sort]')).toBeVisible();

    await page.locator('[data-inbox-toolbar-more]').click();
    await expect(page.locator('[data-inbox-menu]')).toBeVisible();
    for (const sel of ['[data-inbox-export="csv"]', '[data-inbox-export="json"]',
        '[data-inbox-import]', '[data-inbox-stats]']) {
        await expect(page.locator(sel), `${sel} missing from the menu`).toBeVisible();
    }
});

test('Triage sits in the header, reachable while the list is scrolled', async ({ page }) => {
    // A space in the seeded title breaks the URL the seed builds
    // (`https://s-Item 0-<ts>.example/x`), and the API rejects it with 400 —
    // silently, since the seeding loop doesn't check the response. Titles
    // stay space-free so all 40 items actually land.
    await openInbox(page, Array.from({ length: 40 }, (_, i) => `Item-${i}`));
    await expect(page.locator('.lvs-header .inbox-triage-btn')).toBeVisible();

    await page.evaluate(() => window.scrollTo(0, 1500));
    await waitForScrollSettled(page);

    // Prove the page actually scrolled before trusting the in-view check
    // below — otherwise this test could pass on a page that never moved.
    const scrollY = await page.evaluate(() => window.scrollY);
    expect(scrollY, 'the page did not scroll').toBeGreaterThan(0);

    const inView = await page.evaluate(() => {
        const box = document.querySelector('.inbox-triage-btn').getBoundingClientRect();
        return box.top >= 0 && box.bottom <= window.innerHeight;
    });
    expect(inView, 'Triage scrolled out of reach').toBe(true);
});

test('the collapsed header does not say "Inbox inbox"', async ({ page }) => {
    await openInbox(page, Array.from({ length: 40 }, (_, i) => `Item-${i}`));

    await page.evaluate(() => window.scrollTo(0, 1500));
    await waitForScrollSettled(page);
    await expect(page.locator('.lvs-header')).toHaveClass(/is-collapsed/);

    // The crumb sits beside a .lvs-title that already says Inbox, so on the
    // default filter it has nothing to add.
    const title = (await page.locator('.lvs-title').textContent()) || '';
    const atRest = await page.locator('.lvs-crumb').textContent();
    expect(atRest, 'the crumb repeats the title next to it').toBe('');

    await page.locator('[data-inbox-filter="unread"]').click();
    const filtered = ((await page.locator('.lvs-crumb').textContent()) || '').trim();
    expect(filtered).toMatch(/unread/i);
    expect(filtered.toLowerCase(), 'the crumb still prefixes the page title')
        .not.toContain(title.trim().toLowerCase());

    // The browser tab still names the view — it has no title beside it to lean on.
    await expect.poll(() => page.title()).toMatch(/inbox/i);
});

test('arrow keys step past a filter the reader cannot see', async ({ page }) => {
    await openInbox(page, ['Alpha', 'Beta', 'Gamma']);

    // Which rows are hidden depends on what is in the inbox — With note is
    // always one of them here, since nothing seeded in this file carries a
    // note — so read the rail rather than hard-coding a key.
    const rows = await page.evaluate(() => [...document.querySelectorAll('.lvs-rail .lvs-filter')]
        .map((el) => ({ key: el.dataset.inboxFilter, hidden: el.hidden })));
    const visible = rows.filter((r) => !r.hidden).map((r) => r.key);
    const hidden = rows.filter((r) => r.hidden).map((r) => r.key);

    expect(hidden.length, 'setup: no filter is hidden, so this cannot fail').toBeGreaterThan(0);
    expect(visible.length).toBeGreaterThan(1);

    const last = page.locator(`.lvs-rail [data-inbox-filter="${visible[visible.length - 1]}"]`);
    await last.click();
    await expect(last).toHaveClass(/is-active/);

    await last.press('ArrowRight');

    // From the last visible row the rotation wraps to the first visible one.
    // Landing on a hidden row would be the keyboard selecting something the
    // mouse cannot click — and the row would then unhide itself, which is how
    // this went unnoticed.
    await expect.poll(() => page.evaluate(() => window.dashboardInstance.inbox.filter),
        { message: `arrow rotation landed outside the visible rows ${JSON.stringify(visible)}` })
        .toBe(visible[0]);

    const stillHidden = await page.evaluate((keys) => keys.every(
        (k) => document.querySelector(`.lvs-rail [data-inbox-filter="${k}"]`)?.hidden === true,
    ), hidden);
    expect(stillHidden, 'a hidden filter unhid itself after an arrow key').toBe(true);
});

test('the glass depth still reaches the rail', async ({ page }) => {
    await openInbox(page);

    // Exactly what applyThemeDepth (theme-loader.js:312) writes, and what the
    // server writes for the first paint. theme-character.css keys the
    // backdrop-filter off these two attributes and a list of selectors; the
    // list still named .inbox-tile and .inbox-filter-group, both deleted by
    // this branch, so the effect stopped reaching the rail entirely.
    const filters = await page.evaluate(() => {
        document.documentElement.setAttribute('data-depth', 'glass');
        document.body.setAttribute('data-depth', 'glass');
        const read = (sel) => {
            const el = document.querySelector(sel);
            return el ? getComputedStyle(el).backdropFilter : 'MISSING';
        };
        return {
            summary: read('.lvs-summary'),
            group: read('.lvs-group--filters'),
            filter: read('.lvs-rail .lvs-filter'),
            row: read('.inbox-item'),
        };
    });

    for (const [part, value] of Object.entries(filters)) {
        expect(value, `${part} is left out of the glass depth`).not.toBe('none');
        expect(value, `${part} is not in the stylesheet at all`).not.toBe('MISSING');
    }
});

test('below 720px the rail is a strip and the summary folds into the header', async ({ page }) => {
    await openInbox(page);
    await page.setViewportSize({ width: 700, height: 900 });

    // The move is made in JS (CSS cannot reparent), so poll for it rather than
    // assuming the resize has been handled by the time the next line runs.
    await expect.poll(() => page.evaluate(
        () => !!document.querySelector('.lvs-header .lvs-summary')),
    { message: 'the summary did not fold into the header' }).toBe(true);

    const narrow = await page.evaluate(() => {
        const rail = document.querySelector('.lvs-rail');
        const list = document.querySelector('.lvs-filter-list');
        const shown = [...document.querySelectorAll('.lvs-rail .lvs-filter')]
            .filter((el) => !el.hidden)
            .map((el) => Math.round(el.getBoundingClientRect().top));
        return {
            summaryInRail: !!document.querySelector('.lvs-rail .lvs-summary'),
            railHeight: rail.getBoundingClientRect().height,
            railDirection: getComputedStyle(rail).flexDirection,
            listDirection: getComputedStyle(list).flexDirection,
            listOverflowX: getComputedStyle(list).overflowX,
            filterTops: [...new Set(shown)],
            pageScrollWidth: document.documentElement.scrollWidth,
            viewport: window.innerWidth,
        };
    });

    expect(narrow.summaryInRail, 'the summary is still in the strip').toBe(false);
    expect(narrow.railDirection).toBe('row');
    expect(narrow.listDirection, 'the filters are still stacked inside the strip').toBe('row');
    expect(narrow.listOverflowX, 'the strip does not scroll sideways').toBe('auto');
    expect(narrow.filterTops.length, 'the filters are on more than one line').toBe(1);
    // 81px was the height of the broken strip: a horizontal scroller with a
    // column of filters and the summary block still inside it.
    expect(narrow.railHeight, 'the strip is more than one row tall').toBeLessThan(60);
    // The strip scrolls, never the page.
    expect(narrow.pageScrollWidth).toBeLessThanOrEqual(narrow.viewport);

    // And on a phone, which arrives narrow rather than being resized into it:
    // the shell has to place the summary when it mounts, not only when the
    // breakpoint is crossed.
    await page.reload();
    await page.waitForFunction(() => window.dashboardInstance?.inbox != null, null, { timeout: 15_000 });
    await dismissBlockingOverlays(page);
    await page.evaluate(() => { window.dashboardInstance.settings.inboxEnabled = true; });
    await page.locator('#page-nav-inbox-btn').click();
    await expect(page.locator('.inbox-layout .lvs')).toHaveCount(1);
    await expect.poll(() => page.evaluate(
        () => !!document.querySelector('.lvs-header .lvs-summary')),
    { message: 'a shell mounted below the breakpoint left the summary in the strip' }).toBe(true);
});

test('below 720px the secondary actions fold into the overflow menu', async ({ page }) => {
    await openInbox(page);
    await page.setViewportSize({ width: 700, height: 900 });

    // Primary and the ⋯ that holds the rest stay; ℹ folds away.
    await expect(page.locator('.lvs-header-actions .inbox-triage-btn')).toBeVisible();
    await expect(page.locator('[data-inbox-toolbar-more]')).toBeVisible();
    await expect(page.locator('.lvs-header-actions .inbox-help-btn')).toBeHidden();

    // Folded away, not lost.
    await page.locator('[data-inbox-toolbar-more]').click();
    const help = page.locator('[data-inbox-menu-help]');
    await expect(help, 'the explainer is unreachable below 720px').toBeVisible();
    await help.click();
    await expect(page.locator('.inbox-explain-modal')).toBeVisible();
});
