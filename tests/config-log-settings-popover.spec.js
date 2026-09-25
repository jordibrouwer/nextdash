// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * The gear's popover on Logs → Server log opens at the gear, inside the window.
 *
 * It is position: fixed inside the log panel, and under the Glass depth that
 * panel carries a backdrop-filter -- which makes it, not the window, what
 * "fixed" is measured from. The popover then landed hundreds of pixels below
 * and to the right of the gear, and past the window's right edge. Glass is
 * set here on purpose: on a flat theme the two frames coincide and the bug
 * does not show.
 */

async function openLogsWithGlass(page) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    // The depth is a server setting, and another worker on the same server can
    // write a different one between this save and the reload -- the page then
    // came up "rich". Save and reload until the page actually shows glass.
    await expect(async () => {
        await page.evaluate(async () => {
            await window.nextDashFetch('/api/settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ themeDepth: 'glass' }),
            });
        });
        await page.reload();
        await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
        await expect(page.locator('body')).toHaveAttribute('data-depth', 'glass', { timeout: 2000 });
    }).toPass({ timeout: 30_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.evaluate(() => window.dashboardInstance.config.openConfigView('logs'));
    await expect(page.locator('[data-log-settings-toggle]')).toBeVisible();
}

/** Gear and popover boxes, once the open animation has settled. */
async function boxes(page) {
    // The popover grows in from 97% and 6px higher; measured mid-way it reads
    // a dozen pixels off where it lands.
    await page.locator('#config-log-settings-popover').evaluate((el) =>
        Promise.all(el.getAnimations().map((a) => a.finished)));
    const read = () => page.evaluate(() => {
        const g = document.querySelector('[data-log-settings-toggle]').getBoundingClientRect();
        const el = document.querySelector('#config-log-settings-popover');
        const p = el.getBoundingClientRect();
        return {
            scrolls: el.scrollHeight > el.clientHeight + 1,
            gear: { top: g.top, bottom: g.bottom, right: g.right },
            pop: { top: p.top, bottom: p.bottom, left: p.left, right: p.right },
            vw: window.innerWidth,
            vh: window.innerHeight,
        };
    });
    let last = await read();
    await expect.poll(async () => {
        const next = await read();
        const still = JSON.stringify(next) === JSON.stringify(last);
        last = next;
        return still;
    }, { timeout: 3_000 }).toBe(true);
    return last;
}

test.afterEach(async ({ page }) => {
    await page.evaluate(async () => {
        await window.nextDashFetch?.('/api/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ themeDepth: 'flat' }),
        });
    }).catch(() => {});
});

test('the popover opens under the gear, lined up with it', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await openLogsWithGlass(page);
    await page.locator('[data-log-settings-toggle]').scrollIntoViewIfNeeded();
    await page.locator('[data-log-settings-toggle]').click();
    await expect(page.locator('#config-log-settings-popover')).toBeVisible();

    const { gear, pop, vw, vh } = await boxes(page);
    // Against the gear -- just under it, or just over it when the window has
    // no room below -- not a panel's height away.
    const below = pop.top >= gear.bottom - 1 && pop.top - gear.bottom < 16;
    const above = pop.bottom <= gear.top + 1 && gear.top - pop.bottom < 16;
    expect(below || above, `popover ${Math.round(pop.top)}-${Math.round(pop.bottom)}, gear ${Math.round(gear.top)}-${Math.round(gear.bottom)}`).toBe(true);
    // Its right edge at the gear's, not past it.
    expect(Math.abs(pop.right - gear.right)).toBeLessThan(16);
    expect(pop.right).toBeLessThanOrEqual(vw);
    expect(pop.bottom).toBeLessThanOrEqual(vh);
});

/*
 * All of it on screen at once, never a scroll box: stacked in one column the
 * settings ran past 750px and scrolled inside the menus' shared 20rem cap.
 */
