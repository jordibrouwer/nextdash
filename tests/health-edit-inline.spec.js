// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, prepareDashboardInteraction } = require('./e2e-helpers');

/**
 * Health Edit opens the shared bookmark modal — the same form Promote uses —
 * prefilled with the bookmark, and leaves the Health view standing underneath so
 * closing it returns you to the row instead of the bookmarks grid.
 */
test.describe('health Edit → bookmark modal', () => {
    function bookmarkForm(page) {
        return page.locator('#bookmark-form-modal .bookmark-inline-form');
    }

    /** Stub the health report around the first real bookmark on the page. */
    async function openHealthWithOneIssue(page) {
        await markWhatsNewSeen(page);
        await page.goto('/');
        await page.waitForSelector('.bookmark-link', { timeout: 15_000 });
        await prepareDashboardInteraction(page);

        const issue = await page.evaluate(() => {
            const row = document.querySelector('.bookmark-link[data-bookmark-index]');
            if (!row) return null;
            return {
                pageId: Number(window.dashboardInstance?.currentPageId) || 1,
                index: Number(row.getAttribute('data-bookmark-index')),
                pageName: 'dev',
                name: row.querySelector('.bookmark-text')?.textContent?.trim() || 'x',
                url: row.getAttribute('data-bookmark-url') || 'https://example.com',
                category: row.getAttribute('data-category-id') || 'tools',
                status: 'broken',
                score: 25,
                duplicateCount: 0,
                lastChecked: Date.now(),
                reasons: ['HTTP 500'],
                reasonDetails: [{ code: 'last_error', detail: 'HTTP 500', penalty: 60 }],
            };
        });
        expect(issue).toBeTruthy();

        await page.route('**/api/bookmark-health**', async (route) => {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    generatedAt: Date.now(),
                    summary: {
                        totalBookmarks: 1,
                        healthyCount: 0,
                        brokenCount: 1,
                        duplicateCount: 0,
                        uncheckedCount: 0,
                    },
                    issues: [issue],
                    duplicateGroups: [],
                }),
            });
        });

        await page.click('.health-link a.health-link-anchor');
        await page.waitForSelector('#dashboard-layout.health-layout .health-view-item', { timeout: 15_000 });
        return issue;
    }

    async function clickEdit(page) {
        const healthRow = page.locator('.health-view-item').first();
        await healthRow.hover();
        await healthRow.locator('[data-health-action="edit"]').click();
    }

    test('Edit opens the modal prefilled, without leaving Health', async ({ page }) => {
        const issue = await openHealthWithOneIssue(page);
        await clickEdit(page);

        await expect(page.locator('#bookmark-form-modal.show')).toBeVisible({ timeout: 15_000 });
        // The view underneath is still Health, which is the point of the change.
        await expect(page.locator('#dashboard-layout')).toHaveClass(/health-layout/);

        const form = bookmarkForm(page);
        await expect(form.locator('input[type="url"]')).toHaveValue(issue.url);
        await expect(form.locator('.bookmark-inline-input').first()).toHaveValue(issue.name);
        // Edit mode retitles the form and drops "Create + New".
        await expect(page.locator('#bookmark-form-modal-title')).toHaveText(/edit/i);
        await expect(page.locator('#bookmark-form-create-another')).toHaveCount(0);
    });

    test('closing the modal returns to the Health row', async ({ page }) => {
        await openHealthWithOneIssue(page);
        await clickEdit(page);
        await expect(page.locator('#bookmark-form-modal.show')).toBeVisible({ timeout: 15_000 });

        await bookmarkForm(page).locator('.bookmark-inline-action-btn', { hasText: /cancel/i }).click();
        await expect(page.locator('#bookmark-form-modal')).not.toHaveClass(/show/, { timeout: 10_000 });
        await expect(page.locator('#dashboard-layout')).toHaveClass(/health-layout/);
        await expect(page.locator('.health-view-item').first()).toBeVisible();
    });

    test('saving writes the bookmark back and keeps Health open', async ({ page }) => {
        const issue = await openHealthWithOneIssue(page);
        await clickEdit(page);
        await expect(page.locator('#bookmark-form-modal.show')).toBeVisible({ timeout: 15_000 });

        const newName = `Renamed from health ${Date.now()}`;
        const form = bookmarkForm(page);
        await form.locator('.bookmark-inline-input').first().fill(newName);

        const savePost = page.waitForRequest((req) =>
            req.url().includes(`/api/bookmarks?page=${issue.pageId}`) && req.method() === 'POST');
        await form.locator('.bookmark-inline-actions > .bookmark-inline-save').click();
        const request = await savePost;

        // The whole page list is written back with the edited entry replaced.
        const body = JSON.parse(request.postData() || '[]');
        expect(Array.isArray(body)).toBe(true);
        expect(body.some((b) => b.name === newName)).toBe(true);
        // Nothing was appended: an edit replaces, it does not add a second copy.
        expect(body.filter((b) => b.url === issue.url).length).toBe(1);

        await expect(page.locator('#bookmark-form-modal')).not.toHaveClass(/show/, { timeout: 10_000 });
        await expect(page.locator('#dashboard-layout')).toHaveClass(/health-layout/);
    });

    test('a stale index in the report edits the bookmark the URL names', async ({ page }) => {
        await markWhatsNewSeen(page);
        await page.goto('/');
        await page.waitForSelector('.bookmark-link', { timeout: 15_000 });
        await prepareDashboardInteraction(page);

        const target = await page.evaluate(async () => {
            const pageId = Number(window.dashboardInstance?.currentPageId) || 1;
            const list = await (await fetch(`/api/bookmarks?page=${pageId}`)).json();
            return { pageId, count: list.length, first: list[0], last: list[list.length - 1] };
        });
        expect(target.count).toBeGreaterThan(1);

        // The report names the last bookmark but carries index 0 — the situation a
        // few-minutes-old report produces after a reorder or a delete.
        await page.route('**/api/bookmark-health**', async (route) => {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    generatedAt: Date.now(),
                    summary: {
                        totalBookmarks: 1,
                        healthyCount: 0,
                        brokenCount: 1,
                        duplicateCount: 0,
                        uncheckedCount: 0,
                    },
                    issues: [{
                        pageId: target.pageId,
                        index: 0,
                        pageName: 'dev',
                        name: target.last.name,
                        url: target.last.url,
                        category: target.last.category || '',
                        status: 'broken',
                        score: 25,
                        duplicateCount: 0,
                        lastChecked: Date.now(),
                        reasons: ['HTTP 500'],
                        reasonDetails: [{ code: 'last_error', detail: 'HTTP 500', penalty: 60 }],
                    }],
                    duplicateGroups: [],
                }),
            });
        });

        await page.click('.health-link a.health-link-anchor');
        await page.waitForSelector('#dashboard-layout.health-layout .health-view-item', { timeout: 15_000 });
        await clickEdit(page);
        await expect(page.locator('#bookmark-form-modal.show')).toBeVisible({ timeout: 15_000 });

        const form = bookmarkForm(page);
        await expect(form.locator('input[type="url"]')).toHaveValue(target.last.url);

        const newName = `Stale index edit ${Date.now()}`;
        await form.locator('.bookmark-inline-input').first().fill(newName);
        const savePost = page.waitForRequest((r) =>
            r.url().includes(`/api/bookmarks?page=${target.pageId}`) && r.method() === 'POST');
        await form.locator('.bookmark-inline-actions > .bookmark-inline-save').click();
        const body = JSON.parse((await savePost).postData() || '[]');

        // The bookmark the URL names was renamed; index 0 was left alone.
        expect(body.find((b) => b.name === newName)?.url).toBe(target.last.url);
        expect(body[0].name).toBe(target.first.name);
        expect(body.length).toBe(target.count);
    });
});
