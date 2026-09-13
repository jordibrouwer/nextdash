// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * One density setting, not two.
 *
 * The dashboard read `densityMode` off the server and defaulted to compact;
 * the list views kept their own value in localStorage and defaulted to
 * comfortable. So choosing compact rows on the dashboard and opening Health
 * gave comfortable ones, and the control that would fix that lived only in
 * that view's toolbar, never reached the server, and did not survive a
 * different browser -- while list-density.js's own comment said it was "one
 * setting for the whole app".
 *
 * It is now. ListDensity is a front for densityMode; the rows and the cards
 * move together.
 */
async function openDashboard(page) {
    await page.setViewportSize({ width: 1400, height: 900 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('.bookmark-link', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
}

/** The rule, off a probe: the views that draw these rows can be empty. */
const rowPadding = (page) => page.evaluate(() => {
    const probe = document.createElement('div');
    probe.className = 'feed-row feed-row--grid';
    document.body.appendChild(probe);
    const value = window.getComputedStyle(probe).paddingBlockStart;
    probe.remove();
    return value;
});

test('the list rows follow the dashboard density', async ({ page }) => {
    await openDashboard(page);

    const seen = {};
    for (const mode of ['comfortable', 'compact', 'dense']) {
        await page.evaluate((m) => window.ListDensity.set(m), mode);
        seen[mode] = {
            padding: parseFloat(await rowPadding(page)),
            setting: await page.evaluate(() => window.dashboardInstance.settings.densityMode),
            stamped: await page.evaluate(() => document.body.dataset.densityMode),
        };
    }

    // Each mode reaches the one setting the dashboard reads...
    for (const mode of Object.keys(seen)) {
        expect(seen[mode].setting, `${mode} did not reach densityMode`).toBe(mode);
        expect(seen[mode].stamped, `${mode} was not stamped on the body`).toBe(mode);
    }
    // ...and the rows actually move, in the order the names promise.
    expect(seen.comfortable.padding).toBeGreaterThan(seen.compact.padding);
    expect(seen.compact.padding).toBeGreaterThan(seen.dense.padding);
});

test('the old per-view density is gone', async ({ page }) => {
    await openDashboard(page);

    // The attribute the feed rows used to key off. A rule still reading it
    // would be a second setting again, silently.
    expect(await page.evaluate(() => document.body.dataset.listDensity ?? null),
        'the list views stamp a density of their own again').toBeNull();
    expect(await page.evaluate(() => window.ListDensity.DEFAULT),
        'the two defaults disagree again').toBe('compact');
});

test('a density chosen before the merge is carried over, once', async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    await markWhatsNewSeen(page);
    // The value the old module kept. Someone set this; an upgrade must not
    // quietly reset their rows.
    await page.addInitScript(() => {
        try { localStorage.setItem('nextdash:list-density', 'comfortable'); } catch { /* ignore */ }
    });
    await page.goto('/');
    await page.waitForSelector('.bookmark-link', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);

    await expect.poll(async () => page.evaluate(
        () => window.dashboardInstance?.settings?.densityMode), { timeout: 15_000 })
        .toBe('comfortable');
    // And the key is spent, so it cannot override a later choice.
    expect(await page.evaluate(() => localStorage.getItem('nextdash:list-density')),
        'the old key is still there to fire again').toBeNull();
});
