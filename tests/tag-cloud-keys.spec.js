// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * The cloud is for getting somewhere first.
 *
 * Picking a tag used to add it to the filter and leave the cloud open, which
 * made the common case -- one tag, then the bookmarks -- three steps. Now a
 * pick filters on that one tag, closes, and lands on the grid; Shift stacks
 * tags and keeps the cloud open. Typing narrows the cloud to the tags that
 * match, and Escape takes the typing back before it takes the cloud away.
 */

const TAGS = ['qqalpha', 'qqbeta', 'qqgamma'];

async function openDashboard(page) {
    await page.setViewportSize({ width: 1500, height: 950 });
    await markWhatsNewSeen(page);
    await page.addInitScript(() => {
        localStorage.setItem('nextdash:dashboard-tag-filter-bulk-promo-confirmed-v1', '1');
        localStorage.setItem('nextdash:dashboard-tag-cloud-promo-confirmed-v1', '1');
    });
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });
}

test.beforeEach(async ({ page }) => {
    await openDashboard(page);
    await page.evaluate(async (tags) => {
        const d = window.dashboardInstance;
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        const current = await (await api(`/api/bookmarks?page=${d.currentPageId}`)).json();
        const have = new Set(current.flatMap((b) => b.tags || []));
        for (const tag of tags) {
            if (have.has(tag)) continue;
            await api('/api/bookmarks/add', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ page: d.currentPageId, bookmark: { name: `Key ${tag}`, url: `https://${tag}.example.com/`, tags: [tag] } }),
            });
        }
        Object.assign(d.settings, { showTagCloudButton: true, actionBarPosition: 'header', maxHeaderActions: 8 });
        await d.saveSettings?.();
    }, TAGS);
    await openDashboard(page);
    await page.evaluate(() => window.dashboardInstance.setTagFilters([], { animate: false }));
});

const filters = (page) => page.evaluate(() => [...(window.dashboardInstance._tagFilters || [])]);
const cloud = (page) => page.locator('#tag-cloud-modal');
const chip = (page, tag) => page.locator(`#tag-cloud-modal .tag-cloud-word[data-tag="${tag}"]`);
const focusedTag = (page) => page.evaluate(() => document.activeElement?.dataset?.tag || null);

async function openWithKey(page) {
    await page.locator('body').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('/');
    await expect(cloud(page)).toBeVisible();
    await expect(chip(page, 'qqalpha')).toBeVisible();
}

async function typeQuery(page, text) {
    for (const ch of text) await page.keyboard.press(ch);
}

test('Enter picks that one tag, closes, and lands on its view', async ({ page }) => {
    await openWithKey(page);
    await typeQuery(page, 'qqbeta');
    expect(await focusedTag(page)).toBe('qqbeta');
    await page.keyboard.press('Enter');

    await expect(cloud(page)).toBeHidden();
    await expect.poll(() => filters(page)).toEqual(['qqbeta']);
    await expect.poll(() => page.evaluate(() => location.hash)).toBe('#tag/qqbeta');
    await expect.poll(() => page.evaluate(() => Boolean(document.activeElement?.closest?.('#dashboard-layout')))).toBe(true);
});

test('Shift+Enter stacks and keeps the cloud open', async ({ page }) => {
    await openWithKey(page);
    await typeQuery(page, 'qqalpha');
    await page.keyboard.press('Shift+Enter');
    // The pick took the typing with it; the cloud stays for the next tag.
    await expect(cloud(page)).toBeVisible();
    await expect(page.locator('#tag-cloud-modal-query')).toBeHidden();
    await typeQuery(page, 'qqgamma');
    await page.keyboard.press('Shift+Enter');

    await expect(cloud(page)).toBeVisible();
    await expect.poll(() => filters(page)).toEqual(['qqalpha', 'qqgamma']);
});

