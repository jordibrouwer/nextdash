// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissBlockingOverlays, dismissOnboardingIfPresent } = require('./e2e-helpers');

/**
 * The shortcut label has three settings, and the middle one is the point.
 *
 * The label used to be a yes/no. On, it sat in a track of its own down the
 * right of every category -- a second column of five-letter fragments, as loud
 * as the bookmark names beside it, and taking the width that made those names
 * truncate. Off, you lost the reminder of what your own shortcuts are.
 *
 * "hover" is the third answer: the label is out of the row's flow entirely, so
 * the name gets that width back, and it floats in over the row's right edge
 * while the pointer or the keyboard selection is on it. What this file pins is
 * the part that is easy to get subtly wrong -- that "hover" actually widens the
 * name rather than merely hiding the label in place.
 */

const SHORTCUT = 'ZQTST';

async function dashboard(page) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
}

/** A bookmark whose name is long enough to truncate, so width changes show. */
async function seedBookmark(page) {
    await page.evaluate(async (shortcut) => {
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        const pageId = window.dashboardInstance.settings.currentPage || 1;
        await api('/api/bookmarks/add', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                page: pageId,
                bookmark: {
                    name: 'A deliberately long bookmark name that has to truncate',
                    url: 'https://shortcut-display.example.com',
                    pageId,
                    shortcut,
                    category: '',
                },
            }),
        });
    }, SHORTCUT);
    // The grid renders from what the page loaded, so a seed only lands once the
    // dashboard has fetched it again -- same reason as in
    // tests/dashboard-shortcut-default.spec.js.
    await page.reload();
    await page.waitForSelector('#dashboard-layout', { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    // Attached, not visible: in "hover" the label is on the page at zero
    // opacity, which is the state half of these tests are about.
    await page.waitForSelector(`.bookmark-shortcut[data-shortcut="${SHORTCUT}"]`,
        { state: 'attached', timeout: 15_000 });
}

/** Set the mode the way the config view does, and let the body attribute follow. */
async function setMode(page, mode) {
    await page.evaluate((m) => {
        const d = window.dashboardInstance;
        d.settings.shortcutDisplay = m;
        d.setupDOM();
    }, mode);
    await page.waitForFunction((m) => document.body.getAttribute('data-shortcut-display') === m,
        mode, { timeout: 5_000 });
}

/**
 * The row, first occurrence.
 *
 * An uncategorised bookmark is drawn twice -- once where it lives and once in
 * the "today" smart collection -- so every selector here matches two elements.
 * The evaluate helpers below read document.querySelector, which is the first in
 * document order, and this hovers that same one.
 */
const row = (page) => page
    .locator('.bookmark-link', { has: page.locator(`.bookmark-shortcut[data-shortcut="${SHORTCUT}"]`) })
    .first();

/**
 * The label on screen, whichever of the two things is drawing it.
 *
 * "always" and "never" style the real element. "hover" hides that one and draws
 * the label as a pseudo-element of the bookmark name instead, so that it is
 * anchored to the name's column rather than to the row -- see the block in
 * dashboard-bookmark-row.css. Asking about only one of the two would make this
 * file agree with a mode that had quietly stopped working.
 */
const chipShown = (page) => page.evaluate((sc) => {
    const visible = (cs) => cs && cs.display !== 'none' && cs.visibility !== 'hidden'
        && Number(cs.opacity) > 0.5;

    const el = document.querySelector(`.bookmark-shortcut[data-shortcut="${sc}"]`);
    if (el && el.getClientRects().length > 0 && visible(getComputedStyle(el))) return true;

    const name = el?.closest('.bookmark-link')?.querySelector('.bookmark-open');
    if (!name) return false;
    const after = getComputedStyle(name, '::after');
    // content resolves to the rendered string, quoted; "none" means no pseudo.
    return after.content.includes(sc) && visible(after);
}, SHORTCUT);

/** Width of the name cell -- the thing the label was costing. */
const nameWidth = (page) => page.evaluate((sc) => {
    const el = document.querySelector(`.bookmark-shortcut[data-shortcut="${sc}"]`);
    const link = el?.closest('.bookmark-link');
    const name = link?.querySelector('.bookmark-open');
    return name ? name.getBoundingClientRect().width : 0;
}, SHORTCUT);

test.describe('shortcut label display modes', () => {
    test.beforeEach(async ({ page }) => {
        await dashboard(page);
        await seedBookmark(page);
    });

    test('a fresh install arrives with the letters on', async ({ page }) => {
        // 79c29ec9 turned the shortcut letters on for everyone: a fresh install
        // gets "always", and a one-time migration switched existing installs
        // over, including the ones whose old boolean said no. That commit
        // repinned two specs to the new default and missed this one.
        expect(await page.getAttribute('body', 'data-shortcut-display')).toBe('always');
    });

    test('always keeps the label on screen without the pointer', async ({ page }) => {
        await setMode(page, 'always');
        expect(await chipShown(page)).toBe(true);
    });

    test('never keeps it away even under the pointer', async ({ page }) => {
        await setMode(page, 'never');
        expect(await chipShown(page)).toBe(false);

        await row(page).hover();
        await page.waitForTimeout(250);
        expect(await chipShown(page)).toBe(false);
    });

    test('hover hides the label at rest and shows it on the row', async ({ page }) => {
        await setMode(page, 'hover');
        expect(await chipShown(page)).toBe(false);

        await row(page).hover();
        await page.waitForTimeout(250);
        expect(await chipShown(page)).toBe(true);
    });

    test('hover gives the width to the name', async ({ page }) => {
        await setMode(page, 'always');
        const withLabel = await nameWidth(page);

        await setMode(page, 'hover');
        const withoutLabel = await nameWidth(page);

        // The whole reason the mode exists. The label is five characters of
        // monospace plus padding and a border, so the gain is real, not a
        // rounding difference -- but assert the direction and a floor rather
        // than a pixel count, which depends on the font and the viewport.
        expect(withoutLabel).toBeGreaterThan(withLabel + 20);
    });

    test('the revealed label does not reserve the width back', async ({ page }) => {
        await setMode(page, 'hover');
        const atRest = await nameWidth(page);

        await row(page).hover();
        await page.waitForTimeout(250);
        const hovered = await nameWidth(page);

        // It floats over the row rather than pushing into it: hovering must not
        // move the name, or every pass of the mouse would make the grid twitch.
        expect(Math.abs(hovered - atRest)).toBeLessThan(2);
    });

    test('with response times on, the label stops where the name does', async ({ page }) => {
        // The label floats over the row's right end, and with response times on
        // that end belongs to the milliseconds. Pinning it to the row instead of
        // to the name column put it on top of the number -- and looked right in
        // every list that had times switched off.
        await page.evaluate(() => {
            const d = window.dashboardInstance;
            d.settings.showStatus = true;
            d.settings.showPing = true;
            d.setupDOM();
            d.renderBookmarks?.();
        });
        await page.waitForSelector('.bookmarks-list[data-show-ping="true"]', { timeout: 10_000 });
        await setMode(page, 'hover');
        await row(page).hover();
        await page.waitForTimeout(250);

        const placement = await page.evaluate((sc) => {
            const chipEl = document.querySelector(`.bookmark-shortcut[data-shortcut="${sc}"]`);
            const link = chipEl?.closest('.bookmark-link');
            const nameEl = link?.querySelector('.bookmark-open');
            if (!nameEl) return null;
            const after = getComputedStyle(nameEl, '::after');
            return {
                drawnOnTheName: after.content.includes(sc),
                nameIsTheAnchor: getComputedStyle(nameEl).position === 'relative',
                offsetFromNameEdge: after.right,
                realChipHidden: getComputedStyle(chipEl).display === 'none',
                pingColumn: !!link.closest('.bookmarks-list[data-show-ping="true"]'),
                // Four tracks, not three: there is a column to the right of the
                // name for the label to stay out of. Without this the test
                // would still pass on a list that had no such column at all.
                tracks: getComputedStyle(link.closest('.bookmarks-list'))
                    .gridTemplateColumns.trim().split(/\s+/).length,
            };
        }, SHORTCUT);

        expect(placement).not.toBeNull();
        expect(placement.pingColumn).toBe(true);
        // The label hangs off the name and sits flush with its right edge, so
        // the response-time column beside it is untouched whatever the row's
        // padding, gap or column widths happen to be.
        expect(placement.drawnOnTheName).toBe(true);
        expect(placement.realChipHidden).toBe(true);
        expect(placement.nameIsTheAnchor).toBe(true);
        expect(placement.offsetFromNameEdge).toBe('0px');
        expect(placement.tracks).toBe(4);
    });

    test('the keyboard selection reveals it too, without a pointer', async ({ page }) => {
        await setMode(page, 'hover');
        await page.evaluate((sc) => {
            const el = document.querySelector(`.bookmark-shortcut[data-shortcut="${sc}"]`);
            el?.closest('.bookmark-link')?.classList.add('keyboard-selected');
        }, SHORTCUT);
        await page.waitForTimeout(250);
        expect(await chipShown(page)).toBe(true);
    });
});
