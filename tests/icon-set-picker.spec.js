// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays, answerNoCategory } = require('./e2e-helpers');

/*
 * App icons from the icon sets, in the bookmark form and on the dashboard.
 *
 * The server reads the sets from the Go tests' fixture
 * (NEXTDASH_ICON_SETS_FIXTURE), so sonarr, jellyfin and jellyseerr exist and
 * nothing reaches the CDN. The preview is stubbed: these addresses do not
 * resolve, and the card only needs to know there is a page.
 */

async function loadDashboard(page) {
    await markWhatsNewSeen(page);
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
}

/** The new-bookmark form, the way a reader opens it: Shift+B. */
async function openAdd(page) {
    await loadDashboard(page);
    await page.evaluate(() => document.activeElement?.blur());
    await page.keyboard.press('Shift+KeyB');
    await expect(page.locator('#bookmark-form-modal')).toHaveClass(/show/);
    return page.locator('#bookmark-form-modal .bookmark-inline-form');
}

async function stubPreview(page) {
    await page.route('**/api/bookmark-preview*', (route) => route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ title: 'An app', description: '', image: '', setIcon: true }),
    }));
}

async function storedIcon(page, url) {
    return page.evaluate(async (wanted) => {
        const res = await fetch('/api/bookmarks?all=true');
        const data = await res.json();
        const list = Array.isArray(data) ? data : (data.bookmarks || []);
        return list.find((b) => b.url === wanted)?.icon ?? null;
    }, url);
}

test.describe('app icon picker in the bookmark form', () => {
    test('a suggestion under the address is one click, and saves as the bookmark icon', async ({ page }) => {
        await stubPreview(page);
        const form = await openAdd(page);
        const url = `https://sonarr.s${Date.now()}.lan`;
        await form.locator('[data-field="url"]').fill(url);
        await form.locator('[data-field="url"]').blur();

        const chip = form.locator('[data-icon-set-suggestion="dashboard-icons/sonarr"]');
        await expect(chip).toBeVisible();
        await chip.click();
        await expect(form.locator('.bookmark-form-card-icon > img:not([hidden]):not([data-icon-set-auto])'))
            .toHaveAttribute('src', /\/data\/icons\/sonarr/);
        // Chosen: the suggestions step aside.
        await expect(form.locator('[data-icon-set-suggest]')).toBeHidden();

        await form.locator('.bookmark-inline-actions .bookmark-inline-save').click();
        await answerNoCategory(page);
        await expect(page.locator('#bookmark-form-modal')).not.toHaveClass(/show/);
        await expect.poll(() => storedIcon(page, url)).toMatch(/^sonarr(-dark|-\d+)?\.svg$/);
    });

    test('the pencil opens the picker; typing, arrows and Enter choose an icon', async ({ page }) => {
        await stubPreview(page);
        const form = await openAdd(page);
        await form.locator('[data-field="url"]').fill(`https://media.p${Date.now()}.lan`);
        await form.locator('[data-field="url"]').blur();

        await form.locator('.bookmark-form-card-pencil').click();
        await form.locator('[data-icon-set-choose]').click();
        const picker = page.locator('[data-icon-set-popover]');
        const search = picker.getByRole('searchbox');
        await expect(search).toBeFocused();

        await search.fill('jelly');
        await expect(picker.locator('[role="option"]').first()).toHaveAttribute('data-icon-set-option', 'dashboard-icons/jellyfin');
        await page.keyboard.press('ArrowDown');
        await page.keyboard.press('ArrowRight');
        await expect(picker.locator('[role="option"][aria-selected="true"]'))
            .toHaveAttribute('data-icon-set-option', 'dashboard-icons/jellyseerr');
        await page.keyboard.press('Enter');

        await expect(picker).toHaveCount(0);
        await expect(form.locator('.bookmark-form-card-icon > img:not([hidden]):not([data-icon-set-auto])'))
            .toHaveAttribute('src', /\/data\/icons\/jellyseerr/);
        await expect(page.locator('#bookmark-form-modal')).toHaveClass(/show/);
    });

    test('Escape closes the picker, not the form, and gives focus back to the pencil', async ({ page }) => {
        await stubPreview(page);
        const form = await openAdd(page);
        await form.locator('[data-field="url"]').fill(`https://sonarr.e${Date.now()}.lan`);
        await form.locator('[data-field="url"]').blur();
        await form.locator('.bookmark-form-card-pencil').click();
        await form.locator('[data-icon-set-choose]').click();
        await expect(page.locator('[data-icon-set-popover]').getByRole('searchbox')).toBeFocused();

        await page.keyboard.press('Escape');
        await expect(page.locator('[data-icon-set-popover]')).toHaveCount(0);
        await expect(page.locator('#bookmark-form-modal')).toHaveClass(/show/);
        await expect(form.locator('.bookmark-form-card-pencil')).toBeFocused();
    });

    test('without the icon sets the picker says so, and nothing errors', async ({ page }) => {
        const errors = [];
        page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
        page.on('pageerror', (err) => errors.push(String(err)));
        // What a server that never reached the CDN answers.
        await page.route('**/api/icon-sets/search*', (route) => route.fulfill({
            status: 200, contentType: 'application/json', body: JSON.stringify({ unavailable: true, results: [] }),
        }));
        await page.route('**/api/icon-sets/suggest*', (route) => route.fulfill({
            status: 200, contentType: 'application/json', body: JSON.stringify({ results: [] }),
        }));
        await stubPreview(page);
        const form = await openAdd(page);
        await form.locator('[data-field="url"]').fill(`https://sonarr.o${Date.now()}.lan`);
        await form.locator('[data-field="url"]').blur();
        await expect(form.locator('.bookmark-form-card-desc')).toBeVisible();
        await expect(form.locator('[data-icon-set-suggest]')).toBeHidden();

        await form.locator('.bookmark-form-card-pencil').click();
        await form.locator('[data-icon-set-choose]').click();
        await expect(page.locator('.icon-set-picker-message')).toHaveText(/unavailable offline/i);
        expect(errors).toEqual([]);
    });
});

