// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * A news row is two lines, and the overview is a page you can take in.
 *
 * The stream is fourteen rows because the overview guarantees the site's ten
 * posts a place -- reserving ten out of six would have been the whole page --
 * so the count was never the thing to cut. What made the section 2228px was
 * the row: a headline free to wrap to three lines, two clamped lines of
 * summary, and an action on a line of its own. Fourteen of those came to
 * 1775px beside an 867px column, and the reader scrolled past nine hundred
 * pixels of ragged white space to reach what was under the shorter one.
 *
 * Two lines now -- what it is and when, then what it says and the way in --
 * and the two columns end within a screen of each other. What the row carries
 * is unchanged.
 */

async function overview(page) {
    await page.setViewportSize({ width: 1500, height: 1100 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => !!window.dashboardInstance?.config, null, { timeout: 20_000 });
    await page.evaluate(() => window.dashboardInstance.config.openConfigView('overview'));
    await page.waitForSelector('.config-news-stream > li', { timeout: 20_000 });
    // The stream arrives over the network, so the rows settle a beat after the
    // panel does.
    await expect.poll(() => page.locator('.config-news-stream > li').count()).toBeGreaterThan(3);
}

const rows = (page) => page.evaluate(() => [...document.querySelectorAll('.config-news-stream > li')]
    .map((row) => {
        const cell = (sel) => {
            const el = row.querySelector(sel);
            if (!el) return null;
            const box = el.getBoundingClientRect();
            return { top: Math.round(box.top), right: Math.round(box.right), h: Math.round(box.height) };
        };
        return {
            h: Math.round(row.getBoundingClientRect().height),
            title: cell('.config-news-title-text'),
            when: cell('.config-news-when'),
            summary: cell('.config-news-summary'),
            action: cell('.config-news-action'),
        };
    }));

test.describe('the overview news row', () => {
    test('is two lines, whatever the headline is', async ({ page }) => {
        await overview(page);
        const all = await rows(page);

        for (const row of all) {
            // A headline that wraps is what took a row to 137px. Clipped, every
            // row is the same height and the list reads as a list.
            expect(row.h, `a row grew to ${row.h}px`).toBeLessThan(80);
        }

        // And they agree with each other, give or take the first row's tighter
        // top padding.
        const heights = [...new Set(all.slice(1).map((r) => r.h))];
        expect(heights.length, `rows disagree on height: ${heights}`).toBe(1);
    });

    test('the date sits beside the headline, not under it', async ({ page }) => {
        await overview(page);
        const [first] = await rows(page);

        // Within a few pixels, not exactly: the two are aligned on their
        // baselines and sit at different type sizes, so their box tops differ
        // by a hair. A line apart would be twenty.
        expect(Math.abs(first.when.top - first.title.top),
            'the date dropped to a line of its own').toBeLessThan(8);
    });

    test('and the way in sits beside the summary', async ({ page }) => {
        await overview(page);
        const withAction = (await rows(page)).find((row) => row.action);
        expect(withAction, 'no row offered a way in').toBeTruthy();

        expect(Math.abs(withAction.action.top - withAction.summary.top),
            'the action dropped to a third line').toBeLessThan(8);
        // Both right-hand cells share a column edge.
        expect(Math.abs(withAction.action.right - withAction.when.right),
            'the action and the date do not line up').toBeLessThanOrEqual(2);
    });

    test('a clipped headline says that it was clipped', async ({ page }) => {
        await overview(page);

        const clipped = await page.evaluate(() => {
            const texts = [...document.querySelectorAll('.config-news-title-text')];
            const long = texts.find((el) => el.scrollWidth > el.clientWidth + 1);
            if (!long) return null;
            const style = window.getComputedStyle(long);
            return { overflow: style.textOverflow, wrap: style.whiteSpace };
        });

        // Every install carries the site's posts, and some of those headlines
        // are a sentence -- but a fixture that happens to have none should skip
        // rather than assert on nothing.
        test.skip(clipped === null, 'no headline in this fixture is long enough to clip');
        expect(clipped.overflow, 'a headline ends mid-word with nothing to say so').toBe('ellipsis');
        expect(clipped.wrap).toBe('nowrap');
    });

    test('the two columns end within a screen of each other', async ({ page }) => {
        await overview(page);

        const gap = await page.evaluate(() => {
            const panel = document.querySelector('.config-news-panel').getBoundingClientRect();
            const side = document.querySelector('.config-overview-side').getBoundingClientRect();
            return Math.abs(panel.height - side.height);
        });

        // 908px apart before this. A screen is the honest bound: the columns
        // carry different things and will never match exactly.
        expect(gap, `the columns are ${Math.round(gap)}px apart`).toBeLessThan(500);
    });
});
