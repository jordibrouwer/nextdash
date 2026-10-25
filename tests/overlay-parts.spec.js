// @ts-check
const { test, expect } = require('./fixtures');
const { WRITE_TOKEN, markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * The parts that stand on a layer, per material: the light on the glass, the preview card with a
 * picture, What's New, Save this link, the parts of the list views and the config view, the
 * Bookmarks plate, the fidelity of ink, neon and paper, and the quick add input.
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

const PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
);

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

async function openView(page, hash, plate) {
    await page.setViewportSize({ width: 1400, height: 900 });
    await markWhatsNewSeen(page);
    await page.goto('/#' + hash);
    await page.reload();
    await page.waitForSelector(plate, { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    // Pacing: the page settles after the corner cards close, before the parts are measured.
    await page.waitForTimeout(300);
}

async function reloadDashboard(page) {
    await page.reload();
    await page.waitForSelector('.dashboard-grid .category .bookmark-link', { timeout: 20_000 });
    await dismissBlockingOverlays(page);
}

/** Forces a material on the page the way the other overlay specs do. */
async function switchTo(page, material, effects) {
    await page.evaluate(([m, e]) => {
        [document.documentElement, document.body].forEach((el) => {
            el.setAttribute('data-material-style', 'signature');
            el.setAttribute('data-material', m);
            if (e) el.setAttribute('data-effects', e);
        });
    }, [material, effects || null]);
}

async function openConfirm(page) {
    await page.evaluate(() => { window.AppModal.confirm({ title: 'Remove it?', message: 'Nothing is removed in this test.' }); });
    await page.waitForSelector('#app-modal.show .modal');
    // Pacing: the rise-in finishes before computed styles are read.
    await page.waitForTimeout(250);
}

async function closeModal(page) {
    await page.evaluate(() => window.AppModal.hide?.());
    // Pacing: the close animation finishes before the next modal opens.
    await page.waitForTimeout(100);
}

/** Alpha of a computed colour string. */
const ALPHA_FN = `(colour) => {
    const slash = colour.match(/\\/\\s*([\\d.]+)\\s*\\)/);
    if (slash) return Number(slash[1]);
    const rgba = colour.match(/rgba\\([^)]*,\\s*([\\d.]+)\\)/);
    return rgba ? Number(rgba[1]) : 1;
}`;

test.describe('overlay parts', () => {
    test.afterEach(async ({ request }) => {
        await request.post('/api/settings', { data: { theme: 'aurora-glass-dark', materialStyle: 'signature' }, headers: { 'X-NextDash-Token': WRITE_TOKEN } });
    });

    // ── 1. The light on the glass ─────────────────────────────────────────────────────────────────
    test('glass, frost, lacquer and brushed lay a shine on the modal; the others do not', async ({ page, request }) => {
        test.setTimeout(180_000);
        await setTheme(request, THEME_PER_MATERIAL.glass);
        await openDashboard(page);
        const SHINY = ['glass', 'frost', 'lacquer', 'brushed'];
        const PLAIN = ['neon', 'paper', 'carbon', 'ink'];
        for (const material of [...SHINY, ...PLAIN]) {
            await setTheme(request, THEME_PER_MATERIAL[material]);
            await reloadDashboard(page);
            await openConfirm(page);
            const m = await page.evaluate(() => {
                const shine = getComputedStyle(document.body).getPropertyValue('--ov-shine').trim();
                const probe = document.createElement('div');
                document.body.appendChild(probe);
                probe.style.backgroundImage = 'var(--ov-shine)';
                const resolved = getComputedStyle(probe).backgroundImage;
                probe.remove();
                return {
                    material: document.body.getAttribute('data-material'),
                    shine,
                    shineValid: shine !== '' && CSS.supports('background-image', shine),
                    resolved,
                    modalImage: getComputedStyle(document.querySelector('#app-modal .modal')).backgroundImage,
                };
            });
            expect.soft(m.material, material + ': the theme did not bring its material').toBe(material);
            if (SHINY.includes(material)) {
                expect.soft(m.shineValid, material + ': --ov-shine is not a valid image: ' + m.shine).toBe(true);
                expect.soft(m.shine, material + ': --ov-shine has no radial gradient').toContain('radial-gradient');
                expect.soft(m.modalImage, material + ': the modal carries no shine').toContain('radial-gradient');
            } else {
                expect.soft(m.shine.includes('radial-gradient'), material + ': --ov-shine is a gradient: ' + m.shine).toBe(false);
                expect.soft(m.modalImage.includes('radial-gradient'), material + ': the modal carries a radial shine').toBe(false);
            }
            await closeModal(page);
        }
    });

    test('effects off take the shine off the modal', async ({ page, request }) => {
        test.setTimeout(120_000);
        await setTheme(request, THEME_PER_MATERIAL.glass);
        await openDashboard(page);
        for (const material of ['glass', 'frost', 'lacquer', 'brushed']) {
            await switchTo(page, material, 'held');
            await openConfirm(page);
            const on = await page.evaluate(() => getComputedStyle(document.querySelector('#app-modal .modal')).backgroundImage);
            expect.soft(on, material + ': no shine with effects on').toContain('radial-gradient');
            await closeModal(page);
            await switchTo(page, material, 'off');
            await openConfirm(page);
            const off = await page.evaluate(() => getComputedStyle(document.querySelector('#app-modal .modal')).backgroundImage);
            expect.soft(off.includes('radial-gradient'), material + ': a shine with effects off: ' + off).toBe(false);
            await closeModal(page);
        }
    });

    // ── 2. The preview card ───────────────────────────────────────────────────────────────────────
    test('a preview card with a picture is a grid with the picture on the left; without, a block', async ({ page, request }) => {
        test.setTimeout(120_000);
        let withImage = true;
        await page.route('**/api/bookmark-preview*', (route) => route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                url: 'https://parts.example.invalid/',
                title: 'Parts example',
                description: 'A card with a picture.',
                image: withImage ? '/data/preview-images/pi-x.png' : '',
                imageSource: withImage ? 'https://og.example.invalid/x.png' : '',
                domain: 'parts.example.invalid',
                fetchedAt: Date.now(),
            }),
        }));
        await page.route('**/data/preview-images/**', (route) => route.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
        await setTheme(request, THEME_PER_MATERIAL.glass);
        await openDashboard(page);

        const hoverCard = async () => {
            await page.evaluate(() => {
                const d = window.dashboardInstance;
                d.settings.linkPreviewMode = 'hover';
                d.settings.showLinkPreviewCards = true;
                d.settings.linkPreviewHoverDelayMs = 50;
                d.renderDashboard({ animate: false, forceFull: true });
            });
            await page.mouse.move(5, 5);
            // Evict any card (and cached previews) from an earlier round.
            await page.evaluate(() => {
                document.querySelectorAll('.bookmark-preview-card').forEach((c) => c.classList.remove('is-visible'));
            });
            const link = page.locator('.bookmark-link').nth(2).locator('.bookmark-open').first();
            await link.scrollIntoViewIfNeeded();
            await link.hover();
            await page.waitForSelector('.bookmark-preview-card.is-visible', { timeout: 10_000 });
            // Pacing: the preview card finishes fading in before it is measured.
            await page.waitForTimeout(300);
        };
        const read = () => page.evaluate(() => {
            const card = document.querySelector('.bookmark-preview-card');
            const cs = getComputedStyle(card);
            const wrap = card.querySelector('.bookmark-preview-card-image-wrap');
            const head = card.querySelector('.bookmark-preview-card-head');
            return {
                display: cs.display,
                columns: cs.gridTemplateColumns.split(' ').filter(Boolean).length,
                wrapHidden: wrap.hidden,
                wrapRight: wrap.getBoundingClientRect().right,
                headLeft: head.getBoundingClientRect().left,
            };
        });

        await hoverCard();
        const picture = await read();
        expect(picture.wrapHidden, 'the stub picture did not reach the card').toBe(false);
        expect.soft(picture.display, 'a card with a picture is not a grid').toBe('grid');
        expect.soft(picture.columns, 'a card with a picture has not two columns').toBe(2);
        expect.soft(picture.wrapRight, 'the picture is not left of the head').toBeLessThanOrEqual(picture.headLeft + 1);

        // Classic keeps the block.
        await page.evaluate(() => document.body.setAttribute('data-material-style', 'classic'));
        const classic = await read();
        expect.soft(classic.display, 'classic turned the card into a grid').not.toBe('grid');

        // No picture: a block under the signature.
        await page.evaluate(() => document.body.setAttribute('data-material-style', 'signature'));
        withImage = false;
        await page.mouse.move(5, 5);
        // Pacing: the pointer leaves the card and the hover transition ends before the resting style is read.
        await page.waitForTimeout(400);
        await page.evaluate(() => {
            // Drop the cached answers so the next hover asks the stub again.
            document.querySelectorAll('.bookmark-link').forEach((el) => { delete el.dataset.previewCached; });
            const d = window.dashboardInstance;
            d.pages?.forEach((p) => (p.categories || []).forEach((c) => (c.bookmarks || []).forEach((b) => { delete b.preview; delete b.previewImage; })));
        });
        await page.evaluate(() => {
            const wrap = document.querySelector('.bookmark-preview-card-image-wrap');
            const img = document.querySelector('.bookmark-preview-card-image');
            if (wrap) wrap.hidden = true;
            if (img) img.removeAttribute('src');
        });
        const bare = await read();
        expect.soft(bare.wrapHidden, 'setup: the picture wrap should be hidden').toBe(true);
        expect.soft(bare.display, 'a card without a picture is a grid').not.toBe('grid');
    });

    // ── 3. What's New ─────────────────────────────────────────────────────────────────────────────
    test('What\'s New lays its entries, earlier releases and support block on the surface', async ({ page, request }) => {
        await setTheme(request, THEME_PER_MATERIAL.glass);
        await openDashboard(page);
        await page.evaluate(() => document.querySelectorAll('.quickstart-card').forEach((c) => c.remove()));
        await page.evaluate(async () => {
            await window.ensureWhatsNewLoaded?.();
            await window.openWhatsNewModal({ force: true });
        });
        await expect(page.locator('.whats-new-modal')).toBeVisible();
        await page.waitForFunction(() => !document.querySelector('.whats-new-modal .wn-content--loading'), null, { timeout: 15_000 });
        // Pacing: the release notes finish laying out before the layers are measured.
        await page.waitForTimeout(400);
        for (const material of ['glass', 'paper']) {
            await switchTo(page, material);
            const m = await page.evaluate(() => {
                const read = (sel) => {
                    const el = document.querySelector('.whats-new-modal ' + sel);
                    if (!el) return null;
                    const cs = getComputedStyle(el);
                    return {
                        shadow: cs.boxShadow,
                        radius: parseFloat(cs.borderTopLeftRadius),
                        border: cs.borderTopWidth,
                    };
                };
                return {
                    entry: read('.wn-entry--new'),
                    earlier: read('.wn-earlier'),
                    support: read('.wn-support'),
                    chip: read('.wn-chip'),
                };
            });
            for (const key of ['entry', 'earlier', 'support']) {
                const part = m[key];
                expect.soft(part, material + ': .wn-' + key + ' is not on the page').not.toBeNull();
                if (!part) continue;
                expect.soft(part.shadow, material + ': ' + key + ' has no inset ring').toContain('inset');
                expect.soft(part.shadow, material + ': ' + key + ' has no 1px ring').toMatch(/0px 0px 0px 1px/);
                if (key === 'entry') expect.soft(part.shadow, 'the new entry has no accent bar').toMatch(/3px 0px 0px 0px/);
                expect.soft(part.radius, material + ': ' + key + ' has no corner').toBeGreaterThan(0);
                expect.soft(parseFloat(part.border), material + ': ' + key + ' has a border').toBe(0);
            }
            expect.soft(m.chip, material + ': no chip on the page').not.toBeNull();
            if (m.chip) expect.soft(parseFloat(m.chip.border), material + ': the chip has a border').toBe(0);
        }
    });

    // ── 4. Save this link ─────────────────────────────────────────────────────────────────────────
    test('Save this link lies on the surface; hover adds an accent bar', async ({ page, request }) => {
        test.setTimeout(120_000);
        await page.route('**/api/bookmark-preview*', (route) => route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ url: 'https://example.invalid/page', title: 'A page', description: 'About it.', image: '', domain: 'example.invalid', icon: '' }),
        }));
        await setTheme(request, THEME_PER_MATERIAL.glass);
        await openDashboard(page);
        await page.evaluate(() => {
            window.dashboardInstance.settings.inboxEnabled = true;
            window.dashboardInstance.settings.pasteDestination = 'ask';
            localStorage.removeItem('nextdash:paste-destination-v1');
        });
        await page.waitForFunction(() => window.dashboardInstance?.pasteChoice != null);
        await page.focus('body');
        await page.evaluate((value) => {
            const event = new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: new DataTransfer() });
            event.clipboardData.setData('text/plain', value);
            document.dispatchEvent(event);
        }, 'https://example.invalid/page');
        await expect(page.locator('#paste-choice-modal.show .paste-choice-card').first()).toBeVisible();
        // Pacing: the cards finish their entrance before they are measured.
        await page.waitForTimeout(400);

        for (const material of ['glass', 'paper', 'ink']) {
            await switchTo(page, material);
            const m = await page.evaluate(() => {
                const card = document.querySelector('.paste-choice-card');
                const url = document.querySelector('.paste-choice-url');
                const probe = document.createElement('div');
                probe.style.borderRadius = 'var(--ov-r-control)';
                document.body.appendChild(probe);
                const control = getComputedStyle(probe).borderTopLeftRadius;
                probe.remove();
                const cs = getComputedStyle(card);
                return {
                    cardBorder: cs.borderTopWidth,
                    cardShadow: cs.boxShadow,
                    urlRadius: getComputedStyle(url).borderTopLeftRadius,
                    control,
                };
            });
            expect.soft(parseFloat(m.cardBorder), material + ': the card has a border').toBe(0);
            expect.soft(m.cardShadow, material + ': the card has no inset ring').toContain('inset');
            expect.soft(m.urlRadius, material + ': the url is not in the control corner').toBe(m.control);
        }

        // Hover lights the card from its edge.
        await switchTo(page, 'glass');
        // The first card is the selected one, so the hover is read on the second.
        const second = page.locator('.paste-choice-card').nth(1);
        await page.mouse.move(5, 5);
        // Pacing: the pointer has left every card and the hover transition has ended.
        await page.waitForTimeout(250);
        const before = await second.evaluate((el) => getComputedStyle(el).boxShadow);
        await second.hover();
        // Pacing: the hover transition finishes before the shadow is read again.
        await page.waitForTimeout(250);
        const after = await second.evaluate((el) => getComputedStyle(el).boxShadow);
        expect.soft(after, 'hover changed nothing').not.toBe(before);
        expect.soft(after, 'hover adds no accent bar').toMatch(/inset\s+(rgb[a]?\([^)]*\)|\S+)\s+3px 0px 0px 0px|3px 0px 0px 0px inset/);
    });

    // ── 5. The views ──────────────────────────────────────────────────────────────────────────────
    test('inbox parts: summary ring, search field, opaque select and solid column head', async ({ page, request }) => {
        test.setTimeout(150_000);
        await setTheme(request, THEME_PER_MATERIAL.glass);
        const stamp = Date.now();
        for (const n of ['alpha', 'beta']) {
            const seeded = await request.post('/api/inbox', {
                data: { url: `https://${n}-${stamp}.example.com`, title: n, source: 'paste' },
                headers: { 'X-NextDash-Token': WRITE_TOKEN },
            });
            expect(seeded.ok(), 'seeding the inbox failed').toBe(true);
        }
        await openView(page, 'inbox', '#dashboard-layout.inbox-layout > .lvs');
        for (const material of ['glass', 'paper']) {
            await setTheme(request, THEME_PER_MATERIAL[material]);
            await page.reload();
            await page.waitForSelector('#dashboard-layout.inbox-layout > .lvs', { timeout: 20_000 });
            await dismissBlockingOverlays(page);
            // Pacing: the inbox settles after the reload before the layers are measured.
            await page.waitForTimeout(300);
            const m = await page.evaluate((alphaSrc) => {
                const alpha = eval(alphaSrc);
                const q = (sel) => document.querySelector('#dashboard-layout > .lvs ' + sel);
                const summary = q('.lvs-summary');
                const search = q('.inbox-search-input');
                const select = q('select');
                const colhead = q('.lvs-colhead');
                const out = { material: document.body.getAttribute('data-material'), present: { summary: !!summary, search: !!search, select: !!select, colhead: !!colhead } };
                if (summary) { const cs = getComputedStyle(summary); out.summary = { shadow: cs.boxShadow, border: cs.borderTopWidth }; }
                if (search) { const cs = getComputedStyle(search); out.search = { shadow: cs.boxShadow, border: cs.borderTopWidth }; }
                if (select) out.selectAlpha = alpha(getComputedStyle(select).backgroundColor);
                if (colhead) out.colheadAlpha = alpha(getComputedStyle(colhead).backgroundColor);
                return out;
            }, ALPHA_FN);
            expect.soft(m.material, material + ': wrong material').toBe(material);
            expect.soft(m.present.summary, material + ': no .lvs-summary on the inbox').toBe(true);
            expect.soft(m.present.search, material + ': no search field').toBe(true);
            expect.soft(m.present.select, material + ': no select').toBe(true);
            expect.soft(m.present.colhead, material + ': no column head').toBe(true);
            if (m.summary) {
                expect.soft(m.summary.shadow, material + ': the summary has no inset ring').toContain('inset');
                expect.soft(m.summary.shadow, material + ': the summary has no 1px ring').toMatch(/0px 0px 0px 1px/);
                expect.soft(parseFloat(m.summary.border), material + ': the summary has a border').toBe(0);
            }
            if (m.search) {
                expect.soft(parseFloat(m.search.border), material + ': the search has a border').toBe(0);
                expect.soft(m.search.shadow, material + ': the search has no inset ring').toContain('inset');
            }
            if (m.selectAlpha !== undefined) expect.soft(m.selectAlpha, material + ': the select is see-through').toBe(1);
            if (m.colheadAlpha !== undefined) expect.soft(m.colheadAlpha, material + ': the column head is see-through').toBe(1);
        }
    });

    test('config parts: the tile corner and the lit rail item', async ({ page, request }) => {
        test.setTimeout(120_000);
        const plate = '#dashboard-layout.config-layout:not(.library-layout) > .config-view';
        await setTheme(request, THEME_PER_MATERIAL.glass);
        await openView(page, 'config', plate);
        for (const material of ['glass', 'paper']) {
            await setTheme(request, THEME_PER_MATERIAL[material]);
            await page.reload();
            await page.waitForSelector(plate, { timeout: 20_000 });
            await dismissBlockingOverlays(page);
            await page.waitForSelector('.config-nav-item.is-active', { timeout: 10_000 });
            const navShadow = await page.evaluate(() => getComputedStyle(document.querySelector('.config-nav-item.is-active')).boxShadow);
            // Tiles live under Statistics -> Inbox.
            await page.waitForFunction(() => window.dashboardInstance?.config?.openConfigView);
            await page.evaluate(() => window.dashboardInstance.config.openConfigView('stats'));
            await page.locator('[data-stats-tab="inbox"]').click();
            await page.waitForSelector('#config-stats-inbox .config-tile', { timeout: 15_000 });
            const m = await page.evaluate((navShadow) => {
                const tile = document.querySelector('.config-tile');
                return {
                    material: document.body.getAttribute('data-material'),
                    tileRadius: tile ? parseFloat(getComputedStyle(tile).borderTopLeftRadius) : null,
                    navShadow,
                };
            }, navShadow);
            expect.soft(m.material, material + ': wrong material').toBe(material);
            expect.soft(m.tileRadius, material + ': no config tile on the page').not.toBeNull();
            if (m.tileRadius !== null) expect.soft(m.tileRadius, material + ': the tile corner is larger than 14px').toBeLessThanOrEqual(14);
            expect.soft(m.navShadow, material + ': the active item has no inset left bar').toMatch(/inset/);
            expect.soft(m.navShadow, material + ': the active item has no 2px left bar').toMatch(/2px 0px 0px 0px/);
        }
    });

    test('the Bookmarks plate has no second blur layer, and its rail is lit from the edge', async ({ page, request }) => {
        test.setTimeout(120_000);
        const plate = '#dashboard-layout.library-layout > .config-view--library';
        await setTheme(request, THEME_PER_MATERIAL.glass);
        await openView(page, 'bookmarks', plate);
        for (const material of ['glass', 'paper']) {
            await setTheme(request, THEME_PER_MATERIAL[material]);
            await page.reload();
            await page.waitForSelector(plate, { timeout: 20_000 });
            await dismissBlockingOverlays(page);
            await page.waitForSelector('.config-bm-rail-item.is-on', { timeout: 10_000 });
            const m = await page.evaluate((sel) => {
                const el = document.querySelector(sel);
                const before = getComputedStyle(el, '::before');
                const on = document.querySelector('.config-bm-rail-item.is-on');
                return {
                    material: document.body.getAttribute('data-material'),
                    blur: before.backdropFilter || before.webkitBackdropFilter || 'none',
                    onShadow: getComputedStyle(on).boxShadow,
                };
            }, plate);
            expect.soft(m.material, material + ': wrong material').toBe(material);
            expect.soft(m.blur, material + ': the plate has a second blur layer').toBe('none');
            expect.soft(m.onShadow, material + ': the lit rail item has no inset accent bar').toMatch(/inset/);
            expect.soft(m.onShadow, material + ': the lit rail item has no 2px left bar').toMatch(/2px 0px 0px 0px/);
        }
    });

    // ── 6. Layer fidelity ─────────────────────────────────────────────────────────────────────────
    test('ink draws corner ticks on the modal and a ring on its small layer', async ({ page, request }) => {
        await setTheme(request, THEME_PER_MATERIAL.ink);
        await openDashboard(page);
        await openConfirm(page);
        const after = await page.evaluate(() => getComputedStyle(document.querySelector('#app-modal .modal'), '::after').backgroundImage);
        const gradients = (after.match(/linear-gradient\(/g) || []).length;
        expect.soft(gradients, 'the ink modal has no corner ticks').toBeGreaterThanOrEqual(8);
        await closeModal(page);

        const small = await page.evaluate(() => {
            const card = document.createElement('div');
            card.className = 'quickstart-card';
            card.style.cssText = 'position:fixed;left:10px;top:10px;width:200px;height:80px';
            document.body.appendChild(card);
            const cs = getComputedStyle(card);
            const out = { shadow: cs.boxShadow, image: cs.backgroundImage };
            card.remove();
            return out;
        });
        expect.soft(small.shadow, 'the ink small layer has no 1px ring').toMatch(/0px 0px 0px 1px/);
        expect.soft((small.image.match(/linear-gradient\(/g) || []).length, 'the ink small layer has no ticks').toBeGreaterThanOrEqual(8);
    });

    test('neon glows on the top edge only, in capitals', async ({ page, request }) => {
        await setTheme(request, THEME_PER_MATERIAL.neon);
        await openDashboard(page);
        await openConfirm(page);
        const m = await page.evaluate(() => {
            const modal = getComputedStyle(document.querySelector('#app-modal .modal'));
            const title = getComputedStyle(document.querySelector('#app-modal .modal-title'));
            return { shadow: modal.boxShadow, transform: title.textTransform, textShadow: title.textShadow };
        });
        expect.soft(m.shadow, 'the neon modal has a ring all round').not.toMatch(/0px 0px 0px 2px/);
        expect.soft(m.shadow, 'the neon modal has no glow edge').toMatch(/-1px 0px 0px|0px -1px 0px/);
        expect.soft(m.transform, 'the neon head is not in capitals').toBe('uppercase');
        expect.soft(m.textShadow, 'the neon head has no halo').not.toBe('none');
    });

    test('paper carries the grain on the modal', async ({ page, request }) => {
        await setTheme(request, THEME_PER_MATERIAL.paper);
        await openDashboard(page);
        await openConfirm(page);
        const image = await page.evaluate(() => getComputedStyle(document.querySelector('#app-modal .modal')).backgroundImage);
        expect.soft(image, 'the paper modal has no grain').toContain('data:image/svg+xml');
    });

    // ── 7. Quick add ──────────────────────────────────────────────────────────────────────────────
    test('the quick add input shows no outline or shadow of its own when focused', async ({ page, request }) => {
        await setTheme(request, THEME_PER_MATERIAL.glass);
        await openDashboard(page);
        await page.keyboard.press('Shift+Digit7');
        const input = page.locator('.omnibox-input');
        await expect(input).toBeVisible();
        await input.focus();
        await expect(input).toBeFocused();
        const m = await input.evaluate((el) => {
            const cs = getComputedStyle(el);
            return { outlineStyle: cs.outlineStyle, outlineWidth: cs.outlineWidth, shadow: cs.boxShadow };
        });
        expect.soft(m.outlineStyle === 'none' || parseFloat(m.outlineWidth) === 0, 'the input has an outline: ' + m.outlineStyle + ' ' + m.outlineWidth).toBe(true);
        expect.soft(m.shadow, 'the input has a shadow').toBe('none');
    });
});
