// @ts-check
const { test, expect } = require('./fixtures');
const {
    markWhatsNewSeen,
    dismissOnboardingIfPresent,
    dismissBlockingOverlays,
    WRITE_TOKEN,
} = require('./e2e-helpers');

const writeHeaders = { 'X-NextDash-Token': WRITE_TOKEN };

/**
 * Restoring a bookmark whose page was deleted while it sat in the trash.
 *
 * The server refuses with 409 and puts the item back, so nothing is lost — but
 * the panel used to collapse every failure into "Could not complete that
 * action", which the user cannot act on. This is the one failure with an
 * obvious remedy, so it says what happened and what to do.
 */

async function openTrashTab(page) {
    await page.setViewportSize({ width: 1400, height: 900 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => !!window.dashboardInstance?.config, null, { timeout: 20_000 });
    await page.evaluate(() => window.dashboardInstance.config.openConfigView('data-backups'));
    await page.locator('[data-db-tab="trash"]').click();
}

/** Puts one entry in the trash pointing at a page id that does not exist. */
async function seedOrphanTrashEntry(page) {
    const marker = `orphan-${Date.now()}`;
    const orphanPageId = 98765;
    const res = await page.request.post('/api/trash', {
        data: {
            source: 'e2e',
            items: [{
                pageId: orphanPageId,
                index: 0,
                bookmark: { name: marker, url: `https://${marker}.example/`, category: '', tags: [] },
            }],
        },
        headers: writeHeaders,
    });
    expect(res.ok()).toBe(true);
    return marker;
}

async function trashEntries(page) {
    const res = await page.request.get('/api/trash');
    return (await res.json()).items || [];
}

test.describe('restoring onto a page that no longer exists', () => {
    test.beforeEach(async ({ page }) => {
        await page.request.delete('/api/trash', { data: { all: true }, headers: writeHeaders });
    });

    test('the API refuses with 409 and keeps the bookmark in the trash', async ({ page }) => {
        await openTrashTab(page);
        const marker = await seedOrphanTrashEntry(page);
        const entry = (await trashEntries(page)).find((i) => i.bookmark?.name === marker);
        expect(entry).toBeTruthy();

        const res = await page.request.post('/api/trash/restore', {
            data: { id: entry.id },
            headers: writeHeaders,
        });
        expect(res.status()).toBe(409);

        // Still recoverable: a failed restore must not be a second deletion.
        const after = await trashEntries(page);
        expect(after.some((i) => i.bookmark?.name === marker)).toBe(true);
    });

    test('the panel explains the missing page instead of the generic error', async ({ page }) => {
        await openTrashTab(page);
        const marker = await seedOrphanTrashEntry(page);
        await page.evaluate(() => window.dashboardInstance.config.loadTrash());

        const messages = await page.evaluate(async (name) => {
            const cfg = window.dashboardInstance.config;
            const seen = [];
            const original = cfg.notify.bind(cfg);
            cfg.notify = (msg, type) => { seen.push({ msg: String(msg), type }); return original(msg, type); };
            const items = await window.DashboardTrash.list();
            const entry = (items.items || []).find((i) => i.bookmark?.name === name);
            await cfg.handleTrashAction('restore', entry.id);
            return seen;
        }, marker);

        const errors = messages.filter((m) => m.type === 'error');
        expect(errors.length).toBeGreaterThan(0);
        expect(errors[0].msg).toMatch(/page no longer exists/i);
        expect(errors[0].msg).not.toBe('Could not complete that action.');
    });

    test('an ordinary restore failure still gets the generic message', async ({ page }) => {
        await openTrashTab(page);
        const marker = await seedOrphanTrashEntry(page);

        // A 500 carries no actionable cause, so the generic message is right.
        await page.route('**/api/trash/restore', (route) => route.fulfill({
            status: 500,
            contentType: 'text/plain',
            body: 'boom',
        }));

        const messages = await page.evaluate(async (name) => {
            const cfg = window.dashboardInstance.config;
            const seen = [];
            const original = cfg.notify.bind(cfg);
            cfg.notify = (msg, type) => { seen.push({ msg: String(msg), type }); return original(msg, type); };
            const items = await window.DashboardTrash.list();
            const entry = (items.items || []).find((i) => i.bookmark?.name === name);
            await cfg.handleTrashAction('restore', entry.id);
            return seen;
        }, marker);

        const errors = messages.filter((m) => m.type === 'error');
        expect(errors.length).toBeGreaterThan(0);
        expect(errors[0].msg).toBe('Could not complete that action.');
    });

    test('recreating the page makes the restore work', async ({ page }) => {
        await openTrashTab(page);

        // Seed the trash entry against a page id that exists, delete the page,
        // then put it back — the remedy the message tells the user to apply.
        const marker = `regain-${Date.now()}`;
        const pageId = await page.evaluate(async (name) => {
            const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
            const pages = await (await api('/api/pages')).json();
            const nextId = pages.reduce((max, p) => Math.max(max, Number(p.id) || 0), 0) + 1;
            await api('/api/pages', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify([...pages, { id: nextId, name }]),
            });
            return nextId;
        }, marker);

        await page.request.post('/api/trash', {
            data: {
                source: 'e2e',
                items: [{
                    pageId,
                    index: 0,
                    bookmark: { name: marker, url: `https://${marker}.example/`, category: '', tags: [] },
                }],
            },
            headers: writeHeaders,
        });

        // Drop the page while the bookmark sits in the trash. This goes through
        // DELETE /api/pages/{id}, which removes the page's stored bookmarks too —
        // rewriting /api/pages without the entry leaves the data file behind, so
        // a restore would still succeed and prove nothing.
        const dropped = await page.request.delete(`/api/pages/${pageId}`, { headers: writeHeaders });
        expect(dropped.ok()).toBe(true);

        let entry = (await trashEntries(page)).find((i) => i.bookmark?.name === marker);
        const refused = await page.request.post('/api/trash/restore', {
            data: { id: entry.id },
            headers: writeHeaders,
        });
        expect(refused.status()).toBe(409);

        // Recreate the page — the remedy the message tells the user to apply.
        // Writing its (empty) bookmark list is what recreates the storage the
        // restore reads; the /api/pages entry alone only puts the tab back.
        await page.evaluate(async ({ pid, name }) => {
            const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
            const pages = await (await api('/api/pages')).json();
            await api('/api/pages', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify([...pages, { id: pid, name }]),
            });
            await api(`/api/bookmarks?page=${pid}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify([]),
            });
        }, { pid: pageId, name: marker });

        entry = (await trashEntries(page)).find((i) => i.bookmark?.name === marker);
        const ok = await page.request.post('/api/trash/restore', {
            data: { id: entry.id },
            headers: writeHeaders,
        });
        expect(ok.ok()).toBe(true);

        const onPage = await page.evaluate(async (pid) => {
            const res = await fetch(`/api/bookmarks?page=${pid}`);
            return res.ok ? await res.json() : [];
        }, pageId);
        expect(onPage.some((b) => b.name === marker)).toBe(true);

        // Clean up the page this test created.
        await page.request.delete(`/api/pages/${pageId}`, { headers: writeHeaders });
    });
});
