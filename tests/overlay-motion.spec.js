// @ts-check
const { test, expect } = require('./fixtures');
const { WRITE_TOKEN, markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * How a layer arrives under the signature: a short fade and a rise of a few pixels, no zoom, and
 * nothing at all when the reader switched animations off.
 */
async function openSheet(page, request, off) {
    const response = await request.post('/api/settings', {
        data: { theme: 'arctic-cyan-dark', materialStyle: 'signature' },
        headers: { 'X-NextDash-Token': WRITE_TOKEN },
    });
    expect(response.ok()).toBe(true);
    await page.setViewportSize({ width: 1400, height: 900 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => Boolean(window.dashboardInstance), null, { timeout: 20_000 });
    await page.waitForTimeout(600);
    if (off) await page.evaluate(() => document.body.classList.add('no-view-animations'));
    await page.locator('body').press('!');
    await expect(page.locator('.modal-overlay.show .modal').first()).toBeVisible({ timeout: 10_000 });
    return page.evaluate(() => {
        const cs = getComputedStyle(document.querySelector('.modal-overlay.show .modal'));
        const list = (v) => v.split(',').map((x) => x.trim());
        const at = list(cs.transitionProperty).indexOf('transform');
        const ms = (v) => (v.endsWith('ms') ? parseFloat(v) : parseFloat(v) * 1000);
        return {
            pace: at >= 0 ? Math.round(ms(list(cs.transitionDuration)[at])) : null,
            enter: getComputedStyle(document.body).getPropertyValue('--modal-enter-from').trim(),
        };
    });
}

test.afterEach(async ({ request }) => {
    await request.post('/api/settings', { data: { theme: 'look-berry-dark', materialStyle: 'signature' }, headers: { 'X-NextDash-Token': WRITE_TOKEN } });
});

test('a modal rises a few pixels without a zoom under the signature', async ({ page, request }) => {
    const m = await openSheet(page, request, false);
    expect(m.enter, 'the rise is not the signature one').toMatch(/translateY\(/);
    expect(m.enter, 'the signature rise zooms').not.toMatch(/scale/);
    expect(m.pace).toBe(140);
});

test('with animations off a modal is simply there under the signature too', async ({ page, request }) => {
    const m = await openSheet(page, request, true);
    expect(m.enter).toBe('none');
    expect(m.pace).toBeNull();
});