test('a plain click replaces the filter; clicking the only tag again clears it', async ({ page }) => {
    await openWithKey(page);
    await chip(page, 'qqalpha').click({ modifiers: ['Shift'] });
    await chip(page, 'qqbeta').click({ modifiers: ['Shift'] });
    await expect.poll(() => filters(page)).toEqual(['qqalpha', 'qqbeta']);

    await chip(page, 'qqgamma').click();
    await expect.poll(() => filters(page)).toEqual(['qqgamma']);
    await expect(cloud(page)).toBeHidden();

    // In the tag view / is its search; the cloud is the header button there.
    await page.locator('#tag-cloud-toggle-btn').click();
    await expect(chip(page, 'qqgamma')).toBeVisible();
    await chip(page, 'qqgamma').click();
    await expect.poll(() => filters(page)).toEqual([]);
});

test('typing narrows the cloud; Backspace and Escape take it back', async ({ page }) => {
    await openWithKey(page);
    await typeQuery(page, 'qqg');

    await expect(page.locator('#tag-cloud-modal-query')).toHaveText('"qqg"');
    await expect(chip(page, 'qqgamma')).not.toHaveClass(/is-miss/);
    await expect(chip(page, 'qqalpha')).toHaveClass(/is-miss/);
    expect(await focusedTag(page)).toBe('qqgamma');

    await page.keyboard.press('Backspace');
    await expect(page.locator('#tag-cloud-modal-query')).toHaveText('"qq"');
    await expect(chip(page, 'qqalpha')).not.toHaveClass(/is-miss/);

    await page.keyboard.press('Escape');
    await expect(page.locator('#tag-cloud-modal-query')).toBeHidden();
    await expect(page.locator('#tag-cloud-modal .tag-cloud-word.is-miss')).toHaveCount(0);
    await expect(cloud(page)).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(cloud(page)).toBeHidden();
});

test('arrows step over tags that do not match', async ({ page }) => {
    await openWithKey(page);
    await typeQuery(page, 'qq');
    expect(await focusedTag(page)).toBe('qqalpha');
    // Only the three qq tags match; walking right from the first reaches the
    // others and never lands on a dimmed tag.
    const seen = new Set();
    for (let i = 0; i < 6; i++) {
        await page.keyboard.press('ArrowRight');
        const tag = await focusedTag(page);
        expect(tag?.startsWith('qq'), `landed on ${tag}`).toBe(true);
        seen.add(tag);
    }
    expect([...seen].sort()).toEqual(TAGS);
});

test('arrows walk the cloud in reading order, like a dashboard list', async ({ page }) => {
    await openWithKey(page);
    const order = await page.evaluate(() =>
        [...document.querySelectorAll('#tag-cloud-modal .tag-cloud-word')].map((el) => el.dataset.tag));
    expect(order.length).toBeGreaterThan(3);
    expect(await focusedTag(page)).toBe(order[0]);

    // Down and Right both take the next tag, even where it starts a new row.
    await page.keyboard.press('ArrowDown');
    expect(await focusedTag(page)).toBe(order[1]);
    await page.keyboard.press('ArrowRight');
    expect(await focusedTag(page)).toBe(order[2]);
    await page.keyboard.press('ArrowUp');
    expect(await focusedTag(page)).toBe(order[1]);
    await page.keyboard.press('ArrowLeft');
    expect(await focusedTag(page)).toBe(order[0]);

    // Off either end it wraps round.
    await page.keyboard.press('ArrowUp');
    expect(await focusedTag(page)).toBe(order[order.length - 1]);
    await page.keyboard.press('ArrowDown');
    expect(await focusedTag(page)).toBe(order[0]);
});

test('letters typed into a field do not reach the cloud', async ({ page }) => {
    await openWithKey(page);
    await page.evaluate(() => {
        const input = document.createElement('input');
        input.id = 'kbd-probe';
        document.getElementById('tag-cloud-modal').appendChild(input);
        input.focus();
    });
    await typeQuery(page, 'qqa');
    await expect(page.locator('#kbd-probe')).toHaveValue('qqa');
    await expect(page.locator('#tag-cloud-modal-query')).toBeHidden();
    await expect(page.locator('#tag-cloud-modal .tag-cloud-word.is-miss')).toHaveCount(0);
});
