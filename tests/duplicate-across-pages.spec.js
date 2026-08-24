// @ts-check
const { test, expect } = require('./fixtures');
const { dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * Saving a link you already have somewhere else.
 *
 * The duplicate check used to look only at the page being saved to, so the same
 * link filed on one page went straight in from another and the duplicates
 * report found it afterwards — reporting instead of preventing. It now looks
 * everywhere, and answers with the conflicting bookmark's name, page and
 * category rather than a bare 409, which is what lets the dialog say where the
 * copy already is.
 *
 * The judgement call is here too: a second copy on another page is sometimes
 * deliberate (the same document with work and with reference), so that case is
 * a question. Two copies on one page never are, so that stays a refusal.
 */

async function loadDashboard(page) {
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
}

/** A second page, so a cross-page duplicate has somewhere to be. */
async function ensureSecondPage(page) {
    return page.evaluate(async () => {
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        const res = await api('/api/pages');
        const pages = res.ok ? await res.json() : [];
        const other = pages.find((p) => Number(p.id) !== Number(window.dashboardInstance.currentPageId));
        if (other) return { id: Number(other.id), name: String(other.name) };

        const newId = Math.max(0, ...pages.map((p) => Number(p.id) || 0)) + 1;
        const newName = `Reference ${newId}`;
        const saveRes = await api('/api/pages', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify([...pages, { id: newId, name: newName }]),
        });
        if (!saveRes.ok) throw new Error(`create second page failed: ${saveRes.status}`);
        return { id: newId, name: newName };
    });
}

async function seedBookmark(page, pageId, name, url) {
    await page.evaluate(async ({ targetPageId, targetName, targetUrl }) => {
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        const res = await api('/api/bookmarks/add', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                page: targetPageId,
                // The seed itself may be a second copy of an earlier test's URL
                // on another page; that is not what is under test here.
                allowDuplicate: true,
                bookmark: { name: targetName, url: targetUrl, category: '', tags: [], createdAt: Date.now() },
            }),
        });
        if (!res.ok) throw new Error(`seed bookmark failed: ${res.status}`);
    }, { targetPageId: pageId, targetName: name, targetUrl: url });
}

async function bookmarksOnPage(page, pageId) {
    return page.evaluate(async (id) => {
        const res = await fetch(`/api/bookmarks?page=${id}`);
        return res.ok ? res.json() : [];
    }, pageId);
}

/** Fill the dashboard's own add form, the way a person reaches it. */
async function fillAddForm(page, name, url) {
    await page.evaluate(() => {
        window.dashboardInstance.quickAddWidget?.open?.()
            ?? window.dashboardInstance.searchComponent.commandsComponent.newCommandHandler.openModal();
    });
    await expect(page.locator('#bookmark-form-modal')).toHaveClass(/show/);
    const form = page.locator('#bookmark-form-modal .bookmark-inline-form');
    await form.locator('input[type="url"]').fill(url);
    await form.locator('.bookmark-inline-input').first().fill(name);
    return form;
}

test.describe('the same link on another page', () => {
    test('asks where it already is, and saves the second copy when you say so', async ({ page }) => {
        const url = `https://example.com/dup-anyway-${Date.now()}.test`;

        await loadDashboard(page);
        const currentPageId = await page.evaluate(() => Number(window.dashboardInstance.currentPageId));
        const { id: otherPageId, name: otherPageName } = await ensureSecondPage(page);
        await seedBookmark(page, otherPageId, 'Reference copy', url);
        await page.reload();
        await loadDashboard(page);

        const form = await fillAddForm(page, 'Work copy', url);
        await form.locator('.bookmark-inline-actions > .bookmark-inline-save').click();

        // The dialog names the page it is already on — an id would be no use,
        // and the page name is what the server sends for exactly this line.
        const dialog = page.locator('#app-modal');
        await expect(dialog).toHaveClass(/show/, { timeout: 10_000 });
        await expect(dialog.locator('#modal-text')).toContainText(otherPageName);
        await expect(dialog.locator('.duplicate-existing a')).toHaveAttribute('href', url);

        await dialog.locator('.modal-button').first().click();

        await expect.poll(async () => {
            const list = await bookmarksOnPage(page, currentPageId);
            return list.some((b) => b.url === url);
        }, { timeout: 10_000 }).toBe(true);
        // And the original is untouched: this adds a copy, it does not move one.
        const other = await bookmarksOnPage(page, otherPageId);
        expect(other.some((b) => b.url === url)).toBe(true);
    });

    test('saves nothing when you decline', async ({ page }) => {
        const url = `https://example.com/dup-decline-${Date.now()}.test`;

        await loadDashboard(page);
        const currentPageId = await page.evaluate(() => Number(window.dashboardInstance.currentPageId));
        const { id: otherPageId } = await ensureSecondPage(page);
        await seedBookmark(page, otherPageId, 'Reference copy', url);
        await page.reload();
        await loadDashboard(page);

        const form = await fillAddForm(page, 'Work copy', url);
        await form.locator('.bookmark-inline-actions > .bookmark-inline-save').click();

        const dialog = page.locator('#app-modal');
        await expect(dialog).toHaveClass(/show/, { timeout: 10_000 });
        await dialog.locator('.modal-button').nth(1).click();

        // Nothing to poll towards, so settle first and then assert absence.
        await page.waitForTimeout(1500);
        const list = await bookmarksOnPage(page, currentPageId);
        expect(list.some((b) => b.url === url)).toBe(false);
    });
});

test.describe('the same link twice on one page', () => {
    test('is refused, with no question asked', async ({ page }) => {
        const url = `https://example.com/dup-same-page-${Date.now()}.test`;

        await loadDashboard(page);
        const currentPageId = await page.evaluate(() => Number(window.dashboardInstance.currentPageId));
        await seedBookmark(page, currentPageId, 'First copy', url);
        await page.reload();
        await loadDashboard(page);

        const form = await fillAddForm(page, 'Second copy', url);
        await form.locator('.bookmark-inline-actions > .bookmark-inline-save').click();
        await page.waitForTimeout(1500);

        // No dialog: two copies on one page are a mistake in every case, so
        // there is nothing to decide.
        await expect(page.locator('#app-modal')).not.toHaveClass(/show/);
        const list = await bookmarksOnPage(page, currentPageId);
        expect(list.filter((b) => b.url === url).length).toBe(1);
    });
});
