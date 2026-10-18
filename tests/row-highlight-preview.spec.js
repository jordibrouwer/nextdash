// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * Choosing how a row lights up shows it.
 *
 * A row lights up under the pointer or the keyboard cursor, and a reader
 * changing the setting in the theme studio has the pointer on the panel: the
 * choice changed nothing they could see. The first row of the grid is lit for a
 * moment when the choice changes, in the strength that was just chosen.
 */
test('choosing a strength in the theme studio lights a row so it can be seen', async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });

    await page.keyboard.press('Shift+A');
    await expect(page.locator('[data-look-studio]')).toBeVisible();
    await page.locator('[data-studio-tab="layout"]').click();

    const lit = () => page.evaluate(() => {
        const row = document.querySelector('#dashboard-layout .bookmark-link.row-highlight-demo');
        return row ? getComputedStyle(row).backgroundImage : null;
    });

    const strong = page.locator('[data-look-studio] [data-behavior-field="rowHighlight"][data-behavior-value="strong"]');
    await strong.scrollIntoViewIfNeeded();
    await strong.click();
    await expect.poll(lit, { timeout: 3_000 }).toContain('linear-gradient');
    const strongPaint = await lit();

    // It goes out again by itself.
    await expect.poll(lit, { timeout: 6_000 }).toBeNull();

    const subtle = page.locator('[data-look-studio] [data-behavior-field="rowHighlight"][data-behavior-value="subtle"]');
    await subtle.click();
    await expect.poll(lit, { timeout: 3_000 }).toContain('linear-gradient');
    expect(await lit(), 'subtle lit the same as strong').not.toBe(strongPaint);
});
