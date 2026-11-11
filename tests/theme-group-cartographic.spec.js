// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * The Cartographic group: the page is a map. What is asserted is behaviour --
 * the generated content a theme adds, and that the rows underneath still work --
 * never how it looks.
 */
const FAMILIES = ['atlas', 'nautical', 'subway'];
const THEMES = FAMILIES.flatMap((f) => [`cartographic-${f}-dark`, `cartographic-${f}-light`]);

async function open(page, width = 1280) {
    await page.setViewportSize({ width, height: 900 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
}

/** Pick a theme through the app's own writer, then wait for the page to follow. */
async function use(page, theme) {
    await page.evaluate(async (t) => {
        const d = window.dashboardInstance;
        await d.config.ensureSection('appearance');
        await d.config.setTheme(t);
        d.setupDOM();
    }, theme);
    await expect.poll(() => page.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBe(theme);
}

/** Computed style of a pseudo-element of the first list row. */
const rowPseudo = (page, pseudo, props) => page.evaluate(([ps, names]) => {
    const row = document.querySelector('#dashboard-layout .bookmarks-list > .bookmark-link');
    const cs = getComputedStyle(row, ps);
    return Object.fromEntries(names.map((n) => [n, cs[n]]));
}, [pseudo, props]);

test.describe('cartographic theme group', () => {
    test('every theme is installed under its id and the page wears it', async ({ page }) => {
        await open(page);
        for (const theme of THEMES) {
            await use(page, theme);
            await expect(page.locator('#dashboard-layout .bookmarks-list > .bookmark-link').first()).toBeVisible();
        }
    });

    test('Atlas hangs a grid reference and a pin on each row, and a letter over each column', async ({ page }) => {
        await open(page);
        for (const theme of ['cartographic-atlas-dark', 'cartographic-atlas-light']) {
            await use(page, theme);
            const label = await rowPseudo(page, '::before', ['content', 'position', 'pointerEvents']);
            // The coordinate is built from the column and row counters, never typed text.
            expect(label.content).toContain('counter(cgcol, upper-alpha)');
            expect(label.content).toContain('counter(cgrow)');
            expect(label.position).toBe('absolute');
            expect(label.pointerEvents).toBe('none');
            const pin = await rowPseudo(page, '::after', ['content', 'position', 'backgroundColor']);
            expect(pin.content).not.toBe('none');
            expect(pin.position).toBe('absolute');
            const ruler = await page.evaluate(() => getComputedStyle(document.querySelector('#dashboard-layout > .dashboard-column'), '::before').content);
            expect(ruler).toContain('upper-alpha');
            const sheet = await page.evaluate(() => {
                const cat = getComputedStyle(document.querySelector('#dashboard-layout .category:not([data-view="tiles"])'));
                const frame = getComputedStyle(document.querySelector('body > .theme-backdrop-layer'), '::after');
                return { contours: cat.backgroundImage, frameBorder: frame.borderTopStyle, wash: getComputedStyle(document.body).getPropertyValue('--depth-wash').trim(), radius: cat.borderTopLeftRadius };
            });
            // Contour lines inside each category, a double-line frame round the sheet, no accent wash.
            expect(sheet.contours).toContain('data:image/svg+xml');
            expect(sheet.frameBorder).toBe('double');
            expect(sheet.wash).toBe('none');
            expect(sheet.radius).toBe('0px');
        }
    });

    test('Nautical numbers the rows as soundings and keeps a compass rose behind the panes', async ({ page }) => {
        await open(page);
        for (const theme of ['cartographic-nautical-dark', 'cartographic-nautical-light']) {
            await use(page, theme);
            const sounding = await rowPseudo(page, '::before', ['content', 'fontStyle']);
            expect(sounding.content).toContain('counter(cgrow)');
            expect(sounding.fontStyle).toBe('italic');
            const rose = await page.evaluate(() => {
                const layer = document.querySelector('body > .theme-backdrop-layer');
                if (!layer) return null;
                const cs = getComputedStyle(layer, '::after');
                return { image: cs.backgroundImage, events: cs.pointerEvents };
            });
            expect(rose, 'the backdrop layer carries the rose').not.toBeNull();
            expect(rose.image).toContain('data:image/svg+xml');
            expect(rose.events).toBe('none');
            const chart = await page.evaluate(() => {
                const cat = getComputedStyle(document.querySelector('#dashboard-layout .category:not([data-view="tiles"])'));
                const layer = getComputedStyle(document.querySelector('body > .theme-backdrop-layer'));
                return {
                    border: cat.borderTopWidth, shadow: cat.boxShadow, contours: cat.backgroundImage,
                    layerImage: layer.backgroundImage, wash: getComputedStyle(document.body).getPropertyValue('--depth-wash').trim(),
                    scale: getComputedStyle(document.querySelector('#dashboard-layout > .dashboard-column'), '::before').backgroundImage,
                };
            });
            // A neatline: thick outer border plus a thin inner one, depth contours inside, a scale bar on top.
            expect(chart.border).toBe('3px');
            expect(chart.shadow).not.toBe('none');
            expect(chart.contours).toContain('data:image/svg+xml');
            expect(chart.scale).toContain('repeating-linear-gradient');
            // The page is flat chart paper: no backdrop recipe and no accent wash.
            expect(chart.layerImage).toBe('none');
            expect(chart.wash).toBe('none');
        }
    });

    test('Subway draws a line per category with a station per row and an interchange at the end', async ({ page }) => {
        await open(page);
        for (const theme of ['cartographic-subway-dark', 'cartographic-subway-light']) {
            await use(page, theme);
            const out = await page.evaluate(() => {
                const list = [...document.querySelectorAll('#dashboard-layout .bookmarks-list')]
                    .find((l) => l.querySelectorAll(':scope > .bookmark-link').length >= 2);
                const rows = [...list.querySelectorAll(':scope > .bookmark-link')];
                const dot = (r) => getComputedStyle(r, '::before');
                const line = getComputedStyle(list, '::before');
                const pill = getComputedStyle(list.closest('.category').querySelector('.category-title-name'));
                return {
                    line: line.backgroundColor,
                    firstDot: dot(rows[0]).borderTopColor,
                    firstSize: parseFloat(dot(rows[0]).width),
                    lastSize: parseFloat(dot(rows[rows.length - 1]).width),
                    pill: pill.backgroundColor,
                };
            });
            // The station is ringed in the line's own colour, and the line is that colour.
            expect(out.firstDot).toBe(out.line);
            expect(out.pill).toBe(out.line);
            expect(out.lastSize).toBeGreaterThan(out.firstSize);
        }
    });

    test('Subway says what a monitored row is doing in the words of a timetable', async ({ page }) => {
        await open(page);
        await use(page, 'cartographic-subway-light');
        const tags = await page.evaluate(() => {
            const rows = [...document.querySelectorAll('#dashboard-layout .bookmarks-list > .bookmark-link')];
            rows[0].classList.add('status-offline');
            rows[1].classList.add('status-checking');
            const text = (r) => getComputedStyle(r, '::after').content;
            return [text(rows[0]), text(rows[1]), text(rows[2])];
        });
        expect(tags[0]).toBe('"out of service"');
        expect(tags[1]).toBe('"delayed"');
        // A row nobody monitors stays quiet.
        expect(['none', 'normal']).toContain(tags[2]);
    });

    test('rows stay rows: a click opens the bookmark whatever the map draws around it', async ({ page }) => {
        await open(page);
        for (const theme of THEMES) {
            await use(page, theme);
            const row = page.locator('#dashboard-layout .bookmarks-list > .bookmark-link').first();
            const link = row.locator('.bookmark-open');
            const href = await link.getAttribute('href');
            // Catch the click before the browser navigates, so the test leaves the page where it is.
            await page.evaluate(() => {
                window.__cartoClick = null;
                document.addEventListener('click', (e) => {
                    const a = e.target.closest && e.target.closest('a.bookmark-open');
                    if (a) { window.__cartoClick = a.href; e.preventDefault(); }
                }, { capture: true, once: true });
            });
            await link.click();
            expect(await page.evaluate(() => window.__cartoClick)).toBe(href);
            // The gutter's pseudo-elements never take the pointer.
            const hit = await page.evaluate(() => {
                const r = document.querySelector('#dashboard-layout .bookmarks-list > .bookmark-link');
                const b = r.getBoundingClientRect();
                const el = document.elementFromPoint(b.left + 2, b.top + b.height / 2);
                return !!el && r.contains(el);
            });
            expect(hit).toBe(true);
        }
    });

    test('a narrow screen does not grow a sideways scrollbar under any of them', async ({ page }) => {
        await open(page, 390);
        for (const theme of THEMES) {
            await use(page, theme);
            const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
            expect(over, theme).toBeLessThanOrEqual(1);
        }
    });
});
