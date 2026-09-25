// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * Saving asks before it surprises.
 *
 * A bookmark with no category lands under "—", which nobody means to do by
 * accident, and a link that is already saved got a second copy -- or, on the
 * same page, a bare "Could not create bookmark". The form asks first: yes or
 * no for a missing category and for a copy on another page, and a plain
 * answer when the page already has it.
 */

async function openAdd(page, options = {}) {
    await markWhatsNewSeen(page);
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.route('**/api/bookmark-preview*', (route) => route.fulfill({
        status: 200, contentType: 'application/json', body: JSON.stringify({ title: '' }),
    }));
    await page.evaluate((opts) => window.dashboardInstance.openBookmarkFormModal({ mode: 'create', ...opts }), options);
    await expect(page.locator('#bookmark-form-modal')).toHaveClass(/show/);
    return page.locator('#bookmark-form-modal .bookmark-inline-form');
}

const dialog = (page) => page.locator('#modal-actions');
const save = (form) => form.locator('.bookmark-inline-actions .bookmark-inline-save');

async function pickFirstCategory(page, form) {
    await form.locator('.bookmark-form-place-value').click();
    await page.locator('.bookmark-form-place-pop .bookmark-form-place-option').first().click();
}

test('no category: asked first, and No keeps the form open', async ({ page }) => {
    const form = await openAdd(page);
    await form.locator('[data-field="url"]').fill(`https://nocat.example/${Date.now()}`);
    await form.locator('[data-field="name"]').fill('No category');
    await save(form).click();
    await expect(dialog(page)).toBeVisible();
    await expect(page.locator('#app-modal')).toContainText(/category/i);
    await dialog(page).locator('button').nth(1).click();
    await expect(page.locator('#bookmark-form-modal')).toHaveClass(/show/);
});

test('no category: Yes saves it without one', async ({ page }) => {
    const form = await openAdd(page);
    const url = `https://nocat-yes.example/${Date.now()}`;
    await form.locator('[data-field="url"]').fill(url);
    await form.locator('[data-field="name"]').fill('No category yes');
    await save(form).click();
    await dialog(page).locator('button').first().click();
    await expect(page.locator('#bookmark-form-modal')).not.toHaveClass(/show/, { timeout: 10_000 });
    await expect.poll(() => page.evaluate((u) => (window.dashboardInstance.allBookmarks || [])
        .some((b) => b.url === u), url)).toBe(true);
});

test('a link already on this page is named, and not saved twice', async ({ page }) => {
    const form = await openAdd(page);
    const existing = await page.evaluate(() => {
        const d = window.dashboardInstance;
        return (d.bookmarks || []).find((b) => b.url)?.url || '';
    });
    test.skip(!existing, 'page has no bookmarks');
    await form.locator('[data-field="url"]').fill(existing);
    await form.locator('[data-field="name"]').fill('Twice');
    await pickFirstCategory(page, form);
    await save(form).click();
    await expect(page.locator('#app-modal')).toContainText(/already/i);
    await expect(dialog(page).locator('button')).toHaveCount(1);
    await dialog(page).locator('button').first().click();
    await expect(page.locator('#bookmark-form-modal')).toHaveClass(/show/);
});

test('a link saved on another page: asked, and Yes saves a second copy here', async ({ page }) => {
    const url = `https://elsewhere.example/${Date.now()}`;
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });
    const otherPage = await page.evaluate(async (u) => {
        const d = window.dashboardInstance;
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        let other = (d.pages || []).find((p) => String(p.id) !== String(d.currentPageId));
        if (!other) {
            const made = await d.structureCreate.createPageFromForm(`Elsewhere ${Date.now()}`);
            other = { id: made.id };
        }
        await api('/api/bookmarks/add', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ page: other.id, bookmark: { name: 'Elsewhere', url: u, category: '' } }),
        });
        await d.loadAllBookmarks?.();
        return other.id;
    }, url);
    expect(otherPage).toBeTruthy();
    const form = await openAdd(page);
    await form.locator('[data-field="url"]').fill(url);
    await form.locator('[data-field="name"]').fill('Here too');
    await pickFirstCategory(page, form);
    await save(form).click();
    await expect(page.locator('#app-modal')).toContainText(/already saved/i);
    await dialog(page).locator('button').first().click();
    await expect(page.locator('#bookmark-form-modal')).not.toHaveClass(/show/, { timeout: 10_000 });
    await expect.poll(() => page.evaluate((u) => (window.dashboardInstance.allBookmarks || [])
        .filter((b) => b.url === u).length, url)).toBe(2);
});