test.describe('Fetch again on an app the sets know', () => {
    test('drops the old favicon, so the set icon shows and the bookmark saves without one', async ({ page }) => {
        await stubPreview(page);
        await loadDashboard(page);
        const url = `https://sonarr.f${Date.now()}.lan/`;
        await page.evaluate(async (wanted) => {
            const d = window.dashboardInstance;
            const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
            await api('/api/bookmarks/add', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ page: d.currentPageId, bookmark: { name: 'Old sonarr', url: wanted, category: '', icon: 'old-favicon.png' } }),
            });
        }, url);
        await page.reload();
        await page.waitForFunction(() => window.dashboardInstance?.bookmarks?.length > 0, null, { timeout: 15_000 });
        expect(await storedIcon(page, url)).toBe('old-favicon.png');

        await page.locator(`a.bookmark-open[href="${url}"]`).first().click({ button: 'right' });
        await page.locator('#bookmark-context-menu').getByText('Edit', { exact: true }).click();
        const form = page.locator('#bookmark-form-modal .bookmark-inline-form');
        await form.locator('.bookmark-form-card-pencil').click();
        await form.getByRole('menuitem', { name: 'Fetch again' }).click();
        await expect(form.locator('.bookmark-form-card-icon > img[data-icon-set-auto]'))
            .toHaveAttribute('src', /\/data\/icon-sets\/dashboard-icons\/sonarr/);

        await form.locator('.bookmark-inline-actions .bookmark-inline-save').click();
        await answerNoCategory(page);
        await expect(page.locator('#bookmark-form-modal')).not.toHaveClass(/show/);
        await expect.poll(() => storedIcon(page, url)).toBe('');
    });
});

test.describe('app icons on dashboard rows', () => {
    test('a bookmark without an icon shows its app icon; a public site keeps its letter', async ({ page }) => {
        await loadDashboard(page);
        const stamp = Date.now();
        const app = `https://sonarr.r${stamp}.lan/`;
        const site = `https://github.com/r${stamp}`;
        await page.evaluate(async ({ urls }) => {
            const d = window.dashboardInstance;
            const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
            for (const url of urls) {
                await api('/api/bookmarks/add', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ page: d.currentPageId, bookmark: { name: url, url, category: '' } }),
                });
            }
        }, { urls: [app, site] });
        await page.reload();
        await page.waitForFunction(() => window.dashboardInstance?.bookmarks?.length > 0, null, { timeout: 15_000 });

        // Recent and the category both show a new bookmark: either row will do.
        const appRow = page.locator(`a.bookmark-open[href="${app}"]`).first().locator('xpath=ancestor::*[contains(@class,"bookmark-link")][1]');
        await expect(appRow.locator('img.bookmark-icon--set'))
            .toHaveAttribute('src', /\/data\/icon-sets\/dashboard-icons\/sonarr/);
        const siteRow = page.locator(`a.bookmark-open[href="${site}"]`).first().locator('xpath=ancestor::*[contains(@class,"bookmark-link")][1]');
        await expect(siteRow.locator('.bookmark-icon-letter')).toBeVisible();
        await expect(siteRow.locator('img.bookmark-icon--set')).toHaveCount(0);
    });
});

// The grid draws each icon in the variant for the theme; a click adopted
// 'base' (or the previous item's variant) instead, so a dark theme saved the
// black icon it did not show.
test('a click adopts the variant the grid shows', async ({ page }) => {
    await stubPreview(page);
    const form = await openAdd(page);
    await form.locator('[data-field="url"]').fill(`https://media.v${Date.now()}.lan`);
    await form.locator('[data-field="url"]').blur();
    await form.locator('.bookmark-form-card-pencil').click();
    await form.locator('[data-icon-set-choose]').click();
    const picker = page.locator('[data-icon-set-popover]');
    await picker.getByRole('searchbox').fill('sonarr');
    const option = picker.locator('[role="option"][data-icon-set-option="dashboard-icons/sonarr"]');
    await expect(option).toBeVisible();
    // Sonarr has both: the variant for a dark background on a dark theme.
    const dark = await page.evaluate(() => window.IconSetAuto?.isDark?.() ?? false);
    const adopted = page.waitForRequest((req) => req.url().includes('/api/icon-sets/adopt'));
    await option.click();
    const variant = JSON.parse((await adopted).postData() || '{}').variant;
    expect(variant).toBe(dark ? 'light' : 'dark');
});
