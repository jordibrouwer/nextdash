// @ts-check
const { test, expect } = require('./fixtures');
const { prepareDashboardInteraction } = require('./e2e-helpers');

const fs = require('fs');
const path = require('path');

/**
 * The dashboard tour's drawings, legible in every theme — the same
 * measurement as inbox-tutorial-contrast.spec.js, over this tour's seven scenes.
 *
 * The tour's drawings, legible in every theme.
 *
 * They are SVG scenes coloured from theme variables, and the first version
 * drew black bars on a dark theme when its styles arrived late, with captions
 * in a tertiary text colour some themes take nearly to the background. Every
 * built-in theme is read out of models.go, applied in turn, and every piece of
 * text in every step is measured against the surface right under it: 4.5:1
 * for text, 3:1 for the arrows.
 */
const THEMES = [...fs.readFileSync(path.join(__dirname, '..', 'internal', 'app', 'models.go'), 'utf8')
    .matchAll(/^\s*"([a-z0-9-]+)":\s*\{Name:/gm)].map((m) => m[1]);

test('every scene reads in every built-in theme, light and dark', async ({ page }) => {
    test.setTimeout(600_000);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await prepareDashboardInteraction(page);
    await page.evaluate(async () => {
        await window.dashboardInstance.promos.openDashboardTour();
    });
    await expect(page.locator('.dashboard-tutorial-scene')).toBeVisible();
    const worst = [];
    for (let step = 1; step <= 10; step += 1) {
        await expect(page.locator('.dashboard-tutorial-progress')).toHaveText(`Step ${step} of 10`);
        const res = await page.evaluate((themes) => {
            // Any CSS colour -- oklch included -- through a canvas pixel.
            const cv = document.createElement('canvas'); cv.width = cv.height = 1;
            const cx = cv.getContext('2d', { willReadFrequently: true });
            const parse = (c) => { if (!c || c === 'none') return null;
                cx.clearRect(0, 0, 1, 1); cx.fillStyle = '#000'; cx.fillStyle = c; cx.fillRect(0, 0, 1, 1);
                const d = cx.getImageData(0, 0, 1, 1).data; return { r: d[0], g: d[1], b: d[2], a: d[3] / 255 }; };
            const lum = ({ r, g, b }) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
                return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
            const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
            const out = [];
            for (const th of themes) {
                document.documentElement.setAttribute('data-theme', th);
                const scene = document.querySelector('.dashboard-tutorial-scene');
                // A surface can be see-through (a Signature material): what the
                // reader sees is it laid over what is behind it, up to the page.
                const over = (t, b) => ({ r: t.r * t.a + b.r * (1 - t.a), g: t.g * t.a + b.g * (1 - t.a), b: t.b * t.a + b.b * (1 - t.a), a: 1 });
                const flat = (el) => { const ls = []; for (let n = el; n; n = n.parentElement) { const c = parse(getComputedStyle(n).backgroundColor); if (c && c.a > 0) { ls.push(c); if (c.a >= 1) break; } }
                    let base = ls.length && ls[ls.length - 1].a >= 1 ? ls.pop() : { r: 255, g: 255, b: 255, a: 1 };
                    while (ls.length) base = over(ls.pop(), base); return base; };
                const sceneBg = flat(scene);
                const boxBg = parse(getComputedStyle(document.querySelector('.dtv-box') || scene).fill || '') || sceneBg;
                let min = 99; let which = '';
                document.querySelectorAll('.dashboard-tutorial-scene text').forEach((t) => {
                    const fill = parse(getComputedStyle(t).fill);
                    if (!fill) { min = 0; which = 'no-fill ' + t.getAttribute('class'); return; }
                    // The surface right under this text: the shape its group draws,
                    // when that shape is filled, else the scene itself.
                    const group = t.closest('.dtv-row, .dtv-pill, .dtv-key');
                    const rect = group?.querySelector('rect');
                    const rectFill = rect ? parse(getComputedStyle(rect).fill) : null;
                    const bg = rectFill ? over(rectFill, sceneBg) : sceneBg;
                    const r = ratio(fill, bg);
                    if (r < min) { min = r; which = t.getAttribute('class') + ' "' + t.textContent.slice(0, 20) + '"'; }
                });
                // Lines too: an arrow nobody can see is a picture with a hole in it.
                document.querySelectorAll('.dashboard-tutorial-scene .dtv-arrow, .dashboard-tutorial-scene .dtv-line').forEach((a) => {
                    const st = parse(getComputedStyle(a).stroke);
                    const r = st ? ratio(st, sceneBg) * 1.5 : 0; // 3:1 for graphics, scaled to the 4.5 scale
                    if (r < min) { min = r; which = 'arrow'; }
                });
                out.push({ th, min: Math.round(min * 100) / 100, which });
            }
            return out;
        }, THEMES);
        res.forEach((r) => worst.push({ step, ...r }));
        if (step < 10) await page.locator('.modal-actions .modal-button', { hasText: 'Next' }).click();
    }
    const bad = worst.filter((w) => w.min < 4.5).sort((a, b) => a.min - b.min);
    expect(THEMES.length).toBeGreaterThan(100);
    expect(bad).toEqual([]);
});
