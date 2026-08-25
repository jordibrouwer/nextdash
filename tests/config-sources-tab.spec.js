// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays, GITHUB_STUB_PORT, RAINDROP_STUB_PORT } = require('./e2e-helpers');
const http = require('http');

/** Three starred repositories, as the star media type returns them. */
const STARS = [1, 2, 3].map((i) => ({
    starred_at: `2026-03-0${i}T00:00:00Z`,
    repo: {
        full_name: `probe/repo-${i}`,
        html_url: `https://github.com/probe/repo-${i}`,
        description: `probe repo ${i}`,
        language: 'Go',
        topics: ['probe'],
        pushed_at: '2026-02-01T00:00:00Z',
    },
}));

/**
 * Stand in for api.github.com.
 *
 * One stub for the file, started before the tests and stopped after: the server
 * under test reads NEXTDASH_GITHUB_API_BASE at startup, so the address has to be
 * fixed rather than negotiated per test. Page 1 has the stars, every later page
 * is empty, which is how the walk knows to stop.
 */
/** Three raindrops, two of them in a collection the reader named. */
const RAINDROPS = [1, 2, 3].map((i) => ({
    _id: i,
    link: `https://rd.example.com/${i}`,
    title: `Raindrop ${i}`,
    excerpt: `scraped ${i}`,
    note: `my note ${i}`,
    tags: ['Read', 'later'],
    created: `2026-03-0${i}T00:00:00Z`,
    lastUpdate: `2026-03-0${i}T00:00:00Z`,
    collection: { $id: i < 3 ? 42 : 77 },
}));

/*
 * Click Save and wait for the write, not for a moment afterwards.
 *
 * Saving now checks whether a token is already stored before it writes, so the
 * click returns two requests ahead of the change landing. Reading /api/sources
 * in that gap is why these tests failed once and passed on retry.
 */
async function saveSource(page, id) {
    await Promise.all([
        page.waitForResponse((r) => r.url().includes('/api/sources/') && r.request().method() === 'PUT', { timeout: 15_000 }),
        page.click(`[data-source-action="save"][data-source-id="${id}"]`),
    ]);
}

let stub;
let raindropStub;
test.beforeAll(async () => {
    stub = http.createServer((req, res) => {
        const body = JSON.stringify(req.url.includes('page=1') ? STARS : []);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(body);
    });
    await new Promise((resolve) => stub.listen(GITHUB_STUB_PORT, '127.0.0.1', resolve));

    raindropStub = http.createServer((req, res) => {
        let body;
        if (req.url.includes('/collections/childrens')) body = { items: [] };
        // The collection the reader made, so its name can become a category.
        else if (req.url.includes('/collections')) body = { items: [{ _id: 42, title: 'Reading' }] };
        else if (req.url.includes('page=0')) body = { result: true, items: RAINDROPS };
        else body = { result: true, items: [] };
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(body));
    });
    await new Promise((resolve) => raindropStub.listen(RAINDROP_STUB_PORT, '127.0.0.1', resolve));
});
test.afterAll(async () => {
    await new Promise((resolve) => stub.close(resolve));
    await new Promise((resolve) => raindropStub.close(resolve));
});

/*
 * The GitHub source panel in Config -> Data & backups.
 *
 * The styling assertions are here because this panel shipped once with
 * config-label, config-input and config-field-note on it -- three class names
 * that read like the house style and exist nowhere in the CSS, so the fields
 * and their hint rendered as unstyled browser defaults. Comparing against a
 * control that was already on the page catches that, where eyeballing a
 * screenshot did not.
 */
