// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * Every section draws, with nothing in the console.
 *
 * The cheap gate for the section split: "the method is on the prototype" and
 * "the section draws" are different claims, and an earlier split passed every
 * mechanical check while forty-one behaviour tests failed.
 */
const SECTIONS = ['overview', 'appearance', 'bookmarks', 'structure', 'behavior',
    'data-backups', 'widgets', 'stats', 'help', 'logs', 'about'];

test('every config section draws without a console error', async ({ page }) => {
    const errors = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push(e.message));

    await page.setViewportSize({ width: 1500, height: 950 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);

    for (const section of SECTIONS) {
        await page.evaluate((s) => window.dashboardInstance.config.openConfigView(s), section);
        await page.waitForLoadState('networkidle');
        await expect.poll(async () => page.evaluate(
            () => document.querySelector('#config-view, .config-view')?.textContent?.trim().length || 0,
        ), { timeout: 15_000 }).toBeGreaterThan(40);
        expect(errors, `${section} logged: ${errors.join(' | ')}`).toEqual([]);
    }

    // Post-walk quiet-period: poll until errors array stops growing
    let lastLength = errors.length;
    let stableCount = 0;
    const maxWaitMs = 2000;
    const pollIntervalMs = 300;
    const startTime = Date.now();
    while (Date.now() - startTime < maxWaitMs) {
        await page.waitForTimeout(pollIntervalMs);
        if (errors.length === lastLength) {
            stableCount++;
            if (stableCount >= 2) break;
        } else {
            stableCount = 0;
        }
        lastLength = errors.length;
    }
    expect(errors, `post-walk: ${errors.join(' | ')}`).toEqual([]);
});
