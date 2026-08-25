// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays, GITHUB_STUB_PORT } = require('./e2e-helpers');
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
let stub;
test.beforeAll(async () => {
    stub = http.createServer((req, res) => {
        const body = JSON.stringify(req.url.includes('page=1') ? STARS : []);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(body);
    });
    await new Promise((resolve) => stub.listen(GITHUB_STUB_PORT, '127.0.0.1', resolve));
});
test.afterAll(async () => {
    await new Promise((resolve) => stub.close(resolve));
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
test.describe('GitHub stars source', () => {
    test.beforeEach(async ({ page }) => {
        await markWhatsNewSeen(page);
        await page.goto('/');
        await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
        await dismissOnboardingIfPresent(page);
        await dismissBlockingOverlays(page);
        await page.evaluate(() => window.dashboardInstance.config.openConfigView('data-backups'));
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
        // The CSV export button was on this panel before this feature existed.
        const reference = await styleOf('[data-backup-action="csv-export"]', BUTTON);
        expect(await styleOf('[data-backup-action="stars-save"]', BUTTON)).toBe(reference);
        expect(await styleOf('[data-backup-action="stars-run"]', BUTTON)).toBe(reference);

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
        await page.click('[data-backup-action="stars-save"]');

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
        await page.click('[data-backup-action="stars-save"]');
        await expect(page.locator('#config-stars-token-note')).toContainText('token is saved');

        const state = () => page.evaluate(() => ({
            bookmarks: (window.dashboardInstance.allBookmarks || [])
                .filter((b) => (b.url || '').includes('probe/repo')).length,
            categories: (window.dashboardInstance.categories || []).map((c) => c.id),
        }));
        const before = await state();
        expect(before.bookmarks, 'this test measures a change from zero').toBe(0);
        expect(before.categories).not.toContain('code');

        await page.click('[data-backup-action="stars-run"]');
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
        await page.click('[data-backup-action="stars-save"]');
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
            page.click('[data-backup-action="stars-save"]'),
        ]);

        const state = await page.evaluate(async () => {
            const f = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
            const sources = await (await f('/api/sources')).json();
            return sources.find((s) => s.id === 'github:stars');
        });
        expect(state.hasToken).toBe(true);
        expect(state.targetCategory).toBe('reading');
    });
});
