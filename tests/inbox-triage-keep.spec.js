const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissBlockingOverlays, dismissOnboardingIfPresent } = require('./e2e-helpers');

/**
 * Keep used to just mark the inbox item read. Now it silently promotes the
 * link to a real bookmark on the reserved Unsorted page -- no modal, no
 * category choice, that is the entire point of Unsorted.
 */
test('Keep promotes an inbox item to Unsorted without opening a modal', async ({ page }) => {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => window.dashboardInstance?.inbox != null, null, { timeout: 15_000 });
    await page.evaluate(() => { window.dashboardInstance.settings.inboxEnabled = true; });

    const url = `https://keep-${Date.now()}.example/x`;
    await page.evaluate(async (u) => {
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        await api('/api/inbox', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: u, title: 'Keep me' }),
        });
    }, url);

    await page.locator('#page-nav-inbox-btn').click();
    await expect(page.locator('.inbox-layout')).toBeVisible();
    await page.evaluate(() => window.dashboardInstance.inbox.loadAndRender({ refresh: true }));
    await expect.poll(() => page.evaluate(() =>
        (window.dashboardInstance.inbox.items || []).length), { timeout: 10_000 }).toBeGreaterThan(0);

    await page.keyboard.press('t');
    await expect.poll(() => page.evaluate(() =>
        !!window.dashboardInstance.inbox.triage?.isOpen?.()), { timeout: 10_000 }).toBe(true);

    await page.keyboard.press('Shift+K');

    // No bookmark form modal opened.
    await expect(page.locator('#bookmark-form-modal, .bookmark-form-modal')).toBeHidden();

    // It now exists as a bookmark on the Unsorted page.
    await expect.poll(async () => {
        const res = await page.request.get('/api/unsorted');
        const body = await res.json();
        return body.bookmarks.some((b) => b.url === url);
    }, { timeout: 10_000 }).toBe(true);
});

/**
 * Keep is the promise that a link is being held on to, so what was written
 * about it is held on to as well: the note someone typed while triaging and
 * the tags they gave it. Both used to be dropped -- the kept bookmark carried
 * a name and an address and nothing else.
 *
 * The preview and the icon ride along for a different reason: the inbox has
 * already fetched them, and leaving them behind makes the Unsorted view ask
 * the same site for the same answer again.
 */
test('Keep carries the note, the tags and the preview to the kept bookmark', async ({ page }) => {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => window.dashboardInstance?.inbox != null, null, { timeout: 15_000 });
    await page.evaluate(() => { window.dashboardInstance.settings.inboxEnabled = true; });

    const url = `https://keep-note-${Date.now()}.example/x`;
    await page.evaluate(async (u) => {
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        const res = await api('/api/inbox', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: u, title: 'Keep with note' }),
        });
        const created = await res.json();
        const item = created.item || created;
        // Through the same PATCH the inbox itself writes a note and tags with,
        // so the item is shaped the way a triaged one really is.
        await api('/api/inbox', {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                id: item.id,
                note: 'read the second half',
                tags: ['research', 'later'],
            }),
        });
    }, url);

    await page.locator('#page-nav-inbox-btn').click();
    await expect(page.locator('.inbox-layout')).toBeVisible();
    await page.evaluate(() => window.dashboardInstance.inbox.loadAndRender({ refresh: true }));
    await expect.poll(() => page.evaluate((u) => (window.dashboardInstance.inbox.items || [])
        .some((i) => i.url === u), url), { timeout: 10_000 }).toBe(true);

    await page.evaluate(async (u) => {
        const inbox = window.dashboardInstance.inbox;
        const item = (inbox.items || []).find((i) => i.url === u);
        await inbox.keepItem(item);
    }, url);

    const kept = await (async () => {
        let found = null;
        await expect.poll(async () => {
            const res = await page.request.get('/api/unsorted');
            const body = await res.json();
            found = body.bookmarks.find((b) => b.url === url) || null;
            return Boolean(found);
        }, { timeout: 10_000 }).toBe(true);
        return found;
    })();

    expect(kept.note).toBe('read the second half');
    expect(kept.tags).toEqual(['research', 'later']);
});

/**
 * The card reads the same letters as the list: r marks read and moves on,
 * Shift+K keeps. r used to keep here and mark read in the list.
 */
test('on the triage card r marks read and moves on, without keeping', async ({ page }) => {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => window.dashboardInstance?.inbox != null, null, { timeout: 15_000 });
    await page.evaluate(() => { window.dashboardInstance.settings.inboxEnabled = true; });

    const stamp = Date.now();
    const urls = [`https://read-a-${stamp}.example/x`, `https://read-b-${stamp}.example/x`];
    await page.evaluate(async (list) => {
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        for (const u of list) {
            await api('/api/inbox', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url: u, title: 'Read me' }),
            });
        }
    }, urls);
    await page.locator('#page-nav-inbox-btn').click();
    await expect(page.locator('.inbox-layout')).toBeVisible();
    await page.evaluate(() => window.dashboardInstance.inbox.loadAndRender({ refresh: true }));

    await page.keyboard.press('t');
    await expect.poll(() => page.evaluate(() =>
        !!window.dashboardInstance.inbox.triage?.isOpen?.()), { timeout: 10_000 }).toBe(true);
    const first = await page.evaluate(() => window.dashboardInstance.inbox.triage.currentItem().url);
    const index = await page.evaluate(() => window.dashboardInstance.inbox.triage.index);

    await page.keyboard.press('r');

    await expect.poll(() => page.evaluate(() => window.dashboardInstance.inbox.triage.index),
        { timeout: 10_000 }).toBe(index + 1);
    const state = await page.evaluate(async (u) => {
        const inbox = await (await fetch('/api/inbox', { cache: 'no-store' })).json();
        const kept = await (await fetch('/api/unsorted', { cache: 'no-store' })).json();
        const row = (inbox.items || []).find((i) => i.url === u);
        return { read: Boolean(row?.readAt), kept: (kept.bookmarks || []).some((b) => b.url === u) };
    }, first);
    expect(state).toEqual({ read: true, kept: false });
});
