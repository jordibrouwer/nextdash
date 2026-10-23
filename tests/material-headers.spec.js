// @ts-check
const { test, expect } = require('./fixtures');
const { WRITE_TOKEN, markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * The category header under a material's signature.
 *
 * Every material draws its own header when the reader's header style is the
 * theme's own (data-cat-head="theme"). The two slashes of the "//" become two
 * filled, slanted blocks there, and a widget has three bars instead of its
 * panel; the "//" itself stays in the grip, unseen, so the grip is the same
 * button it always was. A header the reader chose by name, and classic, keep
 * the "//".
 *
 * Behaviour only: that the mark is there, can be seen and can be grabbed, and
 * that a chosen style and classic leave it alone. How a tab or a plate looks is
 * not asserted.
 */
const MATERIALS = ['lacquer', 'glass', 'frost', 'aurora', 'neon', 'velvet', 'enamel', 'brushed', 'carbon', 'paper', 'terminal', 'ink'];

async function openDashboard(page) {
    await page.setViewportSize({ width: 1400, height: 900 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('.dashboard-grid .category .bookmark-link', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    // The layout the signature draws; the terminal and launcher layouts keep their own.
    await page.evaluate(() => {
        const grid = document.querySelector('.dashboard-grid');
        grid.classList.remove('layout-terminal', 'layout-launcher');
        grid.classList.add('layout-masonry');
    });
}

/** Put the page under one material's signature, with the theme's own header. */
async function under(page, material, head = 'theme') {
    await page.evaluate(([m, h]) => {
        [document.documentElement, document.body].forEach((el) => {
            el.setAttribute('data-material-style', 'signature');
            el.setAttribute('data-material', m);
        });
        document.body.setAttribute('data-cat-head', h);
    }, [material, head]);
}

/** What the grip of the first plain category looks like to a reader. */
const grip = (page) => page.evaluate(() => {
    const handle = document.querySelector('.dashboard-grid .category:not(.dashboard-widget) .category-reorder-handle');
    const glyph = handle && handle.querySelector('.category-reorder-glyph');
    if (!handle || !glyph) return null;
    const box = handle.getBoundingClientRect();
    const cs = getComputedStyle(handle);
    const before = getComputedStyle(glyph, '::before');
    return {
        text: (glyph.textContent || '').trim(),
        width: box.width,
        visible: cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0,
        // The slanted blocks: drawn when the pseudo-element has content and a size.
        marked: before.content !== 'none' && before.content !== 'normal' && parseFloat(before.width) > 2,
        fill: getComputedStyle(glyph).webkitTextFillColor,
    };
});

test.describe('the header under a material', () => {
    test.afterEach(async ({ request }) => {
        // One store behind the worker: the theme is put back for the next test.
        await request.post('/api/settings', { data: { theme: 'look-berry-dark' }, headers: { 'X-NextDash-Token': WRITE_TOKEN } });
    });

    test('every material draws its mark where the // was, and keeps the grip', async ({ page }) => {
        await openDashboard(page);
        for (const material of MATERIALS) {
            await under(page, material);
            const g = await grip(page);
            expect(g, material + ': no grip').not.toBeNull();
            expect(g.text, material + ': the grip lost its //, which is what a screen reader and a drag read').toBe('//');
            expect(g.width, material + ': the grip has no width').toBeGreaterThan(4);
            expect(g.visible, material + ': the grip is hidden').toBe(true);
            expect(g.marked, material + ': no mark is drawn where the // was').toBe(true);
        }
    });

    test('ink, velvet and terminal columns carry a panel, ink a folio and terminal a prompt, even on an open surface', async ({ page }) => {
        await openDashboard(page);
        await page.evaluate(() => document.body.setAttribute('data-cat-surface', 'open'));
        const panel = () => page.evaluate(() => {
            const cat = document.querySelector('.dashboard-grid .category:not(.dashboard-widget)');
            const cs = getComputedStyle(cat);
            const folio = getComputedStyle(cat.querySelector('.category-title'), '::after').content;
            const m = cs.backgroundColor.match(/[\d.]+/g) || [];
            return { alpha: m.length > 3 ? Number(m[3]) : 1, layers: cs.backgroundImage, folio };
        });
        for (const material of ['ink', 'velvet', 'terminal']) {
            await under(page, material);
            const p = await panel();
            const drawn = p.alpha > 0 || p.layers !== 'none';
            expect(drawn, material + ': an open column has no panel').toBe(true);
        }
        await under(page, 'ink');
        expect((await panel()).folio, 'ink: no folio number').toContain('№');
        await under(page, 'terminal');
        const prompt = await page.evaluate(() => getComputedStyle(document.querySelector('.dashboard-grid .category:not(.dashboard-widget) .category-title-name'), '::before').content);
        expect(prompt, 'terminal: no $ prompt before the name').toContain('$');
        await under(page, 'lacquer');
        expect((await panel()).folio, 'lacquer: carries the ink folio').not.toContain('№');
    });

    test('pointing at a header does not move its name, on a category or a widget', async ({ page }) => {
        test.setTimeout(180_000);
        await openDashboard(page);
        // Every signature, then classic under each header style, with the widget strip on and off.
        const setups = [];
        for (const m of MATERIALS) setups.push({ name: m, style: 'signature', material: m, head: 'theme' });
        for (const head of ['theme', 'clean', 'underlined', 'boxed', 'label', 'group']) {
            setups.push({ name: 'classic/' + head, style: 'classic', material: 'lacquer', head });
        }
        const blocks = { category: '.category:not(.dashboard-widget)', widget: '.dashboard-widget' };
        for (const strip of ['background', 'off']) {
            for (const su of setups) {
                await page.evaluate((x) => {
                    [document.documentElement, document.body].forEach((el) => {
                        el.setAttribute('data-material-style', x.style);
                        el.setAttribute('data-material', x.material);
                    });
                    document.body.setAttribute('data-cat-head', x.head);
                    document.body.setAttribute('data-widget-bg', x.strip);
                }, { ...su, strip });
                for (const [kind, sel] of Object.entries(blocks)) {
                    const block = page.locator('.dashboard-grid ' + sel).first();
                    if (!(await block.count())) continue;
                    const title = block.locator('.category-title-name').first();
                    const offset = async () => {
                        const [t, b] = await Promise.all([title.boundingBox(), block.boundingBox()]);
                        return { x: t.x - b.x, y: t.y - b.y };
                    };
                    const where = su.name + ' ' + kind + ' (strip ' + strip + ')';
                    await page.mouse.move(0, 0);
                    await block.scrollIntoViewIfNeeded();
                    const rest = await offset();
                    await block.locator('.category-title').first().hover({ position: { x: 150, y: 8 } });
                    await page.waitForTimeout(220);
                    const hot = await offset();
                    expect.soft(Math.abs(hot.y - rest.y), where + ': the name jumps vertically on hover').toBeLessThan(1);
                    expect.soft(Math.abs(hot.x - rest.x), where + ': the name jumps sideways on hover').toBeLessThan(1);
                }
            }
        }
    });

    test('a widget is drawn like a category of the same material', async ({ page }) => {
        test.setTimeout(120_000);
        await openDashboard(page);
        const look = (sel) => page.evaluate((q) => {
            const el = document.querySelector('.dashboard-grid ' + q);
            if (!el) return null;
            const cs = getComputedStyle(el);
            const bg = cs.backgroundColor.replace(/\s+/g, '');
            return {
                bg, image: cs.backgroundImage.replace(/\s+/g, '').slice(0, 60), shadow: cs.boxShadow.replace(/\s+/g, ''),
                border: cs.borderTopWidth + cs.borderTopStyle, radius: cs.borderTopLeftRadius, blur: cs.backdropFilter,
                pad: cs.paddingTop + '/' + cs.paddingLeft,
            };
        }, sel);
        for (const strip of ['background', 'off']) {
            for (const surface of ['glass', 'card', 'open']) {
                for (const material of MATERIALS) {
                    await under(page, material);
                    await page.evaluate(([st, su]) => {
                        document.body.setAttribute('data-widget-bg', st);
                        document.body.setAttribute('data-cat-surface', su);
                    }, [strip, surface]);
                    const cat = await look('.category:not(.dashboard-widget)');
                    const wid = await look('.dashboard-widget');
                    // An open surface with the widget background on is the reader's own panel for widgets.
                    if (!cat || !wid || (surface === 'open' && strip === 'background' && !['ink', 'velvet', 'terminal'].includes(material))) continue;
                    expect.soft(wid, material + '/' + surface + ' (strip ' + strip + '): the widget is not drawn like a category').toEqual(cat);
                }
            }
        }
    });

    test('lacquer, glass and frost shine differently per column, and the same way every time', async ({ page }) => {
        await openDashboard(page);
        const read = () => page.evaluate(() => [...document.querySelectorAll('.dashboard-grid .category[data-category-id]')].slice(0, 6).map((el) => ({
            id: el.getAttribute('data-category-id'),
            a: el.style.getPropertyValue('--sh-a'),
            w: el.style.getPropertyValue('--sh-w'),
            layer: getComputedStyle(el, '::before').content,
            image: getComputedStyle(el, '::before').backgroundImage.length,
        })));
        for (const material of ['lacquer', 'glass', 'frost']) {
            await under(page, material);
            await page.evaluate(() => document.body.setAttribute('data-cat-surface', 'glass'));
            const first = await read();
            expect(first.length, material + ': too few columns to compare').toBeGreaterThan(2);
            for (const c of first) {
                expect(c.a, material + ': a column has no seed').not.toBe('');
                expect(c.layer, material + ': no shine layer on ' + c.id).not.toBe('none');
                expect(c.image, material + ': the shine layer draws nothing').toBeGreaterThan(20);
            }
            expect(new Set(first.map((c) => c.a + '/' + c.w)).size, material + ': the columns shine alike').toBeGreaterThan(1);
        }
        await page.reload();
        await page.waitForSelector('.dashboard-grid .category[data-category-id]');
        const again = await read();
        await under(page, 'lacquer');
        expect(again.map((c) => c.a), 'the seed moved between loads').toEqual((await read()).map((c) => c.a));
    });

    test('every material keeps the grip, the controls and the badges inside its edge', async ({ page }) => {
        await openDashboard(page);
        for (const material of MATERIALS) {
            await under(page, material);
            await page.evaluate(() => document.body.setAttribute('data-cat-surface', 'glass'));
            const inset = await page.evaluate(() => {
                const out = [];
                for (const card of document.querySelectorAll('.dashboard-grid .category')) {
                    const c = card.getBoundingClientRect();
                    const radius = parseFloat(getComputedStyle(card).borderTopLeftRadius) || 0;
                    const grip = card.querySelector('.category-reorder-glyph, .category-reorder-handle');
                    const trail = card.querySelector('.category-title-trailing');
                    if (grip) out.push({ what: 'grip', gap: grip.getBoundingClientRect().left - c.left, radius });
                    if (trail) out.push({ what: 'controls', gap: c.right - trail.getBoundingClientRect().right, radius });
                    for (const badge of card.querySelectorAll('.bookmark-shortcut, .status-text.bookmark-superscript-badge')) {
                        const r = badge.getBoundingClientRect();
                        if (r.width) out.push({ what: 'badge', gap: c.right - r.right, radius });
                    }
                    const foot = card.querySelector('.dashboard-widget-footer, .widget-actions, .notes-actions');
                    if (foot) out.push({ what: 'footer', gap: foot.getBoundingClientRect().left - c.left, radius });
                }
                return out;
            });
            expect(inset.length, material + ': too little to measure').toBeGreaterThan(2);
            // Velvet: past the curve of the corner. Enamel: past its 7px rim, with room to spare.
            const need = material === 'enamel' ? 11 : null;
            for (const i of inset) {
                expect.soft(i.gap, material + ': the ' + i.what + ' sits on the edge').toBeGreaterThanOrEqual(need ?? Math.min(i.radius * 0.5, 14));
            }
        }
    });

    test('a widget panel on an open surface does not hold its content against the edge', async ({ page }) => {
        await openDashboard(page);
        for (const material of MATERIALS) {
            await under(page, material);
            await page.evaluate(() => {
                document.body.setAttribute('data-cat-surface', 'open');
                document.body.setAttribute('data-widget-bg', 'background');
            });
            const gap = await page.evaluate(() => {
                const card = document.querySelector('.dashboard-grid .dashboard-widget');
                if (!card) return null;
                const c = card.getBoundingClientRect();
                let bottom = 0;
                for (const el of card.querySelectorAll('*')) {
                    const r = el.getBoundingClientRect();
                    if (r.width && r.height) bottom = Math.max(bottom, r.bottom);
                }
                return c.bottom - bottom;
            });
            if (gap === null) continue;
            expect.soft(gap, material + ': the widget content lies on the bottom edge of its panel').toBeGreaterThanOrEqual(6);
        }
    });

    test('classic and a chosen header style keep the //', async ({ page }) => {
        await openDashboard(page);
        await under(page, 'neon');
        await page.evaluate(() => {
            [document.documentElement, document.body].forEach((el) => el.setAttribute('data-material-style', 'classic'));
        });
        let g = await grip(page);
        expect(g.marked, 'classic drew the slanted blocks').toBe(false);
        expect(g.fill, 'classic hid the //').not.toMatch(/rgba\(0, 0, 0, 0\)|transparent/);

        await under(page, 'neon', 'clean');
        g = await grip(page);
        expect(g.marked, 'a chosen style drew the slanted blocks').toBe(false);
    });

    test('the signature draws a header, and a header the reader chose wins', async ({ page }) => {
        await openDashboard(page);
        const label = () => page.evaluate(() => {
            const el = document.querySelector('.dashboard-grid .category:not(.dashboard-widget) .category-title-label');
            const cs = getComputedStyle(el);
            return { transform: cs.textTransform, flex: cs.flexGrow, weight: cs.fontWeight };
        });

        await under(page, 'neon');
        expect((await label()).transform, 'neon draws its name in capitals').toBe('uppercase');

        await under(page, 'neon', 'clean');
        expect((await label()).transform, 'a chosen style left the neon header on').not.toBe('uppercase');

        await under(page, 'carbon');
        expect((await label()).transform, 'carbon draws its name in capitals').toBe('uppercase');

        // Classic draws none of it.
        await page.evaluate(() => {
            [document.documentElement, document.body].forEach((el) => el.setAttribute('data-material-style', 'classic'));
        });
        expect((await label()).transform, 'classic drew the carbon header').not.toBe('uppercase');
    });

    test('a theme brings its material and its header by itself, through the settings', async ({ page, request }) => {
        // Neon material, set the way a reader sets it: the theme, and nothing by hand.
        await request.post('/api/settings', { data: { theme: 'cold-cathode-dark', materialStyle: 'signature', categoryHeaderStyle: 'theme' }, headers: { 'X-NextDash-Token': WRITE_TOKEN } });
        await openDashboard(page);
        await page.reload();
        await page.waitForSelector('.dashboard-grid .category .bookmark-link', { timeout: 20_000 });
        await page.evaluate(() => {
            const grid = document.querySelector('.dashboard-grid');
            grid.classList.remove('layout-terminal', 'layout-launcher');
            grid.classList.add('layout-masonry');
        });
        expect(await page.evaluate(() => document.body.getAttribute('data-material')), 'the theme brought no material').toBe('neon');
        const g = await grip(page);
        expect(g.marked, 'the real page drew no mark where the // was').toBe(true);
        const transform = await page.evaluate(() => getComputedStyle(document.querySelector('.dashboard-grid .category:not(.dashboard-widget) .category-title-label')).textTransform);
        expect(transform, 'the real page drew no neon header').toBe('uppercase');
    });

    test('a widget takes the same header, and its mark stands where the // does', async ({ page }) => {
        await openDashboard(page);
        const widget = () => page.evaluate(() => {
            const el = document.querySelector('.dashboard-grid .category.dashboard-widget');
            if (!el) return null;
            const title = el.querySelector('.category-title');
            const label = el.querySelector('.category-title-label');
            const glyph = el.querySelector('.category-reorder-glyph');
            const mark = glyph && getComputedStyle(glyph, '::before').content;
            return {
                transform: getComputedStyle(label).textTransform,
                stripBorder: getComputedStyle(title).borderBottomWidth,
                stripFill: getComputedStyle(title).backgroundColor,
                markDrawn: !!mark && mark !== 'none',
                markBorder: glyph ? getComputedStyle(glyph, '::before').borderTopWidth : '',
                isWidgetMark: !!glyph && glyph.classList.contains('category-reorder-glyph--widget'),
            };
        });
        test.skip(!(await widget()), 'this dashboard has no widget');

        await under(page, 'neon');
        const neon = await widget();
        expect(neon.transform, 'the widget did not take the neon header').toBe('uppercase');
        expect(neon.isWidgetMark, 'the widget lost its mark').toBe(true);
        expect(neon.markDrawn, 'the widget mark is not drawn').toBe(true);
        // Three bars, not the bordered panel it was.
        expect(neon.markBorder, 'the widget mark is still the panel').toBe('0px');

        // The strip of a widget gives way: the header sits on the card, like a category's.
        expect(neon.stripBorder, 'the widget strip kept its rule').toBe('0px');
        expect(neon.stripFill, 'the widget strip kept its fill').toMatch(/rgba\(0, 0, 0, 0\)|transparent/);

        // Classic keeps the strip it had.
        await page.evaluate(() => {
            [document.documentElement, document.body].forEach((el) => el.setAttribute('data-material-style', 'classic'));
        });
        const classic = await widget();
        expect(classic.transform, 'classic drew the neon header on a widget').not.toBe('uppercase');
        expect(classic.markBorder, 'classic lost the widget panel').not.toBe('0px');
    });
});
