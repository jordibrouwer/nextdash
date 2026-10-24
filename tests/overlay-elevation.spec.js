// @ts-check
const { test, expect } = require('./fixtures');
const { WRITE_TOKEN, markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays, openShortcutSearch } = require('./e2e-helpers');

/**
 * Which layer is on top, and what the elevation says about it.
 *
 * A single big layer (a confirm) is at the third level: the accent bar along its top edge and no
 * level mark. When another big layer lies under it (the command palette), the one underneath is
 * marked covered and the one on top is marked level 4. Closing the top layer takes both marks away.
 * Classic keeps its flat panels, but a modal still stands higher than a small popover.
 *
 * Behaviour only: attributes and computed shadows, no pixels.
 */
const BAR = '0px -3px 0px';

async function setLook(request, style) {
    const response = await request.post('/api/settings', {
        data: { theme: 'gloss-jade-dark', materialStyle: style },
        headers: { 'X-NextDash-Token': WRITE_TOKEN },
    });
    expect(response.ok(), 'settings save failed').toBe(true);
}

async function openDashboard(page) {
    await page.setViewportSize({ width: 1400, height: 900 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('.dashboard-grid .category .bookmark-link', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => !!window.OverlayLayers && !!document.body.getAttribute('data-material-style'));
}

/** Opens a confirm the way the app does and does not wait for its answer. */
async function openConfirm(page) {
    await page.evaluate(() => {
        window.AppModal.confirm({ title: 'Remove it?', message: 'Nothing is removed in this test.' });
    });
    await expect(page.locator('#app-modal.show')).toHaveCount(1);
}

const attrs = (page, selector) => page.evaluate((sel) => {
    const el = document.querySelector(sel);
    return el ? { covered: el.hasAttribute('data-ov-covered'), level: el.getAttribute('data-ov-level') } : null;
}, selector);

test.describe('overlay elevation', () => {
    test.afterEach(async ({ request }) => {
        await request.post('/api/settings', { data: { theme: 'look-ocean-dark', materialStyle: 'signature' }, headers: { 'X-NextDash-Token': WRITE_TOKEN } });
    });

    test('a single confirm has no level mark and carries the accent bar', async ({ page, request }) => {
        await setLook(request, 'signature');
        await openDashboard(page);
        await openConfirm(page);
        await expect.poll(() => page.evaluate(() => document.querySelector('#app-modal .modal')?.hasAttribute('data-ov-level'))).toBe(false);
        const state = await attrs(page, '#app-modal .modal');
        expect(state.covered, 'a lone modal is marked covered').toBe(false);
        expect(state.level, 'a lone modal is marked level 4').toBeNull();
        const shadow = await page.evaluate(() => getComputedStyle(document.querySelector('#app-modal .modal')).boxShadow);
        expect(shadow, 'the accent bar is missing along the top edge').toContain(BAR);
    });

    test('a confirm over the palette: the palette is covered, the confirm is level 4', async ({ page, request }) => {
        await setLook(request, 'signature');
        await openDashboard(page);
        await openShortcutSearch(page);
        await openConfirm(page);
        await expect.poll(() => attrs(page, '#app-modal .modal').then((s) => s.level)).toBe('4');
        expect((await attrs(page, '#shortcut-search .search-container')).covered, 'the palette under the confirm is not covered').toBe(true);
        expect((await attrs(page, '#app-modal')).level, 'the root of the top layer is not marked').toBe('4');
        const shadow = await page.evaluate(() => getComputedStyle(document.querySelector('#shortcut-search .search-container')).boxShadow);
        expect(shadow, 'a covered layer kept its accent bar').not.toContain(BAR);
    });

    test('closing the confirm takes both marks away', async ({ page, request }) => {
        await setLook(request, 'signature');
        await openDashboard(page);
        await openShortcutSearch(page);
        await openConfirm(page);
        await expect.poll(() => attrs(page, '#app-modal .modal').then((s) => s.level)).toBe('4');
        await page.evaluate(() => { window.AppModal.hide?.(); });
        await expect(page.locator('#app-modal.show')).toHaveCount(0);
        await expect.poll(() => page.evaluate(() => document.querySelectorAll('[data-ov-covered], [data-ov-level]').length), { timeout: 5_000 }).toBe(0);
        const shadow = await page.evaluate(() => getComputedStyle(document.querySelector('#shortcut-search .search-container')).boxShadow);
        expect(shadow, 'the palette did not get its bar back').toContain(BAR);
    });

    test('classic keeps flat panels: a modal still stands higher than a popover', async ({ page, request }) => {
        await setLook(request, 'classic');
        await openDashboard(page);
        expect(await page.evaluate(() => document.body.getAttribute('data-material-style'))).toBe('classic');
        await openConfirm(page);
        const spread = await page.evaluate(() => {
            const pop = document.createElement('div');
            pop.className = 'date-popover';
            pop.style.cssText = 'position:fixed;left:10px;top:10px;width:100px;height:40px';
            document.body.appendChild(pop);
            // The largest blur or offset in a shadow list, outside the inset and spread-only layers.
            const reach = (shadow) => Math.max(0, ...(shadow.match(/-?\d+(?:\.\d+)?px/g) || []).map((v) => Math.abs(parseFloat(v))));
            const modal = getComputedStyle(document.querySelector('#app-modal .modal'));
            const out = { modal: reach(modal.boxShadow), popover: reach(getComputedStyle(pop).boxShadow), modalRadius: modal.borderRadius };
            pop.remove();
            return out;
        });
        expect(spread.modal, 'the classic modal is not higher than a popover').toBeGreaterThan(spread.popover);
    });
});
