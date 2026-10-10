// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * Fitting the category titles once took a layout per read: every title reset,
 * then read, then a font size written and its width read, a pixel at a time.
 * Thirty categories were a hundred and more forced layouts on every render of
 * the dashboard. They are fitted together now, in a fixed number of passes --
 * and must come out exactly as the one-at-a-time version did.
 */

const NAMES = Array.from({ length: 30 }, (_, i) => [
    'Media',
    'Home automation and the sensors around the house',
    'Dev',
    'A category whose name is far too long to fit in one column at any size',
    'Work tools',
    'Supercalifragilisticexpialidocious-and-then-some-more',
][i % 6] + (i >= 6 ? ` ${i}` : ''));

/** The one-at-a-time fit as it was, kept here as the reference. */
function referenceFit(titleEl, minPx) {
    const nameEl = titleEl.querySelector('.category-title-name');
    const labelEl = titleEl.querySelector('.category-title-label');
    if (!nameEl || !labelEl || titleEl.clientWidth <= 0) return;
    nameEl.style.fontSize = '';
    nameEl.classList.remove('category-title-name--multiline');
    titleEl.classList.remove('category-title--multiline');
    const titleWidth = titleEl.clientWidth;
    const trailingEl = titleEl.querySelector('.category-title-trailing');
    const trailingWidth = trailingEl ? trailingEl.getBoundingClientRect().width : 0;
    const gap = parseFloat(getComputedStyle(titleEl).columnGap || getComputedStyle(titleEl).gap) || 0;
    const labelWidth = Math.max(0, titleWidth - trailingWidth - gap);
    const overhead = Math.max(0, labelEl.clientWidth - nameEl.clientWidth);
    const max = Math.max(0, labelWidth - overhead - 1);
    if (max <= 0) return;
    const raw = getComputedStyle(titleEl).getPropertyValue('--font-size-category').trim();
    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    const basePx = raw.endsWith('px') ? parseFloat(raw) : raw.endsWith('rem') ? parseFloat(raw) * rem : (parseFloat(raw) || parseFloat(getComputedStyle(titleEl).fontSize) || 16);
    const floorPx = Math.min(basePx, minPx), ceilPx = Math.max(basePx, minPx);
    const width = (px) => {
        nameEl.style.fontSize = `${px}px`; nameEl.style.whiteSpace = 'nowrap';
        const w = nameEl.scrollWidth; nameEl.style.whiteSpace = ''; nameEl.style.fontSize = ''; return w;
    };
    let chosen = ceilPx;
    for (let px = ceilPx; px >= floorPx; px -= 1) { chosen = px; if (width(px) <= max) break; }
    if (width(chosen) <= max) {
        nameEl.style.fontSize = Math.abs(chosen - basePx) < 0.5 ? '' : `${chosen}px`;
        return;
    }
    nameEl.style.fontSize = `${floorPx}px`;
    nameEl.classList.add('category-title-name--multiline');
    titleEl.classList.add('category-title--multiline');
}