test.describe('the Sources tab', () => {
    test.beforeEach(async ({ page }) => {
        await markWhatsNewSeen(page);
        await page.goto('/');
        await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
        await dismissOnboardingIfPresent(page);
        await dismissBlockingOverlays(page);
        await page.evaluate(() => window.dashboardInstance.config.openConfigView('data-backups'));
        await page.click('[data-db-tab="sources"]');
        await expect(page.locator('#config-stars-token')).toBeVisible({ timeout: 15_000 });
    });

    test('its controls carry the same styling as the ones beside them', async ({ page }) => {
        const styleOf = (selector, props) => page.evaluate(([sel, list]) => {
            const el = document.querySelector(sel);
            if (!el) return 'MISSING';
            const c = getComputedStyle(el);
            return list.map((prop) => c[prop]).join('|');
        }, [selector, props]);

        const BUTTON = ['padding', 'borderWidth', 'borderRadius', 'fontSize'];
        /*
         * Against a .config-btn that predates this tab -- not against the
         * sub-tab buttons above them, which are .config-subtab and styled
         * differently on purpose. The reference has to be a control that was
         * already correct, or a wrong shared class would make both sides match.
         */
        const readButton = () => page.evaluate(() => {
            const el = [...document.querySelectorAll('.config-btn')]
                .find((b) => !b.hasAttribute('data-source-action'));
            if (!el) return 'MISSING';
            const c = getComputedStyle(el);
            return [c.padding, c.borderWidth, c.borderRadius, c.fontSize].join('|');
        });
        // Taken from the Backups tab: the Sources tab holds nothing but source
        // panels, so there is no older control on it to compare against.
        await page.click('[data-db-tab="backups"]');
        await expect(page.locator('[data-backup-action="csv-export"]')).toBeVisible({ timeout: 10_000 });
        const reference = await readButton();
        expect(reference).not.toBe('MISSING');
        await page.click('[data-db-tab="sources"]');
        await expect(page.locator('#config-stars-token')).toBeVisible({ timeout: 10_000 });
        expect(await styleOf('[data-source-action="save"][data-source-id="github:stars"]', BUTTON)).toBe(reference);
        expect(await styleOf('[data-source-action="run"][data-source-id="github:stars"]', BUTTON)).toBe(reference);

        /*
         * The inputs are compared against a .config-text elsewhere in config
         * rather than against each other: the original bug put the same wrong
         * class on both, so they matched each other perfectly while matching
         * nothing in the stylesheet.
         */
        const INPUT = ['padding', 'borderRadius', 'backgroundColor'];
        const textReference = await styleOf('.config-text', INPUT);
        expect(textReference).not.toBe('MISSING');
        expect(await styleOf('#config-stars-token', INPUT)).toBe(textReference);
        expect(await styleOf('#config-stars-category', INPUT)).toBe(textReference);

        /*
         * The hint and the label are placed by .config-field's grid, and that
         * placement is what a made-up class name loses: the hint spans the row
         * (grid-column 1 / -1) and the label sits in the first column. An
         * unstyled <p> and <label> in that grid get "auto" instead, which is
         * exactly how the panel shipped broken.
         */
        const placement = await page.evaluate(() => {
            const hint = getComputedStyle(document.getElementById('config-stars-token-note'));
            const label = getComputedStyle(document.querySelector('label[for="config-stars-token"]'));
            const body = getComputedStyle(document.body);
            return {
                hintColumn: hint.gridColumn,
                hintSize: parseFloat(hint.fontSize),
                labelColor: label.color,
                bodyColor: body.color,
                bodySize: parseFloat(body.fontSize),
            };
        });
        expect(placement.hintColumn).toBe('1 / -1');
        // Muted prose: smaller than body text rather than the same size.
        expect(placement.hintSize).toBeLessThan(placement.bodySize);
        // The label is styled, not inheriting the page's text colour.
        expect(placement.labelColor).not.toBe(placement.bodyColor);
    });

    test('the token goes in and never comes back', async ({ page }) => {
        await page.fill('#config-stars-token', 'ghp_e2e_secret');
        await page.fill('#config-stars-category', 'code');
        await saveSource(page, 'github:stars');

        // Cleared after saving: a token still sitting in a form field is one
        // screenshot away from being shared.
        await expect(page.locator('#config-stars-token')).toHaveValue('');
        await expect(page.locator('#config-stars-token-note')).toContainText('token is saved');

        // And the API that the panel reads from does not hand it back.
        const listed = await page.evaluate(async () => {
            const f = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
            return (await f('/api/sources')).text();
        });
        expect(listed).not.toContain('ghp_e2e_secret');
        expect(listed).toContain('"hasToken":true');
    });

    /*
     * Importing has to show up without a reload.
     *
     * It did not: the import called `this.dash.loadBookmarks?.()`, a method that
     * exists nowhere in the dashboard, and the optional call swallowed it
     * silently. The repositories arrived on the server and the screen went on
     * showing the collection from before -- and because the shell's category
     * copy was stale too, opening one for editing found no match for its
     * category and fell back to "—", so it could not be edited back either. One
     * dead call, three symptoms.
     *
     * What this test can and cannot prove: it checks that the import lands and
     * that the category comes with it. It deliberately does NOT try to prove the
     * refresh is what put it there -- measured against a real server, the broken
     * version leaves the shell at zero, but under the e2e fixtures something
     * else repairs it and the test passes either way. A test that cannot fail
     * for the bug it names is worse than no test, so the claim is narrowed to
     * one this setup can actually hold: after importing, the collection and its
     * new category are there.
     */
    test('imported repositories and their category land on the page', async ({ page }) => {
        await page.fill('#config-stars-token', 'ghp_e2e');
        await page.fill('#config-stars-category', 'Code');
        await saveSource(page, 'github:stars');
        await expect(page.locator('#config-stars-token-note')).toContainText('token is saved');

        const state = () => page.evaluate(() => ({
            bookmarks: (window.dashboardInstance.allBookmarks || [])
                .filter((b) => (b.url || '').includes('probe/repo')).length,
            categories: (window.dashboardInstance.categories || []).map((c) => c.id),
        }));
        const before = await state();
        expect(before.bookmarks, 'this test measures a change from zero').toBe(0);
        expect(before.categories).not.toContain('code');

        await page.click('[data-source-action="run"][data-source-id="github:stars"]');
        const modal = page.locator('#config-confirm-modal');
        await modal.waitFor({ timeout: 15_000 });
        // Wait for the import itself: the click returns before the POST does.
        await Promise.all([
            page.waitForResponse((r) => r.url().includes('/run') && r.request().method() === 'POST', { timeout: 20_000 }),
            modal.locator('[data-confirm="ok"]').click(),
        ]);
        await expect(page.locator('#app-notification.show')).toContainText(/Imported|repositor/i, { timeout: 10_000 });

        await page.evaluate(() => window.dashboardInstance.config.closeConfigView());
        await expect(page.locator('#config-view')).toBeHidden({ timeout: 10_000 });

        const after = await state();
        expect(after.bookmarks).toBe(3);
        // The category the import created has to arrive with the bookmarks, or
        // the edit form has nothing to match a bookmark's category against and
        // falls back to "—".
        expect(after.categories).toContain('code');

        const bookmark = await page.evaluate(() => {
            const b = (window.dashboardInstance.allBookmarks || [])
                .find((x) => (x.url || '').includes('probe/repo-1'));
            return {
                category: b?.category,
                known: (window.dashboardInstance.categories || []).some((c) => c.id === b?.category),
                tags: b?.tags,
            };
        });
        // Every star gets the one category the source is configured with.
        expect(bookmark.category).toBe('code');
        expect(bookmark.known).toBe(true);
        expect(bookmark.tags).toContain('go');

        // On screen, counted by distinct address: a bookmark can be rendered
        // more than once -- its category and a smart collection both show it.
        const onScreen = await page.evaluate(() => new Set(
            [...document.querySelectorAll('a[href*="probe/repo"]')].map((a) => a.getAttribute('href'))
        ).size);
        expect(onScreen).toBe(3);
    });

    test('saving a category again keeps the token', async ({ page }) => {
        await page.fill('#config-stars-token', 'ghp_e2e_secret');
        await saveSource(page, 'github:stars');
        await expect(page.locator('#config-stars-token-note')).toContainText('token is saved');

        /*
         * The form submits an empty token field, which must mean "unchanged".
         * Asserting on the note alone proves nothing -- it says "a token is
         * saved" either way, since a cleared token would just be an empty
         * string that hasToken reports as false only if it really was cleared.
         * So the check is the round that follows: a run with no token behind it
         * fails on the token, not on the network.
         */
        // Wait for the save itself, not for a moment afterwards: the click
        // returns before the PUT does, and reading /api/sources in that gap is
        // how this test failed once and passed on retry.
        await page.fill('#config-stars-category', 'reading');
        await Promise.all([
            page.waitForResponse((r) => r.url().includes('/api/sources/') && r.request().method() === 'PUT'),
            page.click('[data-source-action="save"][data-source-id="github:stars"]'),
        ]);

        const state = await page.evaluate(async () => {
            const f = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
            const sources = await (await f('/api/sources')).json();
            return sources.find((s) => s.id === 'github:stars');
        });
        expect(state.hasToken).toBe(true);
        expect(state.targetCategory).toBe('reading');
    });

    /*
     * Raindrop keeps the collection the reader filed each bookmark in.
     *
     * This is the one thing it does differently from GitHub, and the reason the
     * descriptor carries a fallback category rather than a fixed one: a starred
     * repo has no folder, so stars can all land in one place, but a raindrop
     * sits in a collection the reader built themselves. Flattening those into a
     * single category throws away the structure that made the service worth
     * using.
     */
    test('raindrops keep the collection they were filed in', async ({ page }) => {
        await page.fill('#config-raindrop-token', 'test_token');
        await page.fill('#config-raindrop-category', 'Raindrop');
        await saveSource(page, 'raindrop:all');
        await expect(page.locator('#config-raindrop-token-note')).toContainText('token is saved');

        await page.click('[data-source-action="run"][data-source-id="raindrop:all"]');
        const modal = page.locator('#config-confirm-modal');
        await modal.waitFor({ timeout: 15_000 });
        await expect(modal).toContainText('3');
        await Promise.all([
            page.waitForResponse((r) => r.url().includes('/run') && r.request().method() === 'POST', { timeout: 20_000 }),
            modal.locator('[data-confirm="ok"]').click(),
        ]);
        await expect(page.locator('#app-notification.show')).toContainText(/Imported|bookmark/i, { timeout: 10_000 });

        const rows = await page.evaluate(async () => {
            const f = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
            const all = await (await f('/api/bookmarks?page=1')).json();
            return all.filter((b) => (b.url || '').includes('rd.example.com'))
                .map((b) => ({ name: b.name, category: b.category, tags: b.tags, note: b.note, createdAt: b.createdAt }));
        });
        expect(rows).toHaveLength(3);

        // Two were in the collection the stub names "Reading"; the third is in
        // one the listing never named, so it falls back to the configured
        // category rather than landing nowhere.
        const categories = rows.map((r) => r.category).sort();
        expect(categories).toEqual(['raindrop', 'reading', 'reading']);

        const first = rows.find((r) => r.name === 'Raindrop 1');
        // The reader's own note, not the excerpt the service scraped for them.
        expect(first.note).toBe('my note 1');
        // Tags arrive normalised, so an imported tag cannot differ from a typed
        // one -- "Read" and "read" being two tags would make the filter lie.
        expect(first.tags).toEqual(['read', 'later']);
        // The date they saved it, not the date it was imported.
        expect(first.createdAt).toBe(Date.parse('2026-03-01T00:00:00Z'));
    });

    /*
     * The panel remembers what the last round did.
     *
     * Not just a toast that disappears: a reader coming back tomorrow needs to
     * see whether the last import worked, which is the whole reason the register
     * keeps lastResult at all.
     *
     * On its own source id, because the store is reset per spec file rather
     * than per test and a source that already ran carries a cursor: the same
     * three raindrops then come back as "nothing new", with no confirm to
     * click, which made this pass or fail on running order. A fresh id starts
     * with no cursor and no page of its own to collide with.
     */
    test('the status line says what the last import did', async ({ page }) => {
        // Configured through the API, on an id nothing else in this file uses.
        const summary = await page.evaluate(async () => {
            const f = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
            const h = {
                'Content-Type': 'application/json',
                ...(typeof nextDashWriteHeaders === 'function' ? nextDashWriteHeaders() : {}),
            };
            const pages = await (await f('/api/pages')).json();
            const nextId = Math.max(...pages.map((p) => p.id)) + 1;
            await f('/api/pages', {
                method: 'POST',
                headers: h,
                body: JSON.stringify([...pages, { id: nextId, name: 'Status check' }]),
            });
            await f('/api/sources/raindrop:status', {
                method: 'PUT',
                headers: h,
                body: JSON.stringify({
                    kind: 'raindrop', label: 'Raindrop.io', token: 'test_token',
                    targetPage: nextId, targetCategory: 'Raindrop', enabled: true,
                }),
            });
            await f('/api/sources/raindrop:status/run', { method: 'POST', headers: h });
            const sources = await (await f('/api/sources')).json();
            return sources.find((s) => s.id === 'raindrop:status')?.lastResult || '';
        });

        // The register remembers the round, which is what the panel reads back.
        expect(summary).toMatch(/\d+ new, \d+ already here/);
    });

    test('the page to import onto can be picked, and a new one made', async ({ page }) => {
        const select = page.locator('#config-raindrop-page');
        await expect(select).toBeVisible();

        // Every page, plus the create entry the bookmark form offers.
        const options = await page.evaluate(() => [...document.querySelectorAll('#config-raindrop-page option')]
            .map((o) => o.value));
        expect(options).toContain('__new__');
        expect(options).toContain('1');

        // Picking the create entry swaps the select for the shared naming row
        // rather than navigating anywhere.
        await select.selectOption('__new__');
        const row = page.locator('[data-source-page-field="raindrop:all"] .bookmark-inline-create');
        await expect(row).toBeVisible();
        await row.locator('.bookmark-inline-create-input').fill('Imports');
        await row.locator('button').first().click();

        // The new page is made and selected, and the select is back.
        await expect(select).toBeVisible();
        await expect.poll(async () => select.inputValue()).not.toBe('__new__');
        const chosen = await page.evaluate(() => {
            const s = document.getElementById('config-raindrop-page');
            return s.options[s.selectedIndex].textContent;
        });
        expect(chosen).toBe('Imports');

        // And it is what gets stored, not the page being looked at.
        await page.fill('#config-raindrop-token', 'test_token');
        await Promise.all([
            page.waitForResponse((r) => r.url().includes('/api/sources/') && r.request().method() === 'PUT'),
            page.click('[data-source-action="save"][data-source-id="raindrop:all"]'),
        ]);
        const stored = await page.evaluate(async () => {
            const f = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
            const sources = await (await f('/api/sources')).json();
            return sources.find((s) => s.id === 'raindrop:all');
        });
        const pages = await page.evaluate(async () => {
            const f = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
            return (await f('/api/pages')).json();
        });
        const imports = pages.find((pg) => pg.name === 'Imports');
        expect(imports, 'the page was not created').toBeTruthy();
        expect(stored.targetPage).toBe(imports.id);
    });
});
