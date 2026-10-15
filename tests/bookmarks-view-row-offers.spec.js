// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * The Bookmarks view shows a tag on offer in the row itself: a dashed chip
 * after the row's own tags, which a click (or `a`) adds and × turns down,
 * and a line over the list that counts them with Add all. The same offers
 * as the side panel and the tag view; one per row, since the Tags column is
 * a single short line.
 */

/** Three bookmarks on one site agreeing on a tag, and targets without it. */
async function seedAndOpen(page, { targets = ['Offer target'] } = {}) {
    const N = `${Date.now()}${Math.random().toString(36).slice(2, 7)}`;
    const host = `rowoffer-${N}.example`;
    const tag = `rowoffer${N}`;
    await markWhatsNewSeen(page);
    await page.setViewportSize({ width: 1500, height: 900 });
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.evaluate(async ({ h, t, names }) => {
        const d = window.dashboardInstance;
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        const add = (bookmark) => api('/api/bookmarks/add', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ page: d.currentPageId, allowDuplicate: true, bookmark: { category: '', createdAt: Date.now(), ...bookmark } }),
        });
        for (const slug of ['a', 'b', 'c']) await add({ name: `Agreeing ${slug}`, url: `https://${h}/${slug}`, tags: [t] });
        for (const [i, name] of names.entries()) await add({ name, url: `https://${h}/target-${i}`, tags: [] });
        await d.loadAllBookmarks?.();
        window.TagSuggestLive.changed(d);
        await d.config.openLibraryView();
    }, { h: host, t: tag, names: targets });
    // Only this test's bookmarks, so the count over the list is its own.
    await page.locator('#config-bm-search').fill(host);
    await expect(page.locator('#config-bm-list .config-bm-row')).toHaveCount(3 + targets.length, { timeout: 10_000 });
    return { host, tag };
}

const row = (page, name) => page.locator('#config-bm-list .config-bm-row', { hasText: name }).first();
const tagsOf = (page, url) => page.evaluate((u) => (window.dashboardInstance.allBookmarks || [])
    .find((b) => b.url === u)?.tags || [], url);

test('a row shows its offer as a dashed chip, and the line counts it', async ({ page }) => {
    const { tag } = await seedAndOpen(page);
    const offer = row(page, 'Offer target').locator(`.config-bm-tag--offer[data-bm-offer="${tag}"]`);
    await expect(offer).toBeVisible();
    await expect(offer).toHaveAttribute('title', /your other tags/);
    await expect(page.locator('#config-bm-offers')).toContainText('1 tag suggestion in this list');
    // The rows that already have the tag are offered nothing.
    await expect(row(page, 'Agreeing a').locator('.config-bm-tag--offer')).toHaveCount(0);
});

test('a click adds the tag without opening the row, and Undo offers it again', async ({ page }) => {
    const { host, tag } = await seedAndOpen(page);
    await page.evaluate(() => {
        const cfg = window.dashboardInstance.config;
        const original = cfg.notify.bind(cfg);
        cfg.notify = (message, type, options) => {
            window.__undo = options?.undoCallback || null;
            return original(message, type, options);
        };
    });
    await row(page, 'Offer target').locator('[data-bm-offer-add]').click();
    await expect.poll(() => tagsOf(page, `https://${host}/target-0`), { timeout: 10_000 }).toContain(tag);
    await expect(row(page, 'Offer target').locator('.config-bm-tag--offer')).toHaveCount(0);
    await expect(page.locator('#config-bm-offers')).toBeHidden();
    await expect(row(page, 'Offer target')).not.toHaveClass(/keyboard-selected/);
    expect(await page.evaluate(() => typeof window.__undo)).toBe('function');
    await page.evaluate(() => window.__undo());
    await expect.poll(() => tagsOf(page, `https://${host}/target-0`), { timeout: 10_000 }).not.toContain(tag);
    await expect(row(page, 'Offer target').locator(`.config-bm-tag--offer[data-bm-offer="${tag}"]`)).toBeVisible();
    await expect(page.locator('#config-bm-offers')).toContainText('1 tag suggestion');
});

test('× turns the offer down, in the one refusal list', async ({ page }) => {
    const { host, tag } = await seedAndOpen(page);
    const offer = row(page, 'Offer target').locator('.config-bm-tag--offer');
    await offer.hover();
    await offer.locator('[data-bm-offer-refuse]').click();
    await expect(offer).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => window.dashboardInstance.settings.dismissedTagSuggestions || []))
        .toEqual(expect.arrayContaining([expect.stringContaining(`|${tag}`)]));
    expect(await tagsOf(page, `https://${host}/target-0`)).not.toContain(tag);
});

test('a adds the offer on the row under the cursor', async ({ page }) => {
    const { host, tag } = await seedAndOpen(page);
    await row(page, 'Offer target').locator('.config-bm-opens').click();
    await page.locator('#config-bm-list').focus();
    await page.keyboard.press('a');
    await expect.poll(() => tagsOf(page, `https://${host}/target-0`), { timeout: 10_000 }).toContain(tag);
});

test('Add all takes every offer in the list', async ({ page }) => {
    const { host, tag } = await seedAndOpen(page, { targets: ['Offer one', 'Offer two'] });
    await expect(page.locator('#config-bm-offers')).toContainText('2 tag suggestions in this list');
    await page.locator('#config-bm-offers [data-bm-offers-all]').click();
    await expect.poll(() => tagsOf(page, `https://${host}/target-0`), { timeout: 10_000 }).toContain(tag);
    await expect.poll(() => tagsOf(page, `https://${host}/target-1`), { timeout: 10_000 }).toContain(tag);
    // The offers are gone; the line may stay for "N turned down".
    await expect(page.locator('#config-bm-offers [data-bm-offers-all]')).toHaveCount(0);
});
