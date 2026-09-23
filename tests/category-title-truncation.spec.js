// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * A category name too long for its column is shrunk and wrapped, not cut.
 *
 * dashboard-category-title-fit.js steps the font down and falls back to two
 * clamped lines, and it decides by reading nameEl.scrollWidth with white-space
 * nowrap. .category-title-name is a span, and an inline box reports 0 for
 * scrollWidth — so every title measured as fitting, nothing was ever shrunk or
 * wrapped, and the name simply ran past its column until
 * .category-title-label's overflow: hidden cut it mid-word with no ellipsis.
 * "unknown category (testing)" read as "unknown category (testi".
 *
 * The span is a block box now, which is what makes both the fit logic and the
 * text-overflow it already declared do anything at all.
 */
async function renameFirstCategory(page, name) {
    await page.setViewportSize({ width: 1400, height: 900 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('.bookmark-link', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });

    const applied = await page.evaluate((wanted) => {
        const d = window.dashboardInstance;
        const category = (d.categories || []).find((c) => !c.isSmartCollection);
        if (!category) return false;
        category.name = wanted;
        d.renderDashboard();
        return true;
    }, name);

    // The fit runs on a frame after the render.
    await page.waitForTimeout(600);
    return applied;
}

const measure = (page, name) => page.evaluate((wanted) => {
    const el = [...document.querySelectorAll('.category-title-name')]
        .find((node) => node.textContent.trim() === wanted);
    if (!el) return null;
    const label = el.closest('.category-title-label');
    const style = window.getComputedStyle(el);
    return {
        display: style.display,
        fontPx: parseFloat(style.fontSize),
        multiline: el.classList.contains('category-title-name--multiline'),
        // An inline box reports 0 for both, which is exactly what left the fit
        // logic thinking every title fitted.
        scrollWidth: el.scrollWidth,
        width: Math.round(el.getBoundingClientRect().width),
        labelWidth: Math.round(label.getBoundingClientRect().width),
    };
}, name);

test('a category name too long for its column stays inside it', async ({ page }) => {
    const name = 'a category whose name is far too long to fit in one column';
    test.skip(!(await renameFirstCategory(page, name)), 'needs a category to rename');

    const got = await measure(page, name);
    expect(got, 'the renamed category is not on screen').not.toBeNull();

    expect(got.display, 'an inline box ignores overflow, text-overflow and scrollWidth alike')
        .not.toBe('inline');
    expect(got.scrollWidth,
        'the name measures 0 wide, so the fit logic has nothing to work from')
        .toBeGreaterThan(0);
    expect(got.width,
        'the name is drawn past the label that is supposed to bound it')
        .toBeLessThanOrEqual(got.labelWidth + 1);

    // Shrunk, wrapped, or both -- whichever the fit chose, it did something.
    expect(got.multiline || got.fontPx < 14,
        'the name overflows and was neither shrunk nor wrapped').toBe(true);
});

// A name that fits is left alone: the fit is for names that do not.
test('a short category name is neither shrunk nor wrapped', async ({ page }) => {
    const name = 'news';
    test.skip(!(await renameFirstCategory(page, name)), 'needs a category to rename');

    const got = await measure(page, name);
    expect(got).not.toBeNull();
    expect(got.multiline, 'a short name was wrapped to two lines').toBe(false);
    expect(got.width).toBeLessThanOrEqual(got.labelWidth + 1);
});
