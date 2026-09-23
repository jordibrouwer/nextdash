// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * The menus are lit by the theme like everything else.
 *
 * .move-popover is the one surface every menu in the app wears -- the bookmark
 * and category menus, config's own, the check-mode menu, and the move, tag and
 * delete pickers -- and it drew the same flat box at rich, glass and flat
 * alike: a 10px corner where every panel takes 8, and 0 4px 18px of
 * --text-primary at 14%, which on a dark theme is a pale glow under the menu
 * rather than a shadow. It was the last surface outside the depth ladder.
 *
 * And it stays unblurred at every depth. Blur on a menu is what gave Safari a
 * composited layer that hit-tested in front of what it covered and ate the
 * clicks aimed at it; .health-view-menu lost its blur for exactly that, and
 * this is the rule that would put one back on every menu at once.
 */
async function openMenu(page, depth) {
    await page.setViewportSize({ width: 1500, height: 1000 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('.bookmark-link', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.evaluate((d) => document.body.setAttribute('data-depth', d), depth);
    // Through the right-click someone makes, not through the renderer.
    await page.locator('.bookmark-link').first().click({ button: 'right' });
    await page.waitForSelector('.bookmark-context-menu', { timeout: 20_000 });
}

const menuStyle = (page) => page.evaluate(() => {
    const cs = window.getComputedStyle(document.querySelector('.bookmark-context-menu'));
    return {
        radius: parseFloat(cs.borderTopLeftRadius),
        blur: cs.backdropFilter,
        insets: cs.boxShadow.split(/,(?![^(]*\))/).filter((p) => p.includes('inset')).length,
        shadow: cs.boxShadow,
    };
});


/**
 * The pixel value of a radius token, as the browser resolves it.
 *
 * A theme's character moves every corner now -- the fresh-install theme is
 * brushed and asks for 0.7 of the scale -- so the number to compare against is
 * the token, measured on an element that uses it, not a constant.
 */
const radiusPx = (page, token) => page.evaluate((name) => {
    const probe = document.createElement('div');
    probe.style.cssText = `position:fixed;left:-9999px;width:10px;height:10px;border-radius:var(${name})`;
    document.body.appendChild(probe);
    const value = getComputedStyle(probe).borderRadius;
    probe.remove();
    return value;
}, token);

test('a menu carries the theme edges and a real drop', async ({ page }) => {
    await openMenu(page, 'rich');
    const style = await menuStyle(page);

    expect(style.insets, `no two-sided edge: ${style.shadow}`).toBeGreaterThanOrEqual(2);
    /*
     * The drop was mixed from --text-primary, so on a dark theme it lit the
     * menu from below instead of casting from it. A black layer is what says
     * it casts -- in either spelling, since a color-mix computes to color(srgb
     * 0 0 0 / a) rather than rgba().
     */
    const black = style.shadow.split(/,(?![^(]*\))/)
        .some((part) => /rgba\(0,\s*0,\s*0|color\(srgb 0 0 0/.test(part));
    expect(black, `the drop is still a pale halo: ${style.shadow}`).toBe(true);
    expect(`${style.radius}px`, 'the menu keeps a corner no panel uses')
        .toBe(await radiusPx(page, '--radius-5'));
});

test('flat leaves the menu flat', async ({ page }) => {
    await openMenu(page, 'flat');
    const style = await menuStyle(page);

    expect(style.insets, 'the edges are drawn on a flat theme').toBe(0);
});

for (const depth of ['rich', 'glass', 'flat']) {
    test(`a menu is never blurred, ${depth} included`, async ({ page }) => {
        await openMenu(page, depth);
        const style = await menuStyle(page);

        // Not a style preference: a blurred menu is a composited layer, and in
        // Safari that layer hit-tests in front of what it covers.
        expect(style.blur, 'a menu gained a backdrop-filter').toBe('none');
    });
}
