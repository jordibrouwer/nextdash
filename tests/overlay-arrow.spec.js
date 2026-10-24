// @ts-check
const { test, expect } = require('./fixtures');
const { WRITE_TOKEN, markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * The arrow of a popover points at what opened it. Under the signature the date popover, which opens
 * under the date line, carries an arrow on its top edge, above the line's middle; it is read from
 * where the two ended up, so a popover beside its trigger has none.
 */
test.afterEach(async ({ request }) => {
    await request.post('/api/settings', { data: { theme: 'aurora-glass-dark', materialStyle: 'signature' }, headers: { 'X-NextDash-Token': WRITE_TOKEN } });
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

test('a popover opened without a click at it does not aim at a far-away last click', async ({ page, request }) => {
    await openDatePopover(page, request);
    // Close it, click something far from the date line, then open the popover the way a command does.
    await page.evaluate(() => window.dashboardInstance.showDatePopover());
    await expect(page.locator('#date-popover')).toHaveCount(0);
    const far = await page.evaluate(() => {
        const line = document.querySelector('.date-time-line').getBoundingClientRect();
        const el = Array.from(document.querySelectorAll('button, a[href]'))
            .filter((e) => e.checkVisibility?.() !== false)
            .map((e) => ({ e, r: e.getBoundingClientRect() }))
            .filter(({ e, r }) => r.width > 0 && r.height > 0 && r.bottom < innerHeight && r.top >= 0
                && r.top > line.bottom + 400
                && e.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)))[0];
        if (!el) return null;
        const r = el.r;
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    expect(far, 'a control far below the date line to click').not.toBeNull();
    await page.mouse.click(far.x, far.y);
    await dismissBlockingOverlays(page);
    await page.evaluate(() => {
        document.activeElement?.blur();
        window.dashboardInstance.showDatePopover();
    });
    await expect(page.locator('#date-popover')).toBeVisible();
    await page.waitForTimeout(300);
    // The far click, below the popover, is not the anchor: an arrow on the popover's bottom edge would
    // point at it. Either no arrow, or one on the top edge, at the date line or its badge.
    const m = await page.evaluate(() => {
        const pop = document.getElementById('date-popover');
        return { side: pop.getAttribute('data-ov-arrow'), x: pop.style.getPropertyValue('--ov-arrow-x') };
    });
    expect(m.side).not.toBe('bottom');
    if (!m.side) expect(m.x).toBe('');
});

test('the arrow is gone once the date popover is closed', async ({ page, request }) => {
    await openDatePopover(page, request);
    await expect.poll(() => page.locator('#date-popover').getAttribute('data-ov-arrow')).toBe('top');
    await page.evaluate(() => window.dashboardInstance.showDatePopover());
    await expect(page.locator('#date-popover')).toHaveCount(0);
    await page.waitForTimeout(300);
    await expect(page.locator('[data-ov-arrow]')).toHaveCount(0);
});

test('a field popover has an arrow while it is shown and loses it when it hides', async ({ page, request }) => {
    const response = await request.post('/api/settings', { data: { theme: 'arctic-cyan-dark', materialStyle: 'signature' }, headers: { 'X-NextDash-Token': WRITE_TOKEN } });
    expect(response.ok()).toBe(true);
    await page.setViewportSize({ width: 1400, height: 900 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.evaluate(() => window.dashboardInstance.openBookmarkFormModal({ mode: 'create' }));
    const form = page.locator('#bookmark-form-modal .bookmark-inline-form');
    await expect(page.locator('#bookmark-form-modal')).toHaveClass(/show/);
    const info = form.locator('.bookmark-form-info[data-info-for="tags"]');
    const bubble = page.locator('.field-popover');
    await info.hover();
    await expect(bubble).toBeVisible();
    await expect.poll(() => bubble.getAttribute('data-ov-arrow')).toBe('top');
    expect(await bubble.evaluate((el) => el.style.getPropertyValue('--ov-arrow-x'))).not.toBe('');
    await page.mouse.move(0, 0);
    await expect(bubble).toBeHidden();
    await expect.poll(() => bubble.evaluate((el) => el.hasAttribute('data-ov-arrow') || el.style.getPropertyValue('--ov-arrow-x') !== '')).toBe(false);
});
