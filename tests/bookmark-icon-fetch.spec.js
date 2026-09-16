// @ts-check
const { test, expect } = require('./fixtures');
const { dismissOnboardingIfPresent, dismissBlockingOverlays, markWhatsNewSeen } = require('./e2e-helpers');

/**
 * Fetching a bookmark's favicon.
 *
 * Five tests used to stand for this in config-bookmarks-editor.spec.js and
 * were switched off with the note "Icon fetch UX is covered by dashboard
 * inline-edit specs". It was not: nothing in the suite touched the fetch at
 * all, so the Fetch button, the fetch on blur and the rule that protects a
 * hand-picked icon were running unwatched.
 *
 * Both ends are stubbed. /api/bookmark-preview reads the page and returns the
 * icon's address; /api/icon/from-url downloads it and returns the filename the
 * bookmark stores. Counting the calls is what says whether a fetch happened,
 * because a fetch that finds the same icon looks identical in the field.
 *
 * Each test states the icon it starts from. The rule turns on it: the blur
 * fetch fills an empty icon and never replaces one that is already there
 * (dashboard-inline-edit.js starts pendingIcon at the bookmark's own icon and
 * skips the fetch while it is set), while the Fetch button asks either way.
 * Left to whichever bookmark the list happened to put first, these tests
 * answered differently from run to run.
 */

/** Stub both ends of the fetch and count how often the page asks. */
async function stubIconFetch(page, { icon = 'https://example.com/favicon.ico', fail = false } = {}) {
    const calls = { preview: 0, download: 0 };
    await page.route('**/api/bookmark-preview*', async (route) => {
        calls.preview += 1;
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(fail ? {} : { icon }),
        });
    });
    await page.route('**/api/icon/from-url', async (route) => {
        calls.download += 1;
        /*
         * A page that declares no icon is not the end of it: the app falls back
         * to the host's own /favicon.ico and tries to download that. So a test
         * about finding nothing has to refuse the download too, or the fallback
         * quietly succeeds and the field fills after all.
         */
        if (fail) {
            await route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
            return;
        }
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ icon: `fetched-${calls.download}.ico` }),
        });
    });
    return calls;
}

/*
 * The icon the form opens on decides which rule applies, so each test says it.
 *
 * On the server, not on window.dashboardInstance.allBookmarks: the modal
 * resolves the bookmark itself, so an entry edited in that array opened the
 * form with the stored icon anyway and the tests answered differently from run
 * to run.
 */
async function seedFirstIcon(page, icon) {
    await page.evaluate(async (value) => {
        const dash = window.dashboardInstance;
        const pageId = dash.currentPageId;
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        const response = await fetch(`/api/bookmarks?page=${pageId}`);
        const bookmarks = await response.json();
        if (!bookmarks.length) throw new Error('no bookmarks on this page');
        bookmarks[0].icon = value;
        const save = await api(`/api/bookmarks?page=${pageId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(bookmarks),
        });
        if (!save.ok) throw new Error(`seed failed: ${save.status}`);
        await dash.loadData();
    }, icon);
}

async function openEditor(page, { icon = '' } = {}) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.allBookmarks?.length > 0, null, { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await seedFirstIcon(page, icon);
    await page.evaluate(() => window.dashboardInstance.config.openConfigView('bookmarks'));
    await expect(page.locator('#config-bm-list')).toBeVisible();

    // Through the list's own `e` shortcut, on the row the cursor lands on
    // first — the slab row has no dedicated Edit button any more.
    await expect
        .poll(() => page.locator('#config-bm-list .config-bm-row').count())
        .toBeGreaterThan(0);
    await page.locator('#config-bm-list').click();
    await page.keyboard.press('j');
    await page.keyboard.press('e');
    await expect(page.locator('#bookmark-form-modal.show')).toBeVisible();
}

const urlField = (page) => page.locator('#bookmark-form-modal input[type="url"]');
const iconField = (page) => page.locator('#bookmark-form-modal [data-field-block="icon"] .bookmark-inline-input');

/** The auto-fetch waits 250ms after blur, then talks to two endpoints. */
const settle = (page) => page.waitForTimeout(900);

test.describe('fetching a favicon', () => {
    test('the Fetch button asks again even when an icon is already set', async ({ page }) => {
        const calls = await stubIconFetch(page);
        await openEditor(page, { icon: 'already-set.ico' });

        // An icon is already there: this is the case the button exists for,
        // when the stored one is wrong or stale.
        await page.locator('#bookmark-form-modal [data-field-block="icon"] button', { hasText: /fetch/i })
            .first().click();
        await settle(page);

        expect(calls.preview, 'the Fetch button did not ask').toBeGreaterThan(0);
        await expect(iconField(page), 'the fetched icon did not reach the field')
            .toHaveValue(/fetched-/);
    });

    test('an empty icon and a changed URL fetch on blur', async ({ page }) => {
        const calls = await stubIconFetch(page);
        await openEditor(page, { icon: '' });

        await urlField(page).fill('https://changed.example.com/page');
        await urlField(page).blur();
        await settle(page);

        expect(calls.preview, 'typing a new address fetched nothing').toBeGreaterThan(0);
        await expect(iconField(page)).toHaveValue(/fetched-/);
    });

    test('an icon already chosen survives a new address', async ({ page }) => {
        const calls = await stubIconFetch(page);
        await openEditor(page, { icon: 'hand-picked.ico' });

        // Even a real change of address: the blur fetch fills an empty icon and
        // leaves a chosen one alone. The Fetch button is how you ask for a new
        // one, and it is one click away.
        await urlField(page).fill('https://changed.example.com/page');
        await urlField(page).blur();
        await settle(page);

        expect(calls.preview, 'the blur fetch overrode a chosen icon').toBe(0);
        await expect(iconField(page), 'the chosen icon was replaced')
            .toHaveValue('/data/icons/hand-picked.ico');
    });

    test('completing a bare host to https does not count as a change', async ({ page }) => {
        const calls = await stubIconFetch(page);
        await openEditor(page, { icon: '' });

        await urlField(page).fill('example.com/path');
        await urlField(page).blur();
        await settle(page);
        const afterFirst = calls.preview;

        // The form rewrites the value to https://example.com/path on blur. That
        // rewrite is the app's own doing, so leaving the field a second time
        // must not read as a second address.
        await expect(urlField(page)).toHaveValue('https://example.com/path');
        await urlField(page).focus();
        await urlField(page).blur();
        await settle(page);

        expect(calls.preview, 'the app re-fetched its own rewrite').toBe(afterFirst);
    });

    test('a fetch that finds nothing says so', async ({ page }) => {
        const calls = await stubIconFetch(page, { fail: true });
        await openEditor(page, { icon: '' });

        await urlField(page).fill('https://nothing.example.com/');
        await urlField(page).blur();
        await settle(page);

        expect(calls.preview, 'nothing was asked at all').toBeGreaterThan(0);
        // A page with no icon of its own is an answer. It has to say so rather
        // than leave the reader watching a field that never fills.
        await expect(iconField(page), 'a failed fetch invented an icon').toHaveValue('');
        await expect(page.locator('#bookmark-form-modal .bookmark-inline-icon-state').last())
            .not.toBeEmpty();
    });
});
