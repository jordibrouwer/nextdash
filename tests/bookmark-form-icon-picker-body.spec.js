// @ts-check
const { test, expect } = require('./fixtures');
const { WRITE_TOKEN, markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/*
 * Under the signature glass the form's dialog has a backdrop-filter, which makes it the containing
 * block of fixed boxes, and it clips. The app icon picker from the right-hand column was cut off at
 * the dialog's edge; it now lives in the body.
 */
test.afterEach(async ({ request }) => {
    await request.post('/api/settings', { data: { theme: 'look-berry-dark', materialStyle: 'signature' }, headers: { 'X-NextDash-Token': WRITE_TOKEN } });
});

test('the app icon picker is in the body and not clipped by the form dialog', async ({ page, request }) => {
    const response = await request.post('/api/settings', { data: { theme: 'arctic-cyan-dark', materialStyle: 'signature' }, headers: { 'X-NextDash-Token': WRITE_TOKEN } });
    expect(response.ok()).toBe(true);
    await page.route('**/api/bookmark-preview*', (route) => route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ title: 'An app', description: '', image: '', setIcon: true }),
    }));
    await markWhatsNewSeen(page);
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.evaluate(() => window.dashboardInstance.openBookmarkFormModal({ mode: 'create' }));
    const form = page.locator('#bookmark-form-modal .bookmark-inline-form');
    await expect(page.locator('#bookmark-form-modal')).toHaveClass(/show/);
    await form.locator('[data-field="url"]').fill(`https://media.p${Date.now()}.lan`);
    await form.locator('[data-field="url"]').blur();
    await form.locator('.bookmark-form-card-pencil').click();
    await form.locator('[data-icon-set-choose]').click();
    const picker = page.locator('[data-icon-set-popover]');
    await expect(picker).toBeVisible();

    const m = await page.evaluate(() => {
        const pop = document.querySelector('[data-icon-set-popover]');
        const dialog = document.querySelector('#bookmark-form-modal .bookmark-form-modal-dialog');
        const r = pop.getBoundingClientRect();
        return {
            inBody: pop.parentElement === document.body,
            inDialog: dialog.contains(pop),
            left: r.left, top: r.top, right: r.right, bottom: r.bottom,
            vw: window.innerWidth, vh: window.innerHeight,
            dialogRight: dialog.getBoundingClientRect().right,
        };
    });
    expect(m.inBody, 'the picker is a child of the body').toBe(true);
    expect(m.inDialog).toBe(false);
    expect(m.left).toBeGreaterThanOrEqual(0);
    expect(m.top).toBeGreaterThanOrEqual(0);
    expect(m.right).toBeLessThanOrEqual(m.vw);
    expect(m.bottom).toBeLessThanOrEqual(m.vh);
    // Whole picker visible: what is at its right edge is the picker, not the dialog's clip.
    const hit = await page.evaluate(() => {
        const r = document.querySelector('[data-icon-set-popover]').getBoundingClientRect();
        const el = document.elementFromPoint(r.right - 6, r.top + r.height / 2);
        return Boolean(el?.closest('[data-icon-set-popover]'));
    });
    expect(hit, 'the picker paints up to its right edge').toBe(true);
    await expect(picker.getByRole('searchbox')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(picker).toHaveCount(0);
    await expect(page.locator('#bookmark-form-modal')).toHaveClass(/show/);
});
