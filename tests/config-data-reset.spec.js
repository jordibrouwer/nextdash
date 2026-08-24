// @ts-check
const { test, expect } = require('./fixtures');
const { dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * The reset actions used to POST with no body, while the server requires an
 * explicit {"confirm":true} and answered 400. These tests assert the server's
 * response, not just that a click happened, so a silent 400 fails them.
 */
async function openReset(page) {
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    // #dashboard-layout exists before the dashboard has finished wiring itself
    // up, so wait for the instance rather than assuming it is there.
    await page.waitForFunction(() => !!window.dashboardInstance?.config, null, { timeout: 15_000 });
    await page.evaluate(() => window.dashboardInstance.config.openConfigView('data-backups'));
    await page.locator('[data-db-tab="reset"]').click();
    await expect(page.locator('[data-backup-action="reset"]')).toBeVisible();
}

/**
 * Read every page's bookmarks, so a destructive test can put back exactly what
 * it removed. GET/POST /api/bookmarks?page=N are inverses of each other.
 * @returns {Promise<Array<{ pageId: number, bookmarks: any[] }>>}
 */
async function snapshotAllBookmarks(page) {
    return page.evaluate(async () => {
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        const pagesRes = await api('/api/pages');
        const pages = pagesRes.ok ? await pagesRes.json() : [];
        const out = [];
        for (const p of pages || []) {
            const pageId = Number(p?.id);
            if (!Number.isFinite(pageId)) continue;
            const res = await api(`/api/bookmarks?page=${pageId}`);
            out.push({ pageId, bookmarks: res.ok ? (await res.json()) || [] : [] });
        }
        return out;
    });
}

/** Drop server-enriched fields so restore round-trips stay comparable. */
function normalizeBookmarkSnapshot(snapshot) {
    return snapshot.map(({ pageId, bookmarks }) => ({
        pageId,
        bookmarks: bookmarks.map(({ updatedAt, ...bookmark }) => bookmark),
    }));
}

/** Write a snapshot from snapshotAllBookmarks() back, page by page. */
async function restoreAllBookmarks(page, snapshot) {
    await page.evaluate(async (entries) => {
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        for (const entry of entries) {
            const res = await api(`/api/bookmarks?page=${entry.pageId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(entry.bookmarks),
            });
            if (!res.ok) {
                throw new Error(`restore failed for page ${entry.pageId}: HTTP ${res.status}`);
            }
        }
    }, snapshot);
}

test.describe('config data & backups — reset tab', () => {
    test('destructive actions live on their own Reset tab', async ({ page }) => {
        await page.goto('/');
        await page.waitForSelector('#dashboard-layout', { timeout: 15_000 });
        await dismissOnboardingIfPresent(page);
        await dismissBlockingOverlays(page);
        await page.waitForFunction(() => !!window.dashboardInstance?.config, null, { timeout: 15_000 });
        await page.evaluate(() => window.dashboardInstance.config.openConfigView('data-backups'));

        // Not on the default tab...
        await expect(page.locator('[data-backup-action="reset"]')).toHaveCount(0);
        await expect(page.locator('[data-backup-action="download"]')).toBeVisible();

        // ...and present once you switch to Reset.
        await page.locator('[data-db-tab="reset"]').click();
        await expect(page.locator('[data-backup-action="reset"]')).toBeVisible();
        await expect(page.locator('[data-backup-action="delete-bookmarks"]')).toBeVisible();
        await expect(page.locator('[data-backup-action="download"]')).toHaveCount(0);
    });

    test('the reset tab is deep-linkable', async ({ page }) => {
        await page.goto('/#config/data-backups/reset');
        await page.waitForSelector('#dashboard-layout', { timeout: 15_000 });
        await dismissOnboardingIfPresent(page);
        await expect(page.locator('[data-backup-action="reset"]')).toBeVisible({ timeout: 10_000 });
    });

    test('reset asks twice: confirm, then type the word', async ({ page }) => {
        await openReset(page);
        await page.locator('[data-backup-action="reset"]').click();

        // First gate: the plain confirm.
        await expect(page.locator('#config-confirm-modal')).toBeVisible();
        await page.locator('[data-confirm="ok"]').click();

        // Second gate: a text field, with the confirm button disabled until the
        // typed word matches.
        const input = page.locator('[data-confirm-input]');
        await expect(input).toBeVisible();
        const ok = page.locator('[data-confirm="ok"]');
        await expect(ok).toBeDisabled();

        await input.fill('nope');
        await expect(ok).toBeDisabled();

        await input.fill('RESET');
        await expect(ok).toBeEnabled();

        // Leave without resetting: this suite must not wipe the test data.
        await page.locator('[data-confirm="cancel"]').click();
        await expect(page.locator('#config-confirm-modal')).toHaveCount(0);
    });

    test('the typed word is matched case- and space-insensitively', async ({ page }) => {
        await openReset(page);
        await page.locator('[data-backup-action="reset"]').click();
        await page.locator('[data-confirm="ok"]').click();
        const input = page.locator('[data-confirm-input]');
        await input.fill('  reset  ');
        await expect(page.locator('[data-confirm="ok"]')).toBeEnabled();
        await page.locator('[data-confirm="cancel"]').click();
    });

    test('delete-all-bookmarks is accepted by the server', async ({ page }) => {
        await openReset(page);

        // This is the one test here that really destroys data: it empties every
        // page's bookmarks and the server keeps them emptied. The suite shares a
        // single data dir, so without putting them back every later spec runs
        // against a bookmark-less install and reads it as a clean one.
        const snapshot = await snapshotAllBookmarks(page);
        expect(snapshot.some((entry) => entry.bookmarks.length > 0)).toBe(true);

        try {
            // Watch the real response: a missing confirm body answers 400.
            const status = page.waitForResponse((r) => r.url().includes('/api/bookmarks/delete-all'));
            await page.locator('[data-backup-action="delete-bookmarks"]').click();
            await page.locator('[data-confirm="ok"]').click();
            expect((await status).status()).toBe(200);
        } finally {
            // Restore in a finally: a failed assertion above must not leave the
            // shared data dir wiped for everything that runs after it.
            await restoreAllBookmarks(page, snapshot);
        }

        // The restore is part of the contract, so assert it actually took.
        const after = await snapshotAllBookmarks(page);
        expect(normalizeBookmarkSnapshot(after)).toEqual(normalizeBookmarkSnapshot(snapshot));
    });
});
