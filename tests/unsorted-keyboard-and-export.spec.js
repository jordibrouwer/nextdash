// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * Working through the kept list without the mouse, and taking it elsewhere.
 *
 * The queue beside it has carried a legend and a full set of keys since it was
 * built; the kept list had the grid's arrows and nothing else -- x ticked in
 * the grid's own selection layer, which this list does not use, so the one key
 * a bulk list needs did nothing here. And a list you cannot export is a list
 * you cannot take to whatever you file with.
 */

const KEPT = [
    { name: 'Kb One', url: 'https://kb.example/one', createdAt: 5000 },
    { name: 'Kb Two', url: 'https://kb.example/two', createdAt: 4000 },
];

async function openKept(page, kept = KEPT) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });
    await page.evaluate(async (rows) => {
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        const current = await (await fetch('/api/unsorted', { cache: 'no-store' })).json();
        for (const bookmark of current.bookmarks || []) {
            await api('/api/bookmarks', {
                method: 'DELETE', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ page: 999999, bookmark }),
            });
        }
        for (const bookmark of rows) {
            await api('/api/bookmarks/add', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ page: 999999, bookmark: { ...bookmark, category: '' } }),
            });
        }
        await api('/api/settings', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ inboxEnabled: true, unsortedEnabled: true, unsortedSort: 'added-desc', unsortedGroup: 'none' }),
        });
        Object.assign(window.dashboardInstance.settings, {
            inboxEnabled: true, unsortedEnabled: true, unsortedSort: 'added-desc', unsortedGroup: 'none',
        });
        await window.dashboardInstance.loadAllBookmarks?.();
    }, kept);
    await page.evaluate(() => window.dashboardInstance.inbox.openInboxView({ tab: 'kept' }));
    await expect(page.locator('.bookmark-link[data-unsorted-key]').first()).toBeVisible();
}

test('x ticks the row the cursor is on, in this list own selection', async ({ page }) => {
    await openKept(page);

    // Through the real entry point: an arrow starts grid navigation, the way
    // a reader reaches the first row.
    // The list's keys are wired a beat after its rows appear; an arrow in
    // that beat is lost, so it is pressed again until the cursor stands.
    await expect(async () => {
        if (await page.locator('.bookmark-link.keyboard-selected, .bookmark-link.is-kbd-selected').count() === 0) {
            await page.keyboard.press('ArrowDown');
        }
        await expect(page.locator('.bookmark-link.keyboard-selected, .bookmark-link.is-kbd-selected')).toHaveCount(1, { timeout: 1000 });
    }).toPass({ timeout: 10_000 });
    await page.keyboard.press('x');

    await expect(page.locator('.unsorted-select-toolbar .multi-select-count')).toHaveText('1 selected');
    await expect(page.locator('.bookmark-link.is-multi-selected')).toHaveCount(1);
    // The grid's own selection layer stays out of it: two layers holding the
    // same row is how a bulk action acts on rows nobody ticked.
    expect(await page.evaluate(() =>
        window.dashboardInstance.multiSelect?.isActive?.() === true)).toBe(false);
});

test('the kept list carries a legend of the keys that work in it', async ({ page }) => {
    await openKept(page);

    const legend = page.locator('.unsorted-view .inbox-legend');
    await expect(legend).toBeVisible();
    await expect(legend).toContainText('x');
    await expect(legend).toContainText('Esc');
});

test('Open in tabs opens every ticked row', async ({ page }) => {
    await openKept(page);
    await page.locator('.unsorted-row-check-input').nth(0).check();
    await page.locator('.unsorted-row-check-input').nth(1).check();

    const opened = [];
    page.context().on('page', (p) => opened.push(p));
    await page.locator('.unsorted-select-toolbar .multi-select-btn', { hasText: 'Open' }).click();

    await expect.poll(() => opened.length, { timeout: 10_000 }).toBe(2);
    for (const tab of opened) await tab.close();
});

test('Export writes the ticked rows as CSV', async ({ page }) => {
    await openKept(page);
    await page.locator('.unsorted-row-check-input').nth(0).check();

    const download = page.waitForEvent('download', { timeout: 15_000 });
    await page.locator('.unsorted-select-toolbar .multi-select-btn', { hasText: 'Export' }).click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/\.csv$/);

    const stream = await file.createReadStream();
    const text = await new Promise((resolve, reject) => {
        let out = '';
        stream.on('data', (chunk) => { out += chunk; });
        stream.on('end', () => resolve(out));
        stream.on('error', reject);
    });
    expect(text).toContain('https://kb.example/');
    expect(text.split('\r\n').filter(Boolean).length).toBe(2);
});

/**
 * Parking a kept link.
 *
 * Kept had two ways out: file it, or put it back in the queue where it will be
 * read again tomorrow and kept again tomorrow. A link that is worth holding but
 * cannot be placed yet needs the queue's own answer -- come back in a month --
 * and snooze is that answer, already built for the rows next door.
 */
test('a kept row can be snoozed back into the queue', async ({ page }) => {
    await openKept(page, [{ name: 'Park Me', url: `https://park.example/${Date.now()}`, createdAt: 5000 }]);
    const url = await page.evaluate(() => window.dashboardInstance.unsorted._bookmarks[0].url);

    await page.locator('.unsorted-row-check-input').first().check();
    await page.locator('.unsorted-select-toolbar .multi-select-btn', { hasText: 'Snooze' }).click();

    const menu = page.locator('.inbox-snooze-menu');
    await expect(menu).toBeVisible();
    await menu.locator('[data-snooze-until]').first().click();

    // Off the kept list, in the queue, asleep.
    await expect.poll(async () => page.evaluate(async (u) => {
        const data = await (await fetch('/api/unsorted', { cache: 'no-store' })).json();
        return (data.bookmarks || []).some((b) => b.url === u);
    }, url), { timeout: 20_000 }).toBe(false);
    await expect.poll(async () => page.evaluate(async (u) => {
        const body = await (await fetch('/api/inbox', { cache: 'no-store' })).json();
        const rows = body.items || body || [];
        return Number(rows.find((item) => item.url === u)?.snoozedUntil || 0);
    }, url), { timeout: 20_000 }).toBeGreaterThan(Date.now());
});

/**
 * b sends the kept link under the cursor back to the queue.
 *
 * The run over the list had it as B on the card; the list itself had no key
 * for it at all, so the way back was a right-click. Same letter in both
 * places, shown in the row menu and the legend.
 */
test('b sends the row under the cursor back to the inbox', async ({ page }) => {
    await openKept(page, [{ name: 'Key Back', url: `https://key-back.example/${Date.now()}`, createdAt: 5000 }]);
    const url = await page.evaluate(() => window.dashboardInstance.unsorted._bookmarks[0].url);

    await expect(page.locator('.unsorted-view .inbox-legend')).toContainText('back to the inbox');

    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('b');

    await expect.poll(async () => page.evaluate(async (u) => {
        const body = await (await fetch('/api/inbox', { cache: 'no-store' })).json();
        return (body.items || body || []).some((item) => item.url === u);
    }, url), { timeout: 15_000 }).toBe(true);
    await expect.poll(async () => page.evaluate(async (u) => {
        const data = await (await fetch('/api/unsorted', { cache: 'no-store' })).json();
        return (data.bookmarks || []).some((b) => b.url === u);
    }, url), { timeout: 15_000 }).toBe(false);
});
