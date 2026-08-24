// @ts-check
const { test, expect } = require('./fixtures');
const { prepareDashboardInteraction } = require('./e2e-helpers');

/**
 * Modern layout coverage for the health view.
 *
 * Modern is an override layer over classic, so "is it supported here?" is not a
 * question about markup — both layouts render the same DOM. It is a question
 * about whether the modern rules actually win in the cascade. Each assertion
 * therefore compares a computed style between the two layouts on the same
 * element: if layout-modern-tokens.css stopped loading, or a view stylesheet
 * started overriding the modern block, these fail.
 *
 * The report is mocked (as in health-dashboard-view.spec.js) so the rows exist
 * regardless of how the seeded bookmarks happen to score.
 */

function report() {
    return {
        generatedAt: Date.now(),
        summary: {
            totalBookmarks: 3,
            healthyCount: 1,
            brokenCount: 1,
            duplicateCount: 0,
            uncheckedCount: 1,
        },
        issues: [
            {
                pageId: 1, index: 0, pageName: 'dev', name: 'Broken one',
                url: 'https://example.com/broken', category: 'tools',
                status: 'broken', score: 25, duplicateCount: 0,
                lastChecked: 1752000000000,
                reasons: ['HTTP 500'],
                reasonDetails: [{ code: 'last_error', detail: 'HTTP 500', penalty: 60 }],
            },
            {
                pageId: 1, index: 1, pageName: 'dev', name: 'Never checked one',
                url: 'https://example.com/fresh', category: 'tools',
                status: 'unchecked', score: 90, duplicateCount: 0,
                reasons: ['Status check has never run'],
                reasonDetails: [{ code: 'status_never_run', penalty: 10 }],
            },
        ],
        duplicateGroups: [],
    };
}

async function openHealthView(page) {
    await page.route('**/api/bookmark-health**', async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(report()),
        });
    });
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await prepareDashboardInteraction(page);
    await page.click('.health-link a.health-link-anchor');
    await page.waitForSelector('#dashboard-layout.health-layout .health-view-item', { timeout: 15_000 });
}

/**
 * Switch layout in place, so both readings describe the same rendered rows.
 *
 * Modern transitions box-shadow, so a computed style read straight after the
 * flip catches the animation mid-flight — a shadow still interpolating out of
 * `none` reads as fully transparent. Disable animations for the duration of the
 * switch and wait a frame, so every assertion sees the settled value.
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

/**
 * @param {import('@playwright/test').Page} page
 * @param {string} selector
 * @param {string[]} props
 */
async function computed(page, selector, props) {
    return page.evaluate(({ sel, list }) => {
        const el = document.querySelector(sel);
        if (!el) throw new Error(`missing element: ${sel}`);
        const s = getComputedStyle(el);
        return Object.fromEntries(list.map((p) => [p, s[p]]));
    }, { sel: selector, list: props });
}

/** Read both layouts for one selector. */
async function bothLayouts(page, selector, props) {
    await setLayout(page, 'classic');
    const classic = await computed(page, selector, props);
    await setLayout(page, 'modern');
    const modern = await computed(page, selector, props);
    return { classic, modern };
}

test.describe('modern layout — health view', () => {
    test('defines its design tokens only in modern', async ({ page }) => {
        await openHealthView(page);

        const read = () => page.evaluate(() => {
            const s = getComputedStyle(document.body);
            return {
                radiusMd: s.getPropertyValue('--layout-radius-md').trim(),
                surface: s.getPropertyValue('--layout-surface').trim(),
                shadowSm: s.getPropertyValue('--layout-shadow-sm').trim(),
                focusRing: s.getPropertyValue('--layout-focus-ring').trim(),
            };
        });

        await setLayout(page, 'modern');
        const modern = await read();
        expect(modern.radiusMd).toBe('12px');
        expect(modern.surface).not.toBe('');
        expect(modern.shadowSm).not.toBe('');
        expect(modern.focusRing).not.toBe('');

        // Classic must not inherit the modern surface language. --layout-radius-*
        // is deliberately excluded: dashboard-enhancements.css publishes that
        // scale on :root for both layouts.
        await setLayout(page, 'classic');
        const classic = await read();
        expect(classic.surface).toBe('');
        expect(classic.shadowSm).toBe('');
        expect(classic.focusRing).toBe('');
    });

    test('restyles feed rows', async ({ page }) => {
        await openHealthView(page);
        const { classic, modern } = await bothLayouts(
            page,
            '.health-view-item',
            ['borderRadius', 'boxShadow'],
        );

        expect(modern.borderRadius).not.toBe(classic.borderRadius);
        expect(classic.boxShadow).toBe('none');
        expect(modern.boxShadow).not.toBe('none');
    });

    test('redraws the severity marker as an inset bar', async ({ page }) => {
        await openHealthView(page);

        // Classic draws severity as a 3px left border, which a rounded corner
        // would clip into a wedge; modern moves it into an inset shadow.
        const { classic, modern } = await bothLayouts(
            page,
            '.health-view-item.is-broken',
            ['borderLeftWidth', 'boxShadow'],
        );

        expect(classic.borderLeftWidth).toBe('3px');
        expect(modern.borderLeftWidth).toBe('1px');

        // Not just "an inset exists": the bar must still be drawn in the error
        // colour at full opacity. A shadow read mid-transition interpolates out
        // of `none` and reads as transparent, which would silently pass a
        // contains('inset') check while showing no marker at all.
        expect(modern.boxShadow).toMatch(/inset/);
        const insetLayer = modern.boxShadow.split(/,(?![^(]*\))/).find((l) => l.includes('inset'));
        expect(insetLayer).toBeDefined();
        expect(insetLayer).not.toMatch(/\/\s*0\s*\)|rgba\([^)]*,\s*0\)/);
    });

    test('restyles summary tiles and the filter group', async ({ page }) => {
        await openHealthView(page);

        const tile = await bothLayouts(page, '.health-view-tile', ['borderRadius', 'boxShadow']);
        expect(tile.modern.borderRadius).not.toBe(tile.classic.borderRadius);
        expect(tile.modern.boxShadow).not.toBe('none');

        // The pill shape is already correct in classic, so only depth changes.
        const group = await bothLayouts(page, '.health-view-filter-group', ['boxShadow']);
        expect(group.classic.boxShadow).toBe('none');
        expect(group.modern.boxShadow).not.toBe('none');
    });

    test('gives toolbar and row action buttons the modern radius', async ({ page }) => {
        await openHealthView(page);

        const exportBtn = await bothLayouts(page, '.health-view-export-btn', ['borderRadius']);
        expect(exportBtn.modern.borderRadius).not.toBe(exportBtn.classic.borderRadius);

        const action = await bothLayouts(page, '.health-view-action-btn', ['borderRadius']);
        expect(action.modern.borderRadius).not.toBe(action.classic.borderRadius);
    });

    test('leaves classic byte-for-byte unchanged when modern is off', async ({ page }) => {
        await openHealthView(page);

        // Guards the whole override layer: every modern rule is scoped to the
        // body attribute, so with it absent the view must equal plain classic.
        await setLayout(page, 'classic');
        const asClassic = await computed(page, '.health-view-item', ['borderRadius', 'boxShadow', 'borderLeftWidth']);

        await page.evaluate(() => {
            document.documentElement.removeAttribute('data-layout-version');
            document.body.removeAttribute('data-layout-version');
        });
        const noAttribute = await computed(page, '.health-view-item', ['borderRadius', 'boxShadow', 'borderLeftWidth']);

        expect(noAttribute).toEqual(asClassic);
    });
});
