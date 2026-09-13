// @ts-check
const { test, expect } = require('./fixtures');

/**
 * The first-run card does not cover the buttons in its own corner.
 *
 * The Quick setup card is fixed to the bottom-left at a z-index of
 * 2147482800; the two buttons that live in that corner -- the tag cloud's and
 * What's New -- sit at 1002 and 1001. So on a first run, the only time this
 * card is up, it covered both of them: elementFromPoint in the middle of the
 * What's New button came back with .quickstart-actions, and a click went to
 * the card. The reader who could not reach those buttons is the new reader,
 * who is exactly the one the card is there for.
 *
 * No fixture setup: a fresh profile is when the card shows, which is the state
 * under test.
 */
test('the quick setup card leaves the corner buttons clickable', async ({ page }) => {
    await page.setViewportSize({ width: 1500, height: 1000 });
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    await page.waitForSelector('.quickstart-card.show', { timeout: 20_000 });

    const reach = await page.evaluate(() => {
        const probe = (selector) => {
            const el = document.querySelector(selector);
            if (!el) return 'absent';
            const r = el.getBoundingClientRect();
            const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
            // Its own contents count: the icon inside the button is the button.
            return top && el.contains(top) ? 'reachable' : `covered by ${top?.className || top?.tagName}`;
        };
        return {
            whatsNew: probe('#whats-new-btn'),
            tagCloud: probe('.tag-cloud-toggle-btn'),
        };
    });

    expect(reach.whatsNew, 'the card covers the What\'s New button').toBe('reachable');
    expect(reach.tagCloud, 'the card covers the tag cloud button').toBe('reachable');
});
