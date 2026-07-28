// @ts-check
const { test, expect } = require('@playwright/test');
const { dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * Modern layout coverage for the config view.
 *
 * Same shape as layout-modern-health.spec.js: modern is an override layer, so
 * every assertion compares a computed style between the two layouts on the same
 * element rather than checking markup.
 *
 * Config is the view where the layout is chosen, so "modern changes nothing
 * here" was the most visible gap in the old override layer — these tests are
 * what stop it reopening.
 */

const HEALTH = {
    summary: {
        totalBookmarks: 7, healthyCount: 3, brokenCount: 2, monitorDownCount: 1,
        duplicateCount: 1, uncheckedCount: 1, staleCount: 2, shortcutConflictCount: 0,
    },
    issues: [], duplicateGroups: [],
};

async function openConfig(page, section = 'overview') {
    await page.route('**/api/bookmark-health', (route) => route.fulfill({
        status: 200, contentType: 'application/json', body: JSON.stringify(HEALTH),
    }));
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.allBookmarks?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.evaluate((s) => window.dashboardInstance.config.openConfigView(s), section);
    await expect(page.locator('.config-view')).toBeVisible();
}

/**
 * Switch layout in place. Transitions are killed first: modern animates
 * box-shadow, and a shadow read mid-flight still interpolating out of `none`
 * computes as fully transparent, which would make an assertion pass while the
 * element shows nothing.
 */
async function setLayout(page, version) {
    await page.addStyleTag({
        content: '*, *::before, *::after { transition: none !important; animation: none !important; }',
    });
    await page.evaluate((v) => {
        document.documentElement.setAttribute('data-layout-version', v);
        document.body.setAttribute('data-layout-version', v);
    }, version);
    await page.evaluate(() => new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(resolve));
    }));
}

async function computed(page, selector, props) {
    return page.evaluate(({ sel, list }) => {
        const el = document.querySelector(sel);
        if (!el) throw new Error(`missing element: ${sel}`);
        const s = getComputedStyle(el);
        return Object.fromEntries(list.map((p) => [p, s[p]]));
    }, { sel: selector, list: props });
}

async function bothLayouts(page, selector, props) {
    await setLayout(page, 'classic');
    const classic = await computed(page, selector, props);
    await setLayout(page, 'modern');
    const modern = await computed(page, selector, props);
    return { classic, modern };
}

test.describe('modern layout — config view', () => {
    test('restyles status tiles', async ({ page }) => {
        await openConfig(page);
        const { classic, modern } = await bothLayouts(
            page,
            '.config-tile',
            ['borderRadius', 'boxShadow'],
        );

        // Radius is deliberately not asserted here: classic already sets 12px on
        // .config-tile, which is exactly --layout-radius-md, so the two agree by
        // coincidence rather than by omission. Depth is the real signal.
        expect(classic.boxShadow).toBe('none');
        expect(modern.boxShadow).not.toBe('none');
        expect(modern.borderRadius).toBe('12px');
    });

    test('insets the tile severity stripe so it follows the corner', async ({ page }) => {
        await openConfig(page);

        // Classic pins ::before to inset:0, which a rounded tile clips into a
        // wedge. Modern insets it vertically and rounds its outer end.
        const read = () => page.evaluate(() => {
            const el = document.querySelector('.config-tile');
            if (!el) throw new Error('missing .config-tile');
            const s = getComputedStyle(el, '::before');
            return { top: s.top, borderRadius: s.borderRadius };
        });

        await setLayout(page, 'classic');
        const classic = await read();
        await setLayout(page, 'modern');
        const modern = await read();

        expect(classic.top).toBe('0px');
        expect(modern.top).not.toBe('0px');
        expect(modern.borderRadius).not.toBe(classic.borderRadius);
    });

    test('draws the accent stripe from the theme instead of hardcoded blue', async ({ page }) => {
        await openConfig(page, 'appearance');
        await expect(page.locator('.config-tile--accent').first()).toBeVisible();

        const read = () => page.evaluate(() => {
            const el = document.querySelector('.config-tile--accent');
            if (!el) throw new Error('missing .config-tile--accent');
            return {
                stripe: getComputedStyle(el, '::before').backgroundColor,
                accent: getComputedStyle(document.body).getPropertyValue('--accent-primary').trim(),
            };
        });

        // Classic resolves --accent-color, which nothing defines, so the stripe
        // falls back to a literal #4a90d9 that no theme ever asked for.
        await setLayout(page, 'classic');
        const classic = await read();
        expect(classic.stripe).toBe('rgb(74, 144, 217)');

        // Modern re-points it at the live theme accent.
        await setLayout(page, 'modern');
        const modern = await read();
        expect(modern.stripe).not.toBe('rgb(74, 144, 217)');
        expect(modern.accent).not.toBe('');
    });

    test('restyles panels', async ({ page }) => {
        await openConfig(page);
        const { classic, modern } = await bothLayouts(
            page,
            '.config-panel',
            ['borderRadius', 'boxShadow'],
        );

        expect(classic.boxShadow).toBe('none');
        expect(modern.boxShadow).not.toBe('none');
        expect(modern.borderRadius).not.toBe(classic.borderRadius);
    });

    test('restyles the section nav and its active item', async ({ page }) => {
        await openConfig(page);

        const active = await bothLayouts(page, '.config-nav-item.is-active', ['boxShadow']);
        expect(active.classic.boxShadow).toBe('none');
        expect(active.modern.boxShadow).toContain('inset');
    });

    test('restyles the layout choice buttons in appearance', async ({ page }) => {
        // The control that switches layout must itself follow the layout.
        await openConfig(page, 'appearance');
        await expect(page.locator('.config-choices').first()).toBeVisible();

        const group = await bothLayouts(page, '.config-choices', ['borderRadius', 'boxShadow']);
        expect(group.classic.boxShadow).toBe('none');
        expect(group.modern.boxShadow).not.toBe('none');
        expect(group.modern.borderRadius).not.toBe(group.classic.borderRadius);

        const activeChoice = await bothLayouts(page, '.config-choice.is-active', ['borderRadius', 'boxShadow']);
        expect(activeChoice.modern.boxShadow).toContain('inset');
        expect(activeChoice.modern.borderRadius).not.toBe(activeChoice.classic.borderRadius);
    });

    test('restyles buttons', async ({ page }) => {
        await openConfig(page, 'data-backups');
        await expect(page.locator('.config-btn').first()).toBeVisible();

        // Radius already agrees (classic 8px == --layout-radius-sm) and so does
        // text colour (classic's `inherit` fallback lands on the same value as
        // --text-primary). The border is the one property that genuinely moves:
        // classic draws the undefined-variable grey, modern the theme-derived
        // surface border.
        const { classic, modern } = await bothLayouts(
            page,
            '.config-btn',
            ['borderRadius', 'borderColor'],
        );

        expect(modern.borderRadius).toBe('8px');
        expect(modern.borderColor).not.toBe(classic.borderColor);
    });

    test('leaves classic unchanged when the layout attribute is absent', async ({ page }) => {
        await openConfig(page);

        await setLayout(page, 'classic');
        const asClassic = await computed(page, '.config-panel', ['borderRadius', 'boxShadow', 'backgroundColor']);

        await page.evaluate(() => {
            document.documentElement.removeAttribute('data-layout-version');
            document.body.removeAttribute('data-layout-version');
        });
        const noAttribute = await computed(page, '.config-panel', ['borderRadius', 'boxShadow', 'backgroundColor']);

        expect(noAttribute).toEqual(asClassic);
    });
});
