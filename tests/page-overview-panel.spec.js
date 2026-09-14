// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * The pages panel is drawn like recent bookmarks.
 *
 * Both are a short list you open with one key and leave with another, so they
 * were two designs for one idea: this one had every page in its own outlined
 * card, a full-width *Close page list* button, and an ESC hint under that —
 * the same third way of saying what Esc already says that the recents panel
 * lost when it was redrawn.
 *
 * It takes the same treatment now: the name with its key beside it, a way out
 * on the right, the rows in one slab, and a thin foot.
 */
async function openPages(page) {
    await page.setViewportSize({ width: 1500, height: 900 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('.bookmark-link', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    // Through the key someone presses, not through the renderer.
    await page.keyboard.press(',');
    await page.waitForSelector('.page-overview-modal', { timeout: 20_000 });
}

test('the header names the key and carries the way out', async ({ page }) => {
    await openPages(page);

    expect((await page.locator('.page-overview-modal-key').textContent() || '').trim()).toBe(',');

    const actions = await page.evaluate(() => {
        const el = document.querySelector('.page-overview-modal .modal-actions');
        return el ? window.getComputedStyle(el).display : 'absent';
    });
    expect(actions, 'the wide Close button is back').toBe('none');

    await page.locator('.page-overview-modal-close').click();
    await expect(page.locator('#app-modal.show .page-overview-modal')).toHaveCount(0);
});

test('a page is a row in one slab, not a card of its own', async ({ page }) => {
    await openPages(page);

    const row = await page.evaluate(() => {
        const link = document.querySelector('.page-overview-modal-link');
        const list = document.querySelector('.page-overview-modal-list');
        const cs = window.getComputedStyle(link);
        /*
         * The resting colour comes off a probe, not off a row.
         *
         * The panel marks the page you are on with .is-focused and keeps it
         * marked — it is the cursor, not a hover — so every row on screen may
         * legitimately be carrying the accent wash. What is under test is the
         * rule: a row, by itself, paints nothing.
         */
        const probe = document.createElement('button');
        probe.className = 'page-overview-modal-link';
        list.appendChild(probe);
        const resting = window.getComputedStyle(probe).backgroundColor;
        probe.remove();
        return {
            height: Math.round(link.getBoundingClientRect().height),
            borderWidth: parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth),
            background: resting,
            listHasGround: window.getComputedStyle(list).backgroundColor !== 'rgba(0, 0, 0, 0)',
        };
    });

    expect(row.borderWidth, 'the row draws its own box').toBe(0);
    expect(row.background, 'a resting row paints its own ground')
        .toMatch(/rgba\(0, 0, 0, 0\)|transparent/);
    expect(row.height, `a row is ${row.height}px tall`).toBeLessThan(40);
    expect(row.listHasGround, 'the list has no slab under it').toBe(true);
});

test('the foot counts the pages instead of repeating Esc', async ({ page }) => {
    await openPages(page);

    const foot = await page.locator('.page-overview-modal-foot').innerText();
    // "1 pages" is not a sentence; the count leads and the noun follows it.
    expect(foot).toMatch(/\b1 page\b|\b\d+ pages\b/);
});

test('the page you are on takes the focus, not the way out', async ({ page }) => {
    await openPages(page);

    /*
     * AppModal focuses the first focusable thing it finds, and the close button
     * in the header is now the first — so without being told otherwise the
     * panel opened with the cursor on "leave" and the first arrow key had to
     * travel back into the list.
     */
    const focused = await page.evaluate(() => {
        const active = document.activeElement;
        return {
            isLink: Boolean(active?.classList?.contains('page-overview-modal-link')),
            isCurrent: Boolean(active?.closest('.page-overview-modal-item.is-current')),
        };
    });
    expect(focused.isLink, 'focus did not land in the list').toBe(true);
    expect(focused.isCurrent, 'focus landed on a page you are not on').toBe(true);
});