async function openDashboard(page) {
    await page.setViewportSize({ width: 1400, height: 900 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('.category-title', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForTimeout(400);
}

/** Two identical sets of thirty categories, cloned from a real one, side by side in the grid's styles. */
async function buildSets(page) {
    await page.evaluate((names) => {
        const source = document.querySelector('.category-title').closest('.category, [class*="category"]:has(> .category-title)')
            || document.querySelector('.category-title').parentElement;
        const host = source.parentElement;
        ['a', 'b'].forEach((set) => {
            const wrap = document.createElement('div');
            wrap.id = `fit-probe-${set}`;
            wrap.style.cssText = 'display:grid;grid-template-columns:repeat(3,260px);gap:12px;';
            names.forEach((name, i) => {
                const clone = source.cloneNode(true);
                const nameEl = clone.querySelector('.category-title-name');
                nameEl.textContent = name;
                nameEl.style.fontSize = '';
                nameEl.classList.remove('category-title-name--multiline');
                clone.querySelector('.category-title').classList.remove('category-title--multiline');
                clone.setAttribute('data-fit-probe', String(i));
                wrap.appendChild(clone);
            });
            host.appendChild(wrap);
        });
    }, NAMES);
}

const outcome = (page, set) => page.evaluate((id) => [...document.querySelectorAll(`#${id} .category-title`)].map((t) => ({
    size: t.querySelector('.category-title-name').style.fontSize,
    multiline: t.classList.contains('category-title--multiline'),
})), `fit-probe-${set}`);

test('titles fitted together come out as fitting them one at a time did', async ({ page }) => {
    await openDashboard(page);
    await buildSets(page);
    await page.evaluate(`(${function run(ref) {
        // The minimum the module reads off <body>, so both use the same floor.
        const body = document.body;
        const had = body.className;
        [...body.classList].filter((n) => n.startsWith('font-size-')).forEach((n) => body.classList.remove(n));
        body.classList.add('font-size-xs');
        const raw = getComputedStyle(body).getPropertyValue('--font-size-category').trim();
        body.className = had;
        const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
        const minPx = raw.endsWith('px') ? parseFloat(raw) : raw.endsWith('rem') ? parseFloat(raw) * rem : 0.75 * rem;
        // eslint-disable-next-line no-new-func
        const fit = new Function(`return (${ref})`)();
        document.querySelectorAll('#fit-probe-a .category-title').forEach((t) => {
            window.DashboardCategoryTitleFit.ensureTitleStructure(t);
            fit(t, minPx);
        });
        window.DashboardCategoryTitleFit.fitAllCategoryTitles(document.getElementById('fit-probe-b'));
    }})(${JSON.stringify(referenceFit.toString())})`);
    const [a, b] = [await outcome(page, 'a'), await outcome(page, 'b')];
    // Something was shrunk and something wrapped, or the comparison proves nothing.
    expect(a.some((t) => t.size)).toBe(true);
    expect(a.some((t) => t.multiline)).toBe(true);
    expect(b).toEqual(a);
});

test('thirty titles take a handful of layouts, not one per read', async ({ page }) => {
    await openDashboard(page);
    await buildSets(page);
    const flushes = await page.evaluate(() => {
        // A read of layout after a write forces a layout: count those.
        let dirty = true; let count = 0;
        const read = () => { if (dirty) { count += 1; dirty = false; } };
        const write = () => { dirty = true; };
        const restore = [];
        const wrapGetter = (proto, prop) => {
            const d = Object.getOwnPropertyDescriptor(proto, prop);
            Object.defineProperty(proto, prop, { ...d, get() { read(); return d.get.call(this); } });
            restore.push(() => Object.defineProperty(proto, prop, d));
        };
        const wrapMethod = (obj, name, fn) => {
            const orig = obj[name];
            obj[name] = function (...a) { fn(); return orig.apply(this, a); };
            restore.push(() => { obj[name] = orig; });
        };
        ['clientWidth', 'scrollWidth', 'offsetWidth'].forEach((p) => wrapGetter(Element.prototype.hasOwnProperty(p) ? Element.prototype : HTMLElement.prototype, p));
        wrapMethod(Element.prototype, 'getBoundingClientRect', read);
        wrapMethod(window, 'getComputedStyle', read);
        wrapMethod(DOMTokenList.prototype, 'add', write);
        wrapMethod(DOMTokenList.prototype, 'remove', write);
        wrapMethod(Node.prototype, 'appendChild', write);
        // Chromium keeps these accessors on each style object, so each name's
        // own style is wrapped.
        document.querySelectorAll('#fit-probe-b .category-title-name').forEach((el) => {
            const style = el.style;
            ['fontSize', 'whiteSpace'].forEach((p) => {
                const d = Object.getOwnPropertyDescriptor(style, p);
                if (!d || !d.set) return;
                Object.defineProperty(style, p, { ...d, set(v) { write(); d.set.call(this, v); } });
                restore.push(() => Object.defineProperty(style, p, d));
            });
        });
        try {
            window.DashboardCategoryTitleFit.fitAllCategoryTitles(document.getElementById('fit-probe-b'));
        } finally {
            restore.reverse().forEach((r) => r());
        }
        return count;
    });
    expect(flushes).toBeLessThanOrEqual(8);
});
