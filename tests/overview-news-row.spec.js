// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * A news row is two lines.
 *
 * A headline free to wrap to three lines, two clamped lines of summary, and
 * an action on a line of its own came to about 120px, and fourteen of those
 * was most of a page. Two lines now -- what it is and when, then what it says
 * and the way in -- and what the row carries is unchanged.
 *
 * Read at About → News, which is where the stream lives. It used to be on the
 * config overview as well; four fifths of that page's words were this feed,
 * and a feed is not an overview of an install.
 */

async function newsTab(page) {
    await page.setViewportSize({ width: 1500, height: 1100 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => !!window.dashboardInstance?.config, null, { timeout: 20_000 });
    await page.evaluate(() => window.dashboardInstance.config.openConfigView('about'));
    // Through the tab itself: openConfigView resets which one is showing.
    await page.click('[data-about-tab="news"]');
    await page.waitForSelector('.config-news-stream > li', { timeout: 20_000 });
    // The stream arrives over the network, so the rows settle a beat after the
    // panel does.
    await expect.poll(() => page.locator('.config-news-stream > li').count()).toBeGreaterThan(3);
}

// The first list only: About → News renders the dated stream and, under it,
// the undated back catalogue, whose rows are a different shape on purpose.
const rows = (page) => page.evaluate(() => [...document.querySelector('.config-news-stream').children]
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
        await newsTab(page);
        const all = await rows(page);

        for (const row of all) {
            // A headline that wraps is what took a row to 137px. Clipped, every
            // row is the same height and the list reads as a list.
            expect(row.h, `a row grew to ${row.h}px`).toBeLessThan(80);
        }

        // And they agree with each other within a line. Not to the pixel: the
        // first row carries a tighter top padding, and a row with no way in is
        // shorter than one that offers one.
        const heights = all.map((r) => r.h);
        expect(Math.max(...heights) - Math.min(...heights),
            `rows disagree on height: ${heights}`).toBeLessThanOrEqual(14);
    });

    test('the date sits beside the headline, not under it', async ({ page }) => {
        await newsTab(page);
        const [first] = await rows(page);

        // Within a few pixels, not exactly: the two are aligned on their
        // baselines and sit at different type sizes, so their box tops differ
        // by a hair. A line apart would be twenty.
        expect(Math.abs(first.when.top - first.title.top),
            'the date dropped to a line of its own').toBeLessThan(8);
    });

    test('and the way in sits beside the summary', async ({ page }) => {
        await newsTab(page);
        const withAction = (await rows(page)).find((row) => row.action && row.summary);
        expect(withAction, 'no row offered both a summary and a way in').toBeTruthy();

        expect(Math.abs(withAction.action.top - withAction.summary.top),
            'the action dropped to a third line').toBeLessThan(8);
        // Both right-hand cells share a column edge.
        expect(Math.abs(withAction.action.right - withAction.when.right),
            'the action and the date do not line up').toBeLessThanOrEqual(2);
    });

    test('a clipped headline says that it was clipped', async ({ page }) => {
        await newsTab(page);

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

    test('and the stream is not on the overview any more', async ({ page }) => {
        await newsTab(page);
        await page.evaluate(() => window.dashboardInstance.config.openConfigView('overview'));
        await page.waitForSelector('.config-overview-blocks', { timeout: 20_000 });

        // Four fifths of that page's words were this feed. None of it is here
        // now: the reading lives at About → News & features.
        expect(await page.locator('.config-news-stream > li').count(),
            'the overview is carrying the feed again').toBe(0);
    });
});
