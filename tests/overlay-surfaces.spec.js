// @ts-check
const { test, expect } = require('./fixtures');
const { WRITE_TOKEN, markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * What a layer is made of, per material.
 *
 * Under the signature every material gives a modal and a small popover a closed-enough fill, the
 * material's own corner on the modal, and no blur on the small layers. A reader's own card glass
 * sets a floor (a modal is never less than 70 percent filled, a small layer 90). Effects off keep
 * the fill but drop the decoration drawn in a pseudo-element.
 *
 * Computed styles only, no pixels. Each material is reached the way a reader reaches it: a built-in
 * theme of that material, saved through the settings and loaded.
 */
const THEME_PER_MATERIAL = {
    glass: 'arctic-cyan-dark',
    frost: 'hoarfrost-dark',
    aurora: 'borealis-veil-dark',
    neon: 'cold-cathode-dark',
    terminal: 'retro-crt-mk2-dark',
    ink: 'nocturne-ink-dark',
    paper: 'candlelit-study-dark',
    enamel: 'bone-china-dark',
    velvet: 'forest-everglade-dark',
    lacquer: 'gloss-jade-dark',
    brushed: 'foundry-iron-dark',
    carbon: 'graphite-twill-dark',
};
const MATERIALS = Object.keys(THEME_PER_MATERIAL);
/** The materials whose fill follows the reader's card glass. */
const TRANSLUCENT = ['glass', 'frost', 'aurora', 'neon', 'terminal', 'ink'];

async function setTheme(request, theme, extra = {}) {
    const response = await request.post('/api/settings', {
        data: { theme, materialStyle: 'signature', ...extra },
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
}

/** Opens a confirm and a small popover, reads what they are made of, closes the confirm. */
async function measure(page) {
    await page.evaluate(() => { window.AppModal.confirm({ title: 'Remove it?', message: 'Nothing is removed in this test.' }); });
    await page.waitForSelector('#app-modal.show .modal');
    // Pacing: the rise-in finishes; computed styles do not need it, a settled page does.
    await page.waitForTimeout(250);
    return page.evaluate(() => {
        const alpha = (colour) => {
            const slash = colour.match(/\/\s*([\d.]+)\s*\)/);
            if (slash) return Number(slash[1]);
            const rgba = colour.match(/rgba\([^)]*,\s*([\d.]+)\)/);
            return rgba ? Number(rgba[1]) : 1;
        };
        const pop = document.createElement('div');
        pop.className = 'move-popover';
        pop.style.cssText = 'position:fixed;left:10px;top:10px;width:120px;height:40px';
        document.body.appendChild(pop);
        const probe = document.createElement('div');
        probe.style.borderRadius = 'var(--ov-radius)';
        document.body.appendChild(probe);
        const modal = getComputedStyle(document.querySelector('#app-modal .modal'));
        const small = getComputedStyle(pop);
        const out = {
            material: document.body.getAttribute('data-material'),
            modalAlpha: alpha(modal.backgroundColor),
            modalImage: modal.backgroundImage,
            modalRadius: modal.borderTopLeftRadius,
            ovRadius: getComputedStyle(probe).borderTopLeftRadius,
            modalAfter: getComputedStyle(document.querySelector('#app-modal .modal'), '::after').content,
            smallAlpha: alpha(small.backgroundColor),
            smallImage: small.backgroundImage,
            smallBlur: small.backdropFilter || small.webkitBackdropFilter || 'none',
            smallRadius: small.borderTopLeftRadius,
        };
        pop.remove();
        probe.remove();
        return out;
    });
}

test.describe('overlay surfaces per material', () => {
    test.afterEach(async ({ request }) => {
        await request.post('/api/settings', { data: { theme: 'aurora-glass-dark', materialStyle: 'signature' }, headers: { 'X-NextDash-Token': WRITE_TOKEN } });
    });

    test('every material gives the modal its corner and a fill, and the popover a fill without blur', async ({ page, request }) => {
        test.setTimeout(180_000);
        await openDashboard(page);
        for (const material of MATERIALS) {
            await setTheme(request, THEME_PER_MATERIAL[material]);
            await page.reload();
            await page.waitForSelector('.dashboard-grid .category .bookmark-link', { timeout: 20_000 });
            await dismissBlockingOverlays(page);
            const m = await measure(page);
            expect.soft(m.material, material + ': the theme did not bring its material').toBe(material);
            expect.soft(m.modalAlpha, material + ': the modal fill is see-through').toBeGreaterThan(0);
            expect.soft(m.modalImage, material + ': the modal has no surface layer').not.toBe('none');
            expect.soft(parseFloat(m.modalRadius), material + ': the modal corner is not the material corner').toBeGreaterThan(0);
            expect.soft(m.modalRadius, material + ': the modal corner is not --ov-radius').toBe(m.ovRadius);
            expect.soft(m.smallAlpha, material + ': the popover fill is see-through').toBeGreaterThan(0);
            expect.soft(m.smallImage, material + ': the popover has no surface layer').not.toBe('none');
            expect.soft(m.smallBlur, material + ': the popover blurs what lies under it').toBe('none');
            expect.soft(parseFloat(m.smallRadius), material + ': the popover has no corner').toBeGreaterThan(0);
            expect.soft(parseFloat(m.smallRadius), material + ': the popover corner is larger than the modal one').toBeLessThanOrEqual(parseFloat(m.modalRadius));
            await page.evaluate(() => window.AppModal.hide?.());
        }
    });

    test('lacquer fills the modal and the popover', async ({ page, request }) => {
        await setTheme(request, THEME_PER_MATERIAL.lacquer);
        await openDashboard(page);
        const m = await measure(page);
        expect(m.material).toBe('lacquer');
        expect(m.modalAlpha, 'the lacquer modal is see-through').toBeGreaterThan(0);
        expect(m.smallAlpha, 'the lacquer popover is see-through').toBeGreaterThan(0);
    });

    test('a reader\'s own card glass never thins a layer below the floor', async ({ page, request }) => {
        test.setTimeout(180_000);
        await setTheme(request, THEME_PER_MATERIAL.glass);
        await openDashboard(page);
        for (const material of TRANSLUCENT) {
            await page.evaluate(([m]) => {
                [document.documentElement, document.body].forEach((el) => {
                    el.setAttribute('data-material-style', 'signature');
                    el.setAttribute('data-material', m);
                });
                document.body.setAttribute('data-card-glass', 'own');
                // A very thin glass: the floor has to hold it up.
                document.body.style.setProperty('--theme-surface-alpha', '0.2');
            }, [material]);
            const m = await measure(page);
            expect.soft(m.modalAlpha, material + ': the modal is thinner than 70 percent').toBeGreaterThanOrEqual(0.69);
            expect.soft(m.smallAlpha, material + ': the popover is thinner than 90 percent').toBeGreaterThanOrEqual(0.89);
            await page.evaluate(() => window.AppModal.hide?.());
        }
    });

    test('effects on draw the decoration of ink and paper', async ({ page, request }) => {
        await setTheme(request, THEME_PER_MATERIAL.ink);
        await openDashboard(page);
        for (const material of ['ink', 'paper']) {
            await page.evaluate(([m]) => {
                [document.documentElement, document.body].forEach((el) => {
                    el.setAttribute('data-material-style', 'signature');
                    el.setAttribute('data-material', m);
                    el.setAttribute('data-effects', 'held');
                });
            }, [material]);
            const m = await measure(page);
            expect.soft(m.modalAfter, material + ': no decoration with effects on').not.toBe('none');
            await page.evaluate(() => window.AppModal.hide?.());
        }
    });

    test('effects off drop the decoration of ink and paper and keep the fill', async ({ page, request }) => {
        test.setTimeout(120_000);
        await setTheme(request, THEME_PER_MATERIAL.ink);
        await openDashboard(page);
        for (const material of ['ink', 'paper']) {
            for (const effects of ['held', 'off']) {
                await page.evaluate(([m, e]) => {
                    [document.documentElement, document.body].forEach((el) => {
                        el.setAttribute('data-material-style', 'signature');
                        el.setAttribute('data-material', m);
                        el.setAttribute('data-effects', e);
                    });
                }, [material, effects]);
                const m = await measure(page);
                if (effects === 'off') {
                    expect.soft(m.modalAfter, material + ': decoration drawn with effects off').toBe('none');
                } else {
                    expect.soft(m.modalAfter, material + ': no decoration with effects on').not.toBe('none');
                }
                expect.soft(m.modalAlpha, material + ' / ' + effects + ': the fill went with the decoration').toBeGreaterThan(0);
                await page.evaluate(() => window.AppModal.hide?.());
            }
        }
    });
});
