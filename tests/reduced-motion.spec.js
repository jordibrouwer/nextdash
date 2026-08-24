// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen } = require('./e2e-helpers');

/**
 * Animation suppression used to be wired per component: an in-app
 * `body.no-animations` rule plus a hand-written prefers-reduced-motion block.
 * Newer stylesheets only ever got the first half, so the tag cloud's infinite
 * pulse kept running for someone whose OS had asked for less motion.
 *
 * The OS preference is an accessibility signal and wins on its own — these
 * tests keep the app setting explicitly ON so a pass cannot be produced by the
 * in-app toggle doing the work.
 */

async function loadWithReducedMotion(page) {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    // Animations explicitly enabled: the OS preference has to override it.
    await page.evaluate(() => {
        const d = window.dashboardInstance;
        d.settings.animationsEnabled = true;
        d.applyAnimations?.();
    });
    expect(await page.evaluate(() =>
        document.body.classList.contains('no-animations'))).toBe(false);
}

test('the OS preference stops the infinite tag-cloud pulse', async ({ page }) => {
    await loadWithReducedMotion(page);

    const icon = page.locator('.tag-cloud-toggle-btn .search-button-icon').first();
    await expect(icon).toHaveCount(1);

    const style = await icon.evaluate((el) => {
        const c = getComputedStyle(el);
        return { duration: c.animationDuration, iterations: c.animationIterationCount };
    });
    // Near-zero rather than `none`, so animationend still fires for the code
    // that waits on it.
    expect(parseFloat(style.duration)).toBeLessThan(0.05);
    expect(style.iterations).toBe('1');
});

test('it reaches stylesheets that never declared a reduced-motion block', async ({ page }) => {
    await loadWithReducedMotion(page);

    // layout-side-rail.css has transitions and no reduced-motion rules of its own.
    await page.evaluate(() => {
        const d = window.dashboardInstance;
        d.settings.buttonBarPosition = 'side-left';
        d.settings.layoutVersion = 'modern';
        d.setupDOM?.();
    });
    const btn = page.locator('#search-button').first();
    await expect(btn).toBeVisible();

    const durations = await btn.evaluate((el) =>
        getComputedStyle(el).transitionDuration.split(',').map((v) => parseFloat(v)));
    expect(Math.max(...durations)).toBeLessThan(0.05);
});

/**
 * The rule is global, so spot-checking two elements proves very little. Walk the
 * real stylesheets, collect every selector that declares an infinite animation —
 * across health, inbox, config, modals and skeletons — and assert each one is
 * actually stopped. New infinite animations are picked up automatically.
 */
test('every infinite animation in the app is stopped', async ({ page }) => {
    await loadWithReducedMotion(page);

    const result = await page.evaluate(() => {
        /** Selectors declaring an infinite animation, straight from the CSSOM. */
        const selectors = [];
        for (const sheet of Array.from(document.styleSheets)) {
            let rules;
            try {
                rules = sheet.cssRules;
            } catch {
                continue; // cross-origin; none of ours are
            }
            const walk = (list) => {
                for (const rule of Array.from(list || [])) {
                    if (rule.cssRules) walk(rule.cssRules);
                    if (!rule.style || !rule.selectorText) continue;
                    const anim = rule.style.getPropertyValue('animation')
                        + ' ' + rule.style.getPropertyValue('animation-iteration-count');
                    if (anim.includes('infinite')) selectors.push(rule.selectorText);
                }
            };
            walk(rules);
        }

        // Probe each selector on a detached-but-rendered element built to match it.
        const offenders = [];
        const host = document.createElement('div');
        document.body.appendChild(host);
        for (const selectorText of selectors) {
            for (const one of selectorText.split(',')) {
                const sel = one.trim();
                if (!sel || sel.includes(':hover') || sel.includes('::')) continue;
                // Build a chain matching the selector's last compound part.
                const parts = sel.split(/\s+|>/).filter(Boolean);
                let el = host;
                for (const part of parts) {
                    const node = document.createElement(
                        /^[a-zA-Z]/.test(part) ? part.match(/^[a-zA-Z]+/)[0] : 'div');
                    for (const cls of part.match(/\.[-\w]+/g) || []) node.classList.add(cls.slice(1));
                    for (const attr of part.match(/\[[^\]]+\]/g) || []) {
                        const [, k, v] = attr.match(/\[([^=\]]+)=?"?([^"\]]*)"?\]/) || [];
                        if (k) node.setAttribute(k, v || '');
                    }
                    const id = part.match(/#([-\w]+)/);
                    if (id) node.id = id[1];
                    el.appendChild(node);
                    el = node;
                }
                if (el === host) continue;
                const c = getComputedStyle(el);
                if (c.animationIterationCount.includes('infinite')
                    && parseFloat(c.animationDuration) > 0.05) {
                    offenders.push(`${sel} → ${c.animationName} ${c.animationDuration}`);
                }
            }
        }
        host.remove();
        return { count: selectors.length, offenders };
    });

    // Sanity: the sweep has to have actually found the declarations.
    expect(result.count).toBeGreaterThan(10);
    expect(result.offenders).toEqual([]);
});

test('without the OS preference the animation still runs', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await page.evaluate(() => {
        const d = window.dashboardInstance;
        d.settings.animationsEnabled = true;
        d.applyAnimations?.();
    });

    const style = await page.locator('.tag-cloud-toggle-btn .search-button-icon').first().evaluate((el) => {
        const c = getComputedStyle(el);
        return { duration: c.animationDuration, iterations: c.animationIterationCount };
    });
    // Guards the blast radius: the rule must not suppress motion for everyone.
    expect(parseFloat(style.duration)).toBeGreaterThan(1);
    expect(style.iterations).toBe('infinite');
});
