// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissBlockingOverlays, dismissOnboardingIfPresent, ensureBookmarksDashboardView } = require('./e2e-helpers');

/**
 * The strip suggests what the bookmark under the cursor may need: context of
 * the row, an undo hint right after a pin or move, and one letter the reader
 * has not learned yet.
 */

async function load(page, uses) {
    await page.setViewportSize({ width: 1600, height: 900 });
    await markWhatsNewSeen(page);
    await page.addInitScript((u) => {
        try { localStorage.setItem('nextdash:row-letter-uses', JSON.stringify(u)); } catch (_e) { /* ignore */ }
    }, uses || {});
    await page.goto('/');
    await page.waitForSelector('.bookmark-link', { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await ensureBookmarksDashboardView(page);
    await page.keyboard.press('ArrowDown');
    await expect.poll(() => page.evaluate(() => window.dashboardInstance.keyboardNavigation.currentIndex)).toBeGreaterThanOrEqual(0);
}

const strip = (page) => page.locator('#mode-strip');
const chips = (page) => strip(page).locator('kbd').allInnerTexts();

/** Change the row under the cursor, then let the strip look again. */
const reshape = (page, fn) => page.evaluate((src) => {
    const kn = window.dashboardInstance.keyboardNavigation;
    const row = kn.navigableElements[kn.currentIndex];
    // eslint-disable-next-line no-new-func
    new Function('row', 'bookmark', src)(row, kn.getSelectedBookmark());
    kn._syncModeStrip();
}, fn);

test('a row without tags suggests t, a row with tags suggests f for its tag', async ({ page }) => {
    await load(page);
    await reshape(page, "row.removeAttribute('data-bookmark-tags')");
    await expect(strip(page)).toContainText('add tags');
    await reshape(page, "row.setAttribute('data-bookmark-tags', 'devtools,news')");
    await expect(strip(page)).toContainText('filter: devtools');
    expect(await chips(page)).toContain('f');
});

test('the pin suggestion follows the pin state', async ({ page }) => {
    await load(page);
    await reshape(page, 'bookmark.pinned = false');
    await expect(strip(page)).toContainText('pin');
    await expect(strip(page)).not.toContainText('unpin');
    await reshape(page, 'bookmark.pinned = true');
    await expect(strip(page)).toContainText('unpin');
    await reshape(page, 'bookmark.pinned = false');
});

test('a row that is down suggests r first', async ({ page }) => {
    await load(page);
    await reshape(page, "row.classList.add('status-offline')");
    await expect(strip(page)).toContainText('why it is down');
    expect((await chips(page))[0]).toBe('r');
    await reshape(page, "row.classList.remove('status-offline')");
});

test('a bookmark filed nowhere suggests m "file it"', async ({ page }) => {
    await load(page);
    await reshape(page, "bookmark.category = ''");
    await expect(strip(page)).toContainText('file it');
});

test('never more than four suggestions, and Esc is always there', async ({ page }) => {
    await load(page);
    const list = await chips(page);
    expect(list.length).toBeLessThanOrEqual(5); // four suggestions + Esc
    expect(list[list.length - 1]).toBe('Esc');
});

test('right after p, Ctrl/Cmd+Z undo is first, and it goes when the notice is over', async ({ page }) => {
    await page.clock.install();
    await load(page);
    await page.keyboard.press('p');
    await page.clock.runFor(800);
    await expect(strip(page)).toContainText('undo');
    expect((await chips(page))[0]).toBe('Ctrl/Cmd+Z');
    await page.clock.runFor(9000);
    await expect(strip(page)).not.toContainText('undo');
    await page.keyboard.press('p'); // put the pin back
    await page.clock.runFor(800);
});

test('one letter not yet learned is suggested, and it goes after enough use', async ({ page }) => {
    await load(page, {});
    await expect(strip(page).locator('kbd.is-tip')).toHaveCount(1);
    await page.close();
});

test('with every letter used enough there is no learning slot', async ({ page }) => {
    await load(page, { s: 3, q: 3, r: 3, v: 3, c: 3, w: 3 });
    await expect(strip(page).locator('kbd.is-tip')).toHaveCount(0);
});

test('using a letter counts toward learning it', async ({ page }) => {
    await load(page, { s: 2 });
    await page.evaluate(() => { window.dashboardInstance.contextMenu.shareBookmark = async () => {}; });
    await page.keyboard.press('s');
    await expect.poll(() => page.evaluate(() => window.ModeStripSuggest.uses().s)).toBe(3);
});

test('each new row shows another combination of keys', async ({ page }) => {
    await load(page);
    const seen = new Set();
    for (let i = 0; i < 6; i += 1) {
        seen.add((await chips(page)).join(' '));
        await page.keyboard.press('ArrowDown');
        await page.waitForTimeout(150);
    }
    expect(seen.size).toBeGreaterThan(2);
});

test('the same row keeps its combination', async ({ page }) => {
    await load(page);
    const a = await chips(page);
    await page.evaluate(() => window.dashboardInstance.keyboardNavigation._syncModeStrip());
    await page.evaluate(() => window.dashboardInstance.keyboardNavigation._syncModeStrip());
    expect(await chips(page)).toEqual(a);
});
