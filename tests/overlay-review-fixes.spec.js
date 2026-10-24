// @ts-check
const { test, expect } = require('./fixtures');
const { WRITE_TOKEN, markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * What the review of the layers found, pinned:
 * reduced transparency closes every layer and the plates, the action bar goes to the bottom on a phone,
 * a toast and the preview card have no blur, animations off stop the rise of a popover, and the bookmark
 * form knows when another layer lies on it.
 */
async function setup(request, theme, viewport = { width: 1400, height: 900 }) {
    const response = await request.post('/api/settings', { data: { theme, materialStyle: 'signature' }, headers: { 'X-NextDash-Token': WRITE_TOKEN } });
    expect(response.ok()).toBe(true);
    return viewport;
}

async function open(page, viewport) {
    await page.setViewportSize(viewport);
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => Boolean(window.dashboardInstance), null, { timeout: 20_000 });
}

const alphaOf = (color) => {
    const m = String(color).match(/\/\s*([\d.]+)\s*\)$/) || String(color).match(/^rgba\(.*,\s*([\d.]+)\s*\)$/);
    return m ? Number(m[1]) : 1;
};

test.afterEach(async ({ request }) => {
    await request.post('/api/settings', { data: { theme: 'look-ocean-dark', materialStyle: 'signature' }, headers: { 'X-NextDash-Token': WRITE_TOKEN } });
});

test('with reduced transparency a modal is closed and has no blur, in every glass material', async ({ page, request }) => {
    test.setTimeout(120_000);
    for (const theme of ['arctic-cyan-dark', 'hoarfrost-dark', 'borealis-veil-dark', 'cold-cathode-dark', 'retro-crt-mk2-dark', 'nocturne-ink-dark']) {
        const viewport = await setup(request, theme);
        await open(page, viewport);
        const cdp = await page.context().newCDPSession(page);
        await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-transparency', value: 'reduce' }] });
        const m = await page.evaluate(() => {
            window.AppModal.show({ title: 'probe', message: 'probe', showCancel: false });
            return new Promise((resolve) => setTimeout(() => {
                const cs = getComputedStyle(document.querySelector('.modal'));
                resolve({ bg: cs.backgroundColor, bf: cs.backdropFilter, reduced: matchMedia('(prefers-reduced-transparency: reduce)').matches });
            }, 400));
        });
        test.skip(!m.reduced, 'this browser cannot emulate prefers-reduced-transparency');
        expect.soft(alphaOf(m.bg), theme + ': the modal is see-through: ' + m.bg).toBeGreaterThanOrEqual(0.99);
        expect.soft(m.bf === 'none' || /blur\(0px\)/.test(m.bf), theme + ': the modal blurs: ' + m.bf).toBe(true);
    }
});

test('on a phone the side bars keep their place at the bottom centre under the signature', async ({ page, request }) => {
    const viewport = await setup(request, 'arctic-cyan-dark', { width: 600, height: 900 });
    for (const position of ['right', 'left']) {
        await request.post('/api/settings', { data: { theme: 'arctic-cyan-dark', materialStyle: 'signature', actionBarPosition: position }, headers: { 'X-NextDash-Token': WRITE_TOKEN } });
        await open(page, viewport);
        // On a phone the buttons are folded into a menu in this data, so the bar has no size: the place it is
        // given is read from its style, which is what a bar with buttons in it would be drawn at.
        const m = await page.evaluate(() => {
            const el = document.querySelector('.header-shortcuts');
            const cs = getComputedStyle(el);
            return { side: document.body.dataset.actionBar, left: cs.left, right: cs.right, bottom: cs.bottom, direction: cs.flexDirection, width: window.innerWidth };
        });
        test.skip(m.side !== position, 'the action bar is not on the ' + position);
        expect.soft(m.right, position + ': the bar is pinned to the right edge on a phone').toBe('auto');
        expect.soft(m.left === '50%' || Math.round(parseFloat(m.left)) === Math.round(m.width / 2), position + ': the bar is not centred: ' + m.left).toBe(true);
        expect.soft(m.bottom, position + ': the bar is not at the bottom').toBe('0px');
        expect.soft(m.direction, position + ': the bar is a column on a phone').toBe('row');
    }
});

test('a toast and the preview card have no blur: they hold buttons and links', async ({ page, request }) => {
    const viewport = await setup(request, 'arctic-cyan-dark');
    await open(page, viewport);
    await page.evaluate(() => {
        for (const cls of ['app-notification', 'bookmark-preview-card']) {
            const el = document.createElement('div');
            el.className = cls + ' probe';
            el.style.cssText = 'position:fixed;left:10px;top:10px;width:100px;height:40px';
            document.body.appendChild(el);
        }
    });
    for (const cls of ['app-notification', 'bookmark-preview-card']) {
        const bf = await page.evaluate((c) => getComputedStyle(document.querySelector('.' + c + '.probe')).backdropFilter, cls);
        expect.soft(bf, cls + ' blurs: ' + bf).toBe('none');
    }
});

