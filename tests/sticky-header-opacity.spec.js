// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays, waitForConfigReady } = require('./e2e-helpers');

/**
 * The band goes solid once the page moves under it.
 *
 * The header of a list view is drawn at 55% of the surface, which is what makes
 * it read as part of the page — and that only holds while the page starts
 * under it. Scroll, and rows pass behind the title, the filter and the search
 * box, and the words in the band stop being readable. It paints at 96% while
 * the page is scrolled, and goes back to 55% at the top or after a reload.
 */
async function open(page, view) {
    await page.setViewportSize({ width: 1400, height: 700 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('.bookmark-link', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    if (view === 'config') {
        await waitForConfigReady(page);
        await page.evaluate(() => (window.dashboardInstance.config.appearanceTab = window.dashboardInstance.config.appearanceTab || 'general', window.dashboardInstance.config).openConfigView('appearance'));
        await page.waitForSelector('.config-view', { timeout: 20_000 });
    } else if (view === 'health') {
        await page.evaluate(() => window.dashboardInstance.health?.openHealthView?.());
        await page.waitForSelector('.lvs-header', { timeout: 20_000 });
    } else {
        await page.evaluate(() => window.dashboardInstance.inbox?.openInboxView?.());
        await page.waitForSelector('.lvs-header', { timeout: 20_000 });
    }
    /*
     * Start at the top, and wait until the page has stopped moving.
     *
     * `data-scrolled` is written by a scroll listener, and opening a view does
     * not reset the window position -- so a test could begin with the flag left
     * true by whatever ran before it, and the first assertion read that as the
     * band being wrong. Scrolled home explicitly, then polled, because the flag
     * lands a frame after the scroll does.
     *
     * Polling once was not enough. Opening config restores where it was, and on
     * a loaded machine that restore lands after a single poll has already seen
     * the top -- so the band was read mid-scroll and reported itself scrolled.
     * Seen three times in one CI run, on config only, while passing every time
     * here. So this waits for the page to hold still rather than to pass
     * through zero: four consecutive reads at the top, and anything that moves
     * it in between is scrolled home again and starts the count over.
     */
    await expect.poll(async () => {
        let quiet = 0;
        while (quiet < 4) {
            const home = await page.evaluate(() => {
                const y = Math.round(window.scrollY || document.documentElement.scrollTop || 0);
                if (y !== 0) window.scrollTo(0, 0);
                return y === 0 && document.body.getAttribute('data-scrolled') === 'false';
            });
            if (!home) return false;
            quiet += 1;
            await page.waitForTimeout(120);
        }
        return true;
    }, { timeout: 15_000, message: 'the page would not settle at the top' }).toBe(true);
}

const band = (page) => page.evaluate(() => {
    const el = document.querySelector('.lvs-header');
    if (!el) return null;
    const cs = window.getComputedStyle(el);
    return {
        background: cs.backgroundColor,
        border: parseFloat(cs.borderBottomWidth),
        scrolled: document.body.getAttribute('data-scrolled'),
    };
});

/**
 * Scroll the window, the way a reader does, and let the listener run.
 *
 * A view with nothing in it yet -- an empty inbox on a fresh store -- is
 * exactly as tall as the window, so there is nothing to scroll and nothing to
 * pass behind the band. A spacer gives the page the height its content would:
 * the scroll, the listener and the rule under test are the real ones.
 */
async function scrollDown(page) {
    await page.evaluate(() => {
        if (document.documentElement.scrollHeight <= window.innerHeight + 40) {
            const filler = document.createElement('div');
            filler.id = 'test-scroll-filler';
            filler.style.height = '1600px';
            document.querySelector('.lvs-main')?.appendChild(filler)
                || document.body.appendChild(filler);
        }
        window.scrollTo(0, 600);
    });
    await page.waitForTimeout(250);
}

for (const view of ['inbox', 'health', 'config']) {
    test(`${view}: the header is see-through at the top and solid once scrolled`, async ({ page }) => {
        await open(page, view);

        const top = await band(page);
        expect(top, 'no sticky band in this view').not.toBeNull();
        expect(top.scrolled, 'the page says it is scrolled while it is at the top').toBe('false');

        await scrollDown(page);
        const moved = await band(page);
        expect(moved.scrolled, 'scrolling was not noticed').toBe('true');
        expect(moved.background, 'the band is drawn the same while the page moves under it')
            .not.toBe(top.background);
        expect(moved.border, 'no line separates the band from what passes under it')
            .toBeGreaterThan(0);

        // And back up: the same band it was.
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.waitForTimeout(250);
        const back = await band(page);
        expect(back.scrolled).toBe('false');
        expect(back.background, 'the band stayed solid at the top').toBe(top.background);
    });
}

test('a reload starts at the top, whatever it was before', async ({ page }) => {
    await open(page, 'health');
    await scrollDown(page);
    expect((await band(page)).scrolled).toBe('true');

    await page.reload();
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    await page.waitForTimeout(300);

    expect(await page.evaluate(() => document.body.getAttribute('data-scrolled')),
        'the page came back thinking it was still scrolled').toBe('false');
});
