// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * Poll `window.scrollY` until it has stopped changing for several
 * consecutive reads, then resolve. Shared by `mountTall` (waiting out the
 * app's own boot-time scroll restore before the test drives anything) and
 * `scrollAndSettle` (waiting out a scroll the test itself just issued) so
 * there is exactly one settle-polling implementation, not two copies of the
 * same loop.
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
 * Phase 0 established that `position: sticky` works inside #dashboard-layout.
 * These tests hold that result in place and cover the collapse behaviour.
 *
 * The shell is mounted into a standalone container appended to `document.body`
 * rather than into the live `#dashboard-layout` node: the app's own background
 * rendering (dashboard-render-core.js) writes into `#dashboard-layout`
 * asynchronously and can clobber a test's mount mid-test. Sticky positions
 * against the viewport here, so a standalone container works just as well —
 * the page still needs a tall body so `document.scrollingElement` can scroll.
 */
async function mountTall(page) {
    await markWhatsNewSeen(page);
    await page.setViewportSize({ width: 1400, height: 800 });
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => window.ViewStyles?.ensureViewStyles != null, null, { timeout: 15_000 });
    await page.evaluate(() => window.ViewStyles.ensureViewStyles());
    // The dashboard boots by rendering from cache, then quietly re-fetches
    // and re-renders once the revision poll (fires on the initial focus) has
    // settled. That re-render calls `window.scrollTo` itself while
    // restoring the reader's remembered offset (dashboard-data.js,
    // `_applyLoadedPageData`) — if it lands mid-test it silently overwrites
    // whatever scroll position the test just set. This is a scroll-timing
    // race, not a network one: `networkidle` observes socket quiescence and
    // knows nothing about the rAF chain that restore runs on, so wait on the
    // condition that actually matters — scrollY has stopped moving — before
    // the test starts driving its own scroll.
    await waitForScrollSettled(page);
    await page.evaluate(() => {
        const host = document.createElement('div');
        document.body.appendChild(host);
        window.__lvsHost = host;
        window.__lvsHandle = window.ListViewShell.mount(host, {
            id: 'scratch',
            title: 'Scratch',
            description: 'A test view',
            filters: [{ key: 'all', label: 'All', count: 1, dataAttrs: { 'data-scratch-filter': 'all' } }],
            activeFilter: 'all',
            actions: [
                { key: 'go', label: 'Work through', kind: 'primary', dataAttrs: { 'data-scratch-go': '' } },
                { key: 'more', label: '⋯', dataAttrs: { 'data-scratch-more': '' } },
            ],
        });
        window.__lvsHandle.body.innerHTML = '<div style="height:4000px">tall</div>';
    });
}

/**
 * Scroll to `y` and wait until `window.scrollY` has actually settled, then
 * measure. A fixed `setTimeout` after `scrollTo` is a race: the scroll may
 * not have landed yet when the timer fires.
 *
 * We wait for `scrollY` to stop changing rather than for it to hit `y`
 * exactly: the document's scrollable height wobbles by a few pixels here as
 * unrelated content settles asynchronously, so a large `y` can legitimately
 * clamp a little short of the requested value. Waiting for stability (a
 * handful of consecutive polls reading the same value) covers both the
 * scroll landing and the `scroll` event's listener — which runs off a
 * queued task, not synchronously with `scrollTo` — having fired.
 */
async function scrollAndSettle(page, y) {
    await page.evaluate((target) => window.scrollTo(0, target), y);
    await waitForScrollSettled(page);
}

test('the header is sticky and stays on screen while the list scrolls', async ({ page }) => {
    await mountTall(page);

    const position = await page.evaluate(() => getComputedStyle(document.querySelector('.lvs-header')).position);

    await scrollAndSettle(page, 1200);

    const result = await page.evaluate(() => {
        const header = document.querySelector('.lvs-header');
        const after = header.getBoundingClientRect().top;
        const scrolled = window.scrollY;
        return { after, scrolled };
    });

    await scrollAndSettle(page, 0);

    expect(position).toBe('sticky');
    expect(result.scrolled).toBeGreaterThan(0);
    expect(result.after, 'the header scrolled away instead of sticking').toBeLessThan(40);
});

test('the header collapses on scroll and expands again at the top', async ({ page }) => {
    await mountTall(page);

    const isCollapsed = () => page.evaluate(
        () => document.querySelector('.lvs-header').classList.contains('is-collapsed'),
    );

    await scrollAndSettle(page, 0);
    const top = await isCollapsed();
    await scrollAndSettle(page, 1200);
    const down = await isCollapsed();
    await scrollAndSettle(page, 0);
    const back = await isCollapsed();

    expect({ top, down, back }).toEqual({ top: false, down: true, back: false });
});

test('the primary action stays reachable in the collapsed header', async ({ page }) => {
    await mountTall(page);

    await scrollAndSettle(page, 1200);

    const visible = await page.evaluate(() => {
        const btn = document.querySelector('[data-scratch-go]');
        const box = btn.getBoundingClientRect();
        return { top: box.top, height: box.height, inView: box.top >= 0 && box.bottom <= window.innerHeight };
    });

    expect(visible.height).toBeGreaterThan(0);
    expect(visible.inView, 'the primary action left the viewport when collapsed').toBe(true);
});

test('the breadcrumb shows the active filter only when collapsed', async ({ page }) => {
    await mountTall(page);

    await page.evaluate(() => window.__lvsHandle.setBreadcrumb('Broken · 1'));
    const text = await page.evaluate(() => document.querySelector('.lvs-crumb').textContent);
    const crumbVisible = () => page.evaluate(
        () => getComputedStyle(document.querySelector('.lvs-crumb')).display !== 'none',
    );

    await scrollAndSettle(page, 0);
    const top = await crumbVisible();
    await scrollAndSettle(page, 1200);
    const down = await crumbVisible();

    expect(text).toBe('Broken · 1');
    expect(top).toBe(false);
    expect(down).toBe(true);
});

test('destroy detaches the scroll listener', async ({ page }) => {
    await mountTall(page);

    const leaked = await page.evaluate(async () => {
        window.__lvsHandle.destroy();
        let threw = null;
        window.onerror = (msg) => { threw = String(msg); };
        window.scrollTo(0, 800);
        await new Promise((r) => setTimeout(r, 300));
        window.scrollTo(0, 0);
        return threw;
    });

    expect(leaked, 'the scroll handler ran after destroy').toBeNull();
});

test('a bad-tone filter renders with a distinct colour from the default tone', async ({ page }) => {
    await mountTall(page);

    const colours = await page.evaluate(() => {
        const host = document.createElement('div');
        document.body.appendChild(host);
        const handle = window.ListViewShell.mount(host, {
            id: 'tone-scratch',
            title: 'Tone scratch',
            filters: [
                { key: 'default', label: 'Default', count: 0 },
                { key: 'bad', label: 'Bad', count: 0, tone: 'bad' },
            ],
            // Neither compared filter is active, so `.is-active` cannot
            // confound the colour comparison — only the tone class can.
            activeFilter: 'neither',
        });
        const defaultColor = getComputedStyle(host.querySelector('[data-lvs-filter-key="default"]')).color;
        const badColor = getComputedStyle(host.querySelector('[data-lvs-filter-key="bad"]')).color;
        handle.destroy();
        host.remove();
        return { defaultColor, badColor };
    });

    expect(colours.badColor, 'the bad-tone filter must render in a distinct colour').not.toBe(colours.defaultColor);
});
