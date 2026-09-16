// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * The action buttons can leave the header.
 *
 * With six or seven of them beside the pages and the destinations the band
 * read as clutter, so the same group can stand in a dock at the bottom, in a
 * column on either side, or behind one menu in the header. Chosen in Config,
 * the way a reader does it; what is checked is where the group ends up, not
 * its pixels.
 */

async function openDashboard(page) {
    await page.setViewportSize({ width: 1500, height: 900 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('.bookmark-link', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.evaluate(async () => {
        const d = window.dashboardInstance;
        Object.assign(d.settings, {
            showAddBookmarkButton: true,
            showSearchButton: true,
            showCommandsButton: true,
            showFindersButton: true,
            showRecentButton: true,
        });
        d.setupDOM?.();
        await d.saveSettings?.();
    });
}

/** Pick a placement through Appearance → Action bar, then leave config. */
async function choosePlacement(page, value) {
    await page.keyboard.press('Shift+Comma');
    await page.click('[data-config-section="appearance"]');
    await page.click('[data-appearance-tab="buttonbar"]');
    await page.locator('select[data-behavior-field="actionBarPosition"]').selectOption(value);
    await expect.poll(() => page.evaluate(() => window.dashboardInstance.settings.actionBarPosition)).toBe(value);
    await page.keyboard.press('Escape');
    await page.waitForSelector('.bookmark-link', { timeout: 10_000 });
}

const group = (page) => page.evaluate(() => {
    const el = document.querySelector('.header-shortcuts');
    const s = window.getComputedStyle(el);
    const r = el.getBoundingClientRect();
    const header = document.querySelector('.header-top').getBoundingClientRect();
    const drawn = [...el.querySelectorAll('button.search-button')]
        .filter((b) => !b.classList.contains('header-action-overflow'))
        .filter((b) => window.getComputedStyle(b).display !== 'none');
    return {
        attr: document.body.getAttribute('data-action-bar'),
        position: s.position,
        direction: s.flexDirection,
        inHeader: r.top < header.bottom && r.bottom > header.top,
        nearBottom: r.bottom > window.innerHeight - 80,
        side: r.left < window.innerWidth / 2 ? 'left' : 'right',
        shown: drawn.length,
        folded: el.querySelectorAll('.is-folded').length,
        overflow: Boolean(el.querySelector('.header-action-overflow')),
    };
});

test('a dock at the bottom holds every action', async ({ page }) => {
    await openDashboard(page);
    await choosePlacement(page, 'bottom');
    const g = await group(page);
    expect(g.attr).toBe('bottom');
    expect(g.position).toBe('fixed');
    expect(g.inHeader, 'the dock is still in the header').toBe(false);
    expect(g.nearBottom, 'the dock is not at the bottom').toBe(true);
    expect(g.folded, 'the dock folds actions away').toBe(0);
    expect(g.overflow).toBe(false);
});

for (const side of ['left', 'right']) {
    test(`a column on the ${side} stands the actions on top of each other`, async ({ page }) => {
        await openDashboard(page);
        await choosePlacement(page, 'header');
        const firstInHeader = await page.evaluate(() => Math.round(document.querySelector('.bookmark-link').getBoundingClientRect().left));
        await choosePlacement(page, side);
        const g = await group(page);
        expect(g.position).toBe('fixed');
        expect(g.direction).toBe('column');
        expect(g.side).toBe(side);
        expect(g.inHeader).toBe(false);
        expect(g.folded).toBe(0);

        // Nothing moves to make room for the column on a wide window.
        const first = await page.evaluate(() => Math.round(document.querySelector('.bookmark-link').getBoundingClientRect().left));
        expect(first).toBe(firstInHeader);
    });
}

test('the menu placement keeps add in the header and folds the rest', async ({ page }) => {
    await openDashboard(page);
    await choosePlacement(page, 'menu');
    const g = await group(page);
    expect(g.inHeader, 'the menu left the header').toBe(true);
    expect(g.shown, 'more than add stands in the header').toBe(1);
    expect(g.overflow, 'there is no menu for the rest').toBe(true);
    expect(g.folded).toBeGreaterThan(0);

    // The keys do not care where the button is.
    await page.keyboard.press('/');
    await expect(page.locator('#shortcut-search.show')).toBeVisible({ timeout: 5000 });
});

test('back in the header, the fold works as before', async ({ page }) => {
    await openDashboard(page);
    await choosePlacement(page, 'header');
    const g = await group(page);
    expect(g.attr).toBe('header');
    expect(g.position).not.toBe('fixed');
    expect(g.inHeader).toBe(true);
});
