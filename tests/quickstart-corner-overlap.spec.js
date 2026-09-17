// @ts-check
const { test, expect } = require('./fixtures');

/**
 * The first-run card leaves What's New reachable.
 *
 * The card is fixed at a z-index of 2147482800, far above the corner button at
 * 1001, so where the two meet the card wins every click. What's New stands in
 * the right-hand corner and the card in the left; this keeps it that way.
 *
 * No fixture setup: a fresh profile is when the card shows, which is the state
 * under test.
 */
test('the quick setup card leaves the What\'s New button clickable', async ({ page }) => {
    await page.setViewportSize({ width: 1500, height: 1000 });
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    await page.waitForSelector('.quickstart-card.show', { timeout: 20_000 });

    const reach = await page.evaluate(() => {
        const el = document.querySelector('#whats-new-btn');
        if (!el) return 'absent';
        const r = el.getBoundingClientRect();
        const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return top && el.contains(top) ? 'reachable' : `covered by ${top?.className || top?.tagName}`;
    });
    expect(reach, 'the card covers the What\'s New button').toBe('reachable');
});

/**
 * And it stands at the edge.
 *
 * The card was lifted two rows for buttons that no longer stand in its corner,
 * which left every invitation floating a hand's width above the bottom of the
 * window.
 */
test('the card stands at the bottom edge', async ({ page }) => {
    await page.setViewportSize({ width: 1500, height: 1000 });
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    await page.waitForSelector('.quickstart-card.show', { timeout: 20_000 });

    const seen = await page.evaluate(() => {
        const toggle = document.getElementById('tag-cloud-toggle-btn');
        const card = document.querySelector('.quickstart-card.show').getBoundingClientRect();
        const rootPx = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
        return {
            inCorner: Boolean(toggle?.closest('.dashboard-tag-cloud-wrap')),
            gap: Math.round(window.innerHeight - card.bottom),
            edge: Math.round(rootPx),
        };
    });

    expect(seen.inCorner, 'the tag cloud button is still in the corner on a desktop').toBe(false);
    // The same 1rem the card keeps from the left edge.
    expect(seen.gap).toBeLessThanOrEqual(seen.edge + 1);
});