test('every setting in the popover is on screen, with nothing to scroll', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await openLogsWithGlass(page);
    await page.locator('[data-log-settings-toggle]').scrollIntoViewIfNeeded();
    await page.locator('[data-log-settings-toggle]').click();
    await expect(page.locator('#config-log-settings-popover')).toBeVisible();

    const { scrolls, pop, vw, vh } = await boxes(page);
    expect(scrolls, 'the popover scrolls').toBe(false);
    expect(pop.top).toBeGreaterThanOrEqual(0);
    expect(pop.left).toBeGreaterThanOrEqual(0);
    expect(pop.right).toBeLessThanOrEqual(vw);
    expect(pop.bottom).toBeLessThanOrEqual(vh);
    await expect(page.locator('#config-log-settings-popover [data-log-select="detail"]')).toBeInViewport({ ratio: 1 });
    await expect(page.locator('#config-log-settings-popover [data-log-select="maxEntries"]')).toBeInViewport({ ratio: 1 });
});

test('on a small window the popover stays inside it', async ({ page }) => {
    await page.setViewportSize({ width: 760, height: 560 });
    await openLogsWithGlass(page);
    const gearBtn = page.locator('[data-log-settings-toggle]');
    await gearBtn.scrollIntoViewIfNeeded();
    await gearBtn.click();
    await expect(page.locator('#config-log-settings-popover')).toBeVisible();

    const { scrolls, pop, vw, vh } = await boxes(page);
    expect(scrolls, 'the popover scrolls').toBe(false);
    expect(pop.left).toBeGreaterThanOrEqual(0);
    expect(pop.right).toBeLessThanOrEqual(vw);
    expect(pop.top).toBeGreaterThanOrEqual(0);
    expect(pop.bottom).toBeLessThanOrEqual(vh);
});

/*
 * Above the sticky header, not under it.
 *
 * The log panel is a stacking context of its own under Glass (its
 * backdrop-filter), so the popover's z-index only counted inside the panel and
 * the header band -- lifted over everything in the section -- drew across the
 * popover wherever the two met. The same trap the Health row menu fell into.
 */
test('the popover keeps clear of the sticky header when it can', async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 700 });
    await openLogsWithGlass(page);
    const gearBtn = page.locator('[data-log-settings-toggle]');
    await gearBtn.scrollIntoViewIfNeeded();
    await gearBtn.click();
    await expect(page.locator('#config-log-settings-popover')).toBeVisible();
    await boxes(page);
    const { popTop, bandBottom } = await page.evaluate(() => ({
        popTop: document.querySelector('#config-log-settings-popover').getBoundingClientRect().top,
        bandBottom: document.querySelector('.lvs-header').getBoundingClientRect().bottom,
    }));
    expect(popTop).toBeGreaterThan(bandBottom);
});

/*
 * A window too low for the popover under the band: it reaches over it.
 *
 * The height is tied to how tall the popover is, so it needs checking when the
 * panel grows a control: at 440 the popover fits under the header again and
 * this test then passes its assertion while proving nothing, which is what the
 * setup check below is for. Measured: it starts crossing at about 360 and
 * overlaps the header by roughly 40px here.
 */
test('a popover crossing the sticky header draws above it', async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 320 });
    await openLogsWithGlass(page);
    const gearBtn = page.locator('[data-log-settings-toggle]');
    await gearBtn.scrollIntoViewIfNeeded();
    await gearBtn.click();
    await expect(page.locator('#config-log-settings-popover')).toBeVisible();
    await boxes(page);

    const point = await page.evaluate(() => {
        const m = document.querySelector('#config-log-settings-popover').getBoundingClientRect();
        const h = document.querySelector('.lvs-header').getBoundingClientRect();
        const top = Math.max(m.top, h.top);
        const bottom = Math.min(m.bottom, h.bottom);
        const left = Math.max(m.left, h.left);
        const right = Math.min(m.right, h.right);
        if (bottom - top <= 4 || right - left <= 4) return null;
        return { x: (left + right) / 2, y: (top + bottom) / 2 };
    });
    expect(point, 'setup: the open popover must cross the sticky header').not.toBeNull();

    const hitLandedInPopover = await page.evaluate((p) => {
        const pop = document.querySelector('#config-log-settings-popover');
        const hit = document.elementFromPoint(p.x, p.y);
        return Boolean(hit && pop.contains(hit));
    }, point);
    expect(hitLandedInPopover, 'the sticky header drew over the open popover').toBe(true);
});
