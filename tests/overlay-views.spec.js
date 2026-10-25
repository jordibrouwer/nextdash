// @ts-check
const { test, expect } = require('./fixtures');
const { WRITE_TOKEN, markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * What the views are made of, per material.
 *
 * Under the signature the plate of a list view (inbox, tags, docker, glances) and of the config view
 * is one card in the material: its fill, its surface layer, its corner. The active row of the rail
 * is lit from its edge, the blocks in the config view take a ring and a smaller corner, the controls
 * the material's control corner, and the right panel is a small layer without blur. Classic style and
 * effects off keep the plate plain.
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
const TWO = ['glass', 'paper'];

const PLATE = {
    inbox: '#dashboard-layout.inbox-layout > .lvs',
    tags: '#dashboard-layout.tag-view-layout > .lvs',
    docker: '#dashboard-layout.docker-layout > .lvs',
    config: '#dashboard-layout.config-layout:not(.library-layout) > .config-view',
};

async function setTheme(request, theme, extra = {}) {
    const response = await request.post('/api/settings', {
        data: { theme, materialStyle: 'signature', ...extra },
        headers: { 'X-NextDash-Token': WRITE_TOKEN },
    });
    expect(response.ok(), 'settings save failed').toBe(true);
}

/** Opens a view by its address, the way a reader reaches it. */
async function openView(page, hash, plate) {
    await page.setViewportSize({ width: 1400, height: 900 });
    await markWhatsNewSeen(page);
    await page.goto('/#' + hash);
    await page.reload();
    await page.waitForSelector(plate, { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    // Pacing: the page settles after the corner cards close, before the view is measured.
    await page.waitForTimeout(300);
}

/** Reads the plate and the variables it should resolve to. */
async function readPlate(page, plate) {
    return page.evaluate((sel) => {
        const el = document.querySelector(sel);
        const cs = getComputedStyle(el);
        const probe = document.createElement('div');
        probe.style.borderRadius = 'var(--ov-radius)';
        el.appendChild(probe);
        const ovRadius = getComputedStyle(probe).borderTopLeftRadius;
        probe.remove();
        const bodyCs = getComputedStyle(document.body);
        return {
            material: document.body.getAttribute('data-material'),
            bg: cs.backgroundColor,
            image: cs.backgroundImage.replace(/linear-gradient\(rgba\(0, 0, 0, 0\), rgba\(0, 0, 0, 0\)\)(, )?/g, '').replace(/, $/, '').trim() || 'none',
            radius: cs.borderTopLeftRadius,
            ovRadius,
            ovImageBig: bodyCs.getPropertyValue('--ov-image-big').trim(),
            boxShadow: cs.boxShadow,
        };
    }, plate);
}

const transparent = (c) => c === 'rgba(0, 0, 0, 0)' || c === 'transparent';
const hasBar = (s) => /inset/.test(s) && /\b2px 0px 0px 0px\b/.test(s);
const hasRing = (s) => /inset/.test(s) && /\b0px 0px 0px 1px\b/.test(s);

async function readRail(page, selector) {
    return page.evaluate((sel) => {
        const el = document.querySelector(sel);
        if (!el) return null;
        const cs = getComputedStyle(el);
        return { bg: cs.backgroundColor, boxShadow: cs.boxShadow };
    }, selector);
}

async function switchTo(page, material, extra) {
    await page.evaluate(([m, e]) => {
        [document.documentElement, document.body].forEach((el) => {
            el.setAttribute('data-material-style', 'signature');
            el.setAttribute('data-material', m);
            if (e) el.setAttribute('data-effects', e);
        });
    }, [material, extra || null]);
}

test.describe('view plates per material', () => {
    test.afterEach(async ({ request }) => {
        await request.post('/api/settings', { data: { theme: 'aurora-glass-dark', materialStyle: 'signature' }, headers: { 'X-NextDash-Token': WRITE_TOKEN } });
    });

    test('every material gives the inbox plate a fill, a surface layer and its corner', async ({ page, request }) => {
        test.setTimeout(180_000);
        await setTheme(request, THEME_PER_MATERIAL.glass);
        await openView(page, 'inbox', PLATE.inbox);
        for (const material of MATERIALS) {
            await setTheme(request, THEME_PER_MATERIAL[material]);
            await page.reload();
            await page.waitForSelector(PLATE.inbox, { timeout: 20_000 });
            await dismissBlockingOverlays(page);
            const m = await readPlate(page, PLATE.inbox);
            expect.soft(m.material, material + ': the theme did not bring its material').toBe(material);
            expect.soft(transparent(m.bg), material + ': the plate fill is see-through').toBe(false);
            if (m.ovImageBig && m.ovImageBig !== 'none') {
                expect.soft(m.image, material + ': the plate has no surface layer').not.toBe('none');
            } else {
                expect.soft(m.image, material + ': the plate draws a layer the material does not have').toBe('none');
            }
            expect.soft(parseFloat(m.radius), material + ': the plate has no corner').toBeGreaterThan(0);
            expect.soft(m.radius, material + ': the plate corner is not --ov-radius').toBe(m.ovRadius);
        }
    });

    for (const view of ['tags', 'docker', 'config']) {
        test('the plate rule applies on the ' + view + ' view', async ({ page, request }) => {
            test.setTimeout(90_000);
            await setTheme(request, THEME_PER_MATERIAL.glass);
            await openView(page, view, PLATE[view]);
            for (const material of TWO) {
                await switchTo(page, material);
                const m = await readPlate(page, PLATE[view]);
                expect.soft(transparent(m.bg), view + ' / ' + material + ': the plate fill is see-through').toBe(false);
                expect.soft(m.radius, view + ' / ' + material + ': the plate corner is not --ov-radius').toBe(m.ovRadius);
                expect.soft(parseFloat(m.radius), view + ' / ' + material + ': no corner').toBeGreaterThan(0);
                if (m.ovImageBig && m.ovImageBig !== 'none') {
                    expect.soft(m.image, view + ' / ' + material + ': no surface layer').not.toBe('none');
                }
            }
        });
    }

    test('the active rail row of the inbox is lit from its edge', async ({ page, request }) => {
        test.setTimeout(90_000);
        await setTheme(request, THEME_PER_MATERIAL.glass);
        await openView(page, 'inbox', PLATE.inbox);
        await page.waitForSelector('.lvs-filter.is-active', { timeout: 15_000 });
        for (const material of TWO) {
            await switchTo(page, material);
            const r = await readRail(page, '.lvs-filter.is-active');
            expect.soft(hasBar(r.boxShadow), material + ': no accent bar on the active row (' + r.boxShadow + ')').toBe(true);
            expect.soft(transparent(r.bg), material + ': the active row is not lit').toBe(false);
        }
    });

    test('the active rail row of the config view is lit from its edge', async ({ page, request }) => {
        test.setTimeout(90_000);
        await setTheme(request, THEME_PER_MATERIAL.glass);
        await openView(page, 'config', PLATE.config);
        await page.waitForSelector('.config-nav-item.is-active', { timeout: 15_000 });
        for (const material of TWO) {
            await switchTo(page, material);
            const r = await readRail(page, '.config-nav-item.is-active');
            expect.soft(hasBar(r.boxShadow), material + ': no accent bar on the active section (' + r.boxShadow + ')').toBe(true);
            expect.soft(transparent(r.bg), material + ': the active section is not lit').toBe(false);
        }
    });

    test('config blocks take a ring and a small corner, controls the control corner', async ({ page, request }) => {
        test.setTimeout(90_000);
        await setTheme(request, THEME_PER_MATERIAL.glass);
        await openView(page, 'config', PLATE.config);
        for (const material of TWO) {
            await switchTo(page, material);
            const m = await page.evaluate(() => {
                const view = document.querySelector('#dashboard-layout.config-layout > .config-view');
                const real = view.querySelector('.config-tile');
                const tile = real || (() => {
                    const t = document.createElement('div');
                    t.className = 'config-tile';
                    view.appendChild(t);
                    return t;
                })();
                const text = (() => {
                    const t = document.createElement('input');
                    t.className = 'config-text';
                    view.appendChild(t);
                    return t;
                })();
                const ctl = document.createElement('div');
                ctl.style.borderRadius = 'var(--ov-r-control)';
                view.appendChild(ctl);
                const tcs = getComputedStyle(tile);
                const out = {
                    realTile: Boolean(real),
                    tileRadius: parseFloat(tcs.borderTopLeftRadius),
                    tileShadow: tcs.boxShadow,
                    textRadius: getComputedStyle(text).borderTopLeftRadius,
                    controlRadius: getComputedStyle(ctl).borderTopLeftRadius,
                };
                text.remove();
                ctl.remove();
                if (!real) tile.remove();
                return out;
            });
            expect.soft(m.tileRadius, material + ': tile corner above 14px').toBeLessThanOrEqual(14);
            expect.soft(hasRing(m.tileShadow), material + ': tile has no ring (' + m.tileShadow + ')').toBe(true);
            expect.soft(m.textRadius, material + ': text field corner is not --ov-r-control').toBe(m.controlRadius);
        }
    });

    test('classic style keeps the plate plain and the rail without a bar', async ({ page, request }) => {
        test.setTimeout(90_000);
        await setTheme(request, THEME_PER_MATERIAL.glass, { materialStyle: 'classic' });
        await openView(page, 'inbox', PLATE.inbox);
        await page.waitForSelector('.lvs-filter.is-active', { timeout: 15_000 });
        const m = await readPlate(page, PLATE.inbox);
        expect(await page.evaluate(() => document.body.getAttribute('data-material-style'))).toBe('classic');
        // The classic plate keeps its own card layers; it must not take the material's surface layer.
        await switchTo(page, 'glass');
        const signature = await readPlate(page, PLATE.inbox);
        expect(signature.image, 'the signature plate has no surface layer to compare').not.toBe('none');
        expect(m.image, 'the classic plate took the material surface layer').not.toBe(signature.image);
        await page.evaluate(() => [document.documentElement, document.body].forEach((el) => el.setAttribute('data-material-style', 'classic')));
        const r = await readRail(page, '.lvs-filter.is-active');
        expect(hasBar(r.boxShadow), 'the classic rail has an accent bar (' + r.boxShadow + ')').toBe(false);
    });

    test('effects off drop the surface layer of the plate', async ({ page, request }) => {
        test.setTimeout(90_000);
        await setTheme(request, THEME_PER_MATERIAL.glass);
        await openView(page, 'inbox', PLATE.inbox);
        for (const material of TWO) {
            await switchTo(page, material, 'held');
            await switchTo(page, material, 'off');
            const m = await readPlate(page, PLATE.inbox);
            expect.soft(m.image, material + ': the plate draws a layer with effects off').toBe('none');
            expect.soft(transparent(m.bg), material + ': the fill went with the layer').toBe(false);
        }
    });

    test('the right panel is a small layer: a fill, a surface layer, no blur', async ({ page, request }) => {
        test.setTimeout(90_000);
        await setTheme(request, THEME_PER_MATERIAL.glass);
        await openView(page, 'inbox', PLATE.inbox);
        for (const material of TWO) {
            await switchTo(page, material, 'held');
            const m = await page.evaluate(() => {
                if (window.__probeDrawer) window.__probeDrawer.destroy();
                const d = new window.ListViewDrawer({ id: 'probe', storageKey: 'probe-sections' });
                window.__probeDrawer = d;
                d.mount();
                d.open('k', { title: 'x', build() {} });
                const cs = getComputedStyle(document.querySelector('.lvs-drawer-frame'));
                const out = {
                    bg: cs.backgroundColor,
                    image: cs.backgroundImage.replace(/linear-gradient\(rgba\(0, 0, 0, 0\), rgba\(0, 0, 0, 0\)\)(, )?/g, '').replace(/, $/, '').trim() || 'none',
                    blur: cs.backdropFilter || cs.webkitBackdropFilter || 'none',
                };
                d.destroy();
                return out;
            });
            expect.soft(transparent(m.bg), material + ': the panel fill is see-through').toBe(false);
            expect.soft(m.image, material + ': the panel has no surface layer').not.toBe('none');
            expect.soft(m.blur, material + ': the panel blurs what lies under it').toBe('none');
        }
    });
});
