const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissBlockingOverlays, dismissOnboardingIfPresent } = require('./e2e-helpers');

/**
 * One class of bug, found across the config view: a read that fails degrades to
 * an empty list, which the next write then posts back as the complete state.
 * Failure and emptiness were the same value, so a server blip during an edit
 * destroyed the real data and reported success.
 */

async function openConfig(page) {
    await markWhatsNewSeen(page);
    await page.goto('/#config');
    await page.waitForSelector('#dashboard-layout', { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => !!window.dashboardInstance?.config, null, { timeout: 20_000 });
}

const catIds = (page) => page.evaluate(async () => {
    const r = await fetch('/api/categories?page=1');
    return (await r.json()).map((c) => c.id);
});

test.describe('a failed read must never become a write', () => {
    // B1. The one with teeth: this wiped every category on the page.
    test('ensureCategoryOnPage leaves the page alone when the read fails', async ({ page }) => {
        await openConfig(page);
        const before = await catIds(page);
        expect(before.length).toBeGreaterThan(1);

        // Only the GET fails — exactly a server blip mid-edit.
        await page.route('**/api/categories**', (route) => (
            route.request().method() === 'GET'
                ? route.fulfill({ status: 500, body: 'boom' })
                : route.continue()
        ));

        const outcome = await page.evaluate(async () => {
            try {
                await window.dashboardInstance.config.ensureCategoryOnPage(1, 'zzz-probe');
                return 'returned';
            } catch (e) {
                return `threw: ${e.message}`;
            }
        });
        await page.unroute('**/api/categories**');

        // It must give up loudly rather than post a one-item list.
        expect(outcome).toMatch(/^threw:/);

        // What matters is that nothing was destroyed: the categories that were
        // there are still there, and the probe id was never written. Asserted
        // as a superset rather than an exact match, because other specs in a
        // parallel run add categories to this page while this one runs.
        const after = await catIds(page);
        expect(after).toEqual(expect.arrayContaining(before));
        expect(after).not.toContain('zzz-probe');
    });

    // B6. Four loaders shared the same shape. A failed load must not render as
    // "you have none", because the next edit posts that emptiness back.
    for (const [label, probe] of [
        ['finders', {
            route: '**/api/finders**',
            load: () => window.dashboardInstance.config.loadFinders(),
            read: () => window.dashboardInstance.config._findersLoadFailed,
        }],
        ['categories', {
            route: '**/api/categories**',
            load: () => window.dashboardInstance.config.loadCategoriesEditor(1),
            read: () => window.dashboardInstance.config._categoriesLoadFailed,
        }],
    ]) {
        test(`${label}: a failed load is flagged, not shown as empty`, async ({ page }) => {
            await openConfig(page);
            await page.route(probe.route, (route) => (
                route.request().method() === 'GET'
                    ? route.fulfill({ status: 500, body: 'boom' })
                    : route.continue()
            ));
            await page.evaluate(probe.load);
            const failed = await page.evaluate(probe.read);
            await page.unroute(probe.route);
            expect(failed).toBe(true);
        });
    }

    // B6, second half: the flag has to actually block the write.
    test('saving finders is refused while the last load failed', async ({ page }) => {
        await openConfig(page);
        await page.route('**/api/finders**', (route) => (
            route.request().method() === 'GET'
                ? route.fulfill({ status: 500, body: 'boom' })
                : route.continue()
        ));
        await page.evaluate(() => window.dashboardInstance.config.loadFinders());

        let posted = false;
        await page.route('**/api/finders**', (route) => {
            if (route.request().method() === 'POST') posted = true;
            return route.request().method() === 'GET'
                ? route.fulfill({ status: 500, body: 'boom' })
                : route.continue();
        });
        await page.evaluate(() => window.dashboardInstance.config.saveFinders());
        await page.unroute('**/api/finders**');

        expect(posted).toBe(false);
    });
});

test.describe('an action that failed must not report success', () => {
    // B5. saveCategories swallowed the error and returned undefined either way,
    // so a 409 still produced a trash entry and a "Category deleted." toast.
    test('saveCategories reports whether it saved', async ({ page }) => {
        await openConfig(page);

        await page.route('**/api/categories**', (route) => (
            route.request().method() === 'POST'
                ? route.fulfill({ status: 409, body: 'still referenced' })
                : route.continue()
        ));
        const failed = await page.evaluate(async () => {
            const c = window.dashboardInstance.config;
            c._catPageId = 1;
            c._categories = [{ id: 'x', name: 'X', sortMode: 'order' }];
            return c.saveCategories();
        });
        await page.unroute('**/api/categories**');
        expect(failed).toBe(false);

        // And true when it did. Saved back verbatim: an empty list would be a
        // 409 of its own, since bookmarks on page 1 still reference categories.
        const ok = await page.evaluate(async () => {
            const c = window.dashboardInstance.config;
            const current = await (await fetch('/api/categories?page=1')).json();
            c._catPageId = 1;
            c._categories = current;
            c._categoriesLoadFailed = false;
            return c.saveCategories();
        });
        expect(ok).toBe(true);
    });

    // B7. The page id was read at write time, so switching pages mid-save sent
    // page 1's categories to page 2.
    test('saveCategories writes to the page the edit belonged to', async ({ page }) => {
        await openConfig(page);

        const urls = [];
        await page.route('**/api/categories**', (route) => {
            const req = route.request();
            if (req.method() === 'POST') {
                urls.push(req.url());
                return route.fulfill({ status: 200, body: '{"status":"success"}' });
            }
            return route.continue();
        });

        await page.evaluate(async () => {
            const c = window.dashboardInstance.config;
            c._catPageId = 1;
            c._categories = [{ id: 'a', name: 'A', sortMode: 'order' }];
            const inFlight = c.saveCategories();
            c._catPageId = 2;          // user switches page while it is in flight
            await inFlight;
        });
        await page.unroute('**/api/categories**');

        expect(urls).toHaveLength(1);
        expect(urls[0]).toContain('page=1');
    });
});

test.describe('actions that could not work at all', () => {
    // B2. The config button posted a body-less request to a per-page endpoint
    // that decodes the body first, so it answered 400 every time.
    test('refresh all favicons does not 400', async ({ page }) => {
        await openConfig(page);

        const codes = [];
        page.on('response', (r) => {
            if (r.url().includes('prefetch-icons')) codes.push(r.status());
        });

        await page.evaluate(() => {
            const c = window.dashboardInstance.config;
            c.confirmAction = async () => true;   // skip the dialog, not the work
            return c.refreshAllFavicons();
        });

        expect(codes.length).toBeGreaterThan(0);
        expect(codes).not.toContain(400);
    });

    // B3/B4. The server drops a collection with no name, or whose only rule has
    // no value — the exact shape "Add collection" creates — and used to do it
    // behind a plain success.
    test('a dropped collection is named in the response', async ({ page }) => {
        await openConfig(page);

        const body = await page.evaluate(async () => {
            const current = await (await fetch('/api/settings')).json();
            const res = await window.dashboardInstance.config.writeFetch('/api/settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ...current,
                    collections: [{ id: 'probe', name: 'Probe', rules: [{ field: 'tag', operator: 'includes', value: '' }] }],
                }),
            });
            return res.json();
        });

        expect(body.status).toBe('success');
        expect(body.droppedCollections).toEqual(['Probe']);

        // Reported to the user on the way out of the tab, rather than on every
        // keystroke — a half-filled row is the normal state while typing.
        const message = await page.evaluate(() => {
            const c = window.dashboardInstance.config;
            let said = '';
            c.notify = (msg) => { said = msg; };
            window.dashboardInstance._droppedCollections = ['Probe'];
            c.reportDroppedCollections();
            return said;
        });
        expect(message).toContain('Probe');
    });

    // B8. The listener, the pending-marker drain and their tests all existed;
    // nothing ever published, so a second tab never refreshed.
    test('a config write publishes to the other tabs', async ({ page }) => {
        await openConfig(page);

        const published = await page.evaluate(() => {
            const d = window.dashboardInstance;
            const seen = [];
            const realSet = localStorage.setItem.bind(localStorage);
            localStorage.setItem = (k, v) => { seen.push(k); return realSet(k, v); };
            d.configSync.publishConfigSync('structure');
            d.configSync.publishConfigSync('settings');
            localStorage.setItem = realSet;
            return {
                keys: seen,
                structure: d.structureSyncEventKey,
                settings: d.settingsSyncEventKey,
                pending: sessionStorage.getItem(d.pendingStructureSyncKey),
            };
        });

        expect(published.keys).toContain(published.structure);
        expect(published.keys).toContain(published.settings);
        // The marker a hidden tab drains when it comes back.
        expect(JSON.parse(published.pending).timestamp).toBeGreaterThan(0);
    });
});
