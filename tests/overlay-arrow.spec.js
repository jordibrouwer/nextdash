// @ts-check
const { test, expect } = require('./fixtures');
const { WRITE_TOKEN, markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * The arrow of a popover points at what opened it. Under the signature the date popover, which opens
 * under the date line, carries an arrow on its top edge, above the line's middle; it is read from
 * where the two ended up, so a popover beside its trigger has none.
 */
test.afterEach(async ({ request }) => {
    await request.post('/api/settings', { data: { theme: 'look-berry-dark', materialStyle: 'signature' }, headers: { 'X-NextDash-Token': WRITE_TOKEN } });
});

async function openDatePopover(page, request) {
    const response = await request.post('/api/settings', { data: { theme: 'arctic-cyan-dark', materialStyle: 'signature' }, headers: { 'X-NextDash-Token': WRITE_TOKEN } });
    expect(response.ok()).toBe(true);
    await page.setViewportSize({ width: 1400, height: 900 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('.date-time-line', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.locator('.date-time-line').first().click();
    await expect(page.locator('#date-popover')).toBeVisible();
}

test('the date popover has an arrow on its top edge, above the middle of the date line', async ({ page, request }) => {
    await openDatePopover(page, request);
    await expect.poll(() => page.locator('#date-popover').getAttribute('data-ov-arrow')).toBe('top');
    const m = await page.evaluate(() => {
        const pop = document.getElementById('date-popover');
        const line = document.querySelector('.date-time-line');
        const pr = pop.getBoundingClientRect();
        const lr = line.getBoundingClientRect();
        const x = parseFloat(pop.style.getPropertyValue('--ov-arrow-x'));
        const after = getComputedStyle(pop, '::after');
        const mid = lr.left + lr.width / 2;
        const expected = Math.min(Math.max(mid, pr.left + 16), pr.right - 16);
        return { arrowAt: Math.round(pr.left + x), expected: Math.round(expected), width: Math.round(pr.width), x, content: after.content, clip: after.clipPath };
    });
    expect(m.x, 'the arrow is outside the popover').toBeGreaterThanOrEqual(16);
    expect(m.x).toBeLessThanOrEqual(m.width - 16);
    // The arrow is as close to the middle of the line as the popover's edges allow.
    expect(Math.abs(m.arrowAt - m.expected)).toBeLessThanOrEqual(2);
    expect(m.content, 'the arrow is not drawn').not.toBe('none');
    expect(m.clip, 'the arrow is not a triangle').toContain('polygon');
});

test('Classic draws no arrow', async ({ page, request }) => {
    await openDatePopover(page, request);
    await page.evaluate(() => document.body.setAttribute('data-material-style', 'classic'));
    const content = await page.evaluate(() => getComputedStyle(document.getElementById('date-popover'), '::after').content);
    expect(content).toBe('none');
});