test('with animations in views and modals off, a popover does not rise', async ({ page, request }) => {
    const viewport = await setup(request, 'arctic-cyan-dark');
    await open(page, viewport);
    await page.evaluate(() => document.body.classList.add('no-view-animations'));
    await page.locator('.date-time-line').first().click();
    await expect(page.locator('#date-popover')).toBeVisible();
    const name = await page.evaluate(() => getComputedStyle(document.getElementById('date-popover')).animationName);
    expect(name, 'the popover still animates').toBe('none');
});

test('a layer on the bookmark form drops it back to the second level, without the bar', async ({ page, request }) => {
    const viewport = await setup(request, 'arctic-cyan-dark');
    await open(page, viewport);
    await page.evaluate(() => window.dashboardInstance.openBookmarkFormModal({ mode: 'create' }));
    await expect(page.locator('.bookmark-form-modal-dialog')).toBeVisible();
    const alone = await page.evaluate(() => getComputedStyle(document.querySelector('.bookmark-form-modal-dialog')).boxShadow);
    expect(alone, 'the form alone has no bar').toMatch(/0px -3px 0px/);
    await page.evaluate(() => { window.AppModal.confirm({ title: 'a', message: 'b' }); });
    await expect.poll(() => page.evaluate(() => document.querySelector('.bookmark-form-modal-dialog').hasAttribute('data-ov-covered'))).toBe(true);
    const covered = await page.evaluate(() => getComputedStyle(document.querySelector('.bookmark-form-modal-dialog')).boxShadow);
    expect(covered, 'a covered form still has the bar').not.toMatch(/0px -3px 0px/);
});

// ── The lighter findings of the same review ──────────────────────────────────────────────────────

test('the active dot of a tutorial is lit and the dots only change under the signature', async ({ page, request }) => {
    const viewport = await setup(request, 'arctic-cyan-dark');
    await open(page, viewport);
    const read = () => page.evaluate(() => {
        const make = (cls) => { const el = document.createElement('span'); el.className = cls; document.body.appendChild(el); const cs = getComputedStyle(el); const v = { w: cs.width, bg: cs.backgroundColor }; el.remove(); return v; };
        return { idle: make('dashboard-tutorial-dot'), active: make('dashboard-tutorial-dot is-active') };
    });
    const signature = await read();
    expect(signature.idle.w, 'an idle dot is not 8px').toBe('8px');
    expect(signature.active.bg, 'the active dot is not lit').not.toBe(signature.idle.bg);
    await page.evaluate(() => document.body.setAttribute('data-material-style', 'classic'));
    const classic = await read();
    expect(classic.idle.w, 'the dots changed in Classic').not.toBe('8px');
});

test('effects off are flat: no blur and no grain on a layer', async ({ page, request }) => {
    const viewport = await setup(request, 'candlelit-study-dark');
    await open(page, viewport);
    await page.evaluate(() => [document.documentElement, document.body].forEach((el) => el.setAttribute('data-effects', 'off')));
    await page.evaluate(() => { window.AppModal.show({ title: 'probe', message: 'probe', showCancel: false }); });
    await expect(page.locator('.modal').first()).toBeVisible();
    const m = await page.evaluate(() => { const cs = getComputedStyle(document.querySelector('.modal')); return { bf: cs.backdropFilter, img: cs.backgroundImage }; });
    expect(m.bf, 'the layer blurs with effects off').toBe('none');
    expect(m.img, 'the paper grain is drawn with effects off').not.toContain('data:image/svg+xml');
});

test('the terminal title marks are not part of the name', async ({ page, request }) => {
    const viewport = await setup(request, 'retro-crt-mk2-dark');
    await open(page, viewport);
    await page.evaluate(() => { window.AppModal.show({ title: 'probe', message: 'probe', showCancel: false }); });
    await expect(page.locator('.modal-title').first()).toBeVisible();
    const content = await page.evaluate(() => getComputedStyle(document.querySelector('.modal-title'), '::before').content);
    expect(content, 'the prompt mark has no empty alternative text').toMatch(/\/\s*""/);
});

test('quick add shows where the focus is on the box, not on the field', async ({ page, request }) => {
    const viewport = await setup(request, 'arctic-cyan-dark');
    await open(page, viewport);
    await page.keyboard.press('Shift+Digit7');
    await expect(page.locator('.omnibox-input')).toBeFocused();
    const m = await page.evaluate(() => ({ field: getComputedStyle(document.querySelector('.omnibox-input')).outlineStyle, box: getComputedStyle(document.querySelector('.omnibox-box')).outlineWidth }));
    expect(m.field).toBe('none');
    expect(m.box, 'the box shows no focus').toBe('2px');
});
