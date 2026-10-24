// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * Every row of a column starts its icon and its name on the same line, whether or not the
 * bookmark has a ping badge. A row with a status once took an inset of its own, so the icons of
 * the rows with a ping stood four pixels further in than the rest.
 */
test('the icons and names of a column line up, with and without a ping', async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('.category .bookmark-link', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    // Put a status on the first rows of the first column, the way the ping does when it answers.
    await page.evaluate(() => {
        const rows = [...document.querySelector('.category:not(.dashboard-widget)').querySelectorAll('.bookmark-link')];
        rows.forEach((row, i) => { if (i % 2 === 0) row.classList.add('status-online'); });
    });
    const m = await page.evaluate(() => {
        const column = document.querySelector('.category:not(.dashboard-widget)');
        const rows = [...column.querySelectorAll('.bookmark-link')];
        const x = (el) => Math.round(el.getBoundingClientRect().left);
        return {
            count: rows.length,
            withStatus: rows.filter((r) => r.classList.contains('status-online')).length,
            icons: [...new Set(rows.map((r) => x(r.querySelector('.bookmark-icon-slot'))))],
            names: [...new Set(rows.map((r) => x(r.querySelector('.bookmark-open'))))],
        };
    });
    expect(m.withStatus, 'no row with a status to compare').toBeGreaterThan(0);
    expect(m.count).toBeGreaterThan(m.withStatus);
    expect(m.icons, 'the icons start on different lines').toHaveLength(1);
    expect(m.names, 'the names start on different lines').toHaveLength(1);
});
