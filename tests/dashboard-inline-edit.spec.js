// @ts-check
const { test, expect } = require('@playwright/test');
const { markWhatsNewSeen, dismissOnboardingIfPresent, prepareDashboardInteraction } = require('./e2e-helpers');

test.describe('dashboard inline edit', () => {
    test.beforeEach(async ({ page }) => {
        await markWhatsNewSeen(page);
        await page.goto('/');
        await page.waitForSelector('.bookmark-link', { timeout: 15_000 });
        await dismissOnboardingIfPresent(page);
        await prepareDashboardInteraction(page);
        await page.keyboard.press('ArrowDown');
        await expect.poll(async () => page.evaluate(() => (
            window.dashboardInstance?.keyboardNavigation?.currentIndex ?? -1
        ))).toBeGreaterThanOrEqual(0);
    });

    test('; opens inline edit and Esc cancels without saving', async ({ page }) => {
        const nameBefore = await page.evaluate(() => {
            const kn = window.dashboardInstance?.keyboardNavigation;
            const row = kn?.navigableElements?.[kn.currentIndex];
            return row?.querySelector('.bookmark-text')?.textContent?.trim() || '';
        });
        expect(nameBefore.length).toBeGreaterThan(0);

        await page.keyboard.press(';');
        const nameInput = page.locator('.bookmark-inline-input').first();
        await expect(nameInput).toBeVisible({ timeout: 3000 });
        await expect.poll(async () => page.evaluate(() => (
            document.body.classList.contains('bookmark-inline-edit-active')
        ))).toBe(true);
        await expect.poll(async () => page.evaluate(() => (
            document.getElementById('dashboard-layout')?.hasAttribute('inert') === false
        ))).toBe(true);

        await page.keyboard.press('Escape');
        await expect.poll(async () => page.evaluate(() => (
            !document.querySelector('.bookmark-inline-editing')
        ))).toBe(true);
        await expect.poll(async () => page.evaluate(() => (
            document.body.classList.contains('bookmark-inline-edit-active')
        ))).toBe(false);
        await expect.poll(async () => page.evaluate(() => (
            document.getElementById('dashboard-layout')?.hasAttribute('inert') === false
        ))).toBe(true);

        const nameAfter = await page.evaluate(() => {
            const kn = window.dashboardInstance?.keyboardNavigation;
            const row = kn?.navigableElements?.[kn.currentIndex];
            return row?.querySelector('.bookmark-text')?.textContent?.trim() || '';
        });
        expect(nameAfter).toBe(nameBefore);
    });

    test('click inside inline form keeps editor open and focuses field', async ({ page }) => {
        await page.keyboard.press(';');
        const urlInput = page.locator('.bookmark-inline-form input[type="url"]').first();
        await expect(urlInput).toBeVisible({ timeout: 3000 });

        await page.evaluate(() => {
            document.querySelector('.bookmark-inline-form input[type="url"]')?.focus();
        });
        await expect.poll(async () => page.evaluate(() => (
            document.activeElement?.matches('.bookmark-inline-form input[type="url"]') === true
        ))).toBe(true);
        await expect(page.locator('.bookmark-inline-editing')).toHaveCount(1);
        await expect.poll(async () => page.evaluate(() => (
            document.getElementById('dashboard-layout')?.hasAttribute('inert') === false
        ))).toBe(true);
    });

    test('multiple form fields accept clicks without closing', async ({ page }) => {
        await page.keyboard.press(';');
        await expect(page.locator('.bookmark-inline-form').first()).toBeVisible({ timeout: 3000 });
        await page.locator('.bookmark-inline-form input[type="url"]').first().click({ force: true });
        await page.locator('.bookmark-inline-form .bookmark-inline-select').first().click({ force: true });
        await page.locator('.bookmark-inline-form .bookmark-inline-action-btn', { hasText: /cancel/i }).first().click();
        await expect(page.locator('.bookmark-inline-editing')).toHaveCount(0);
    });

    test('can type in inline form without discard modal', async ({ page }) => {
        await page.keyboard.press(';');
        const nameInput = page.locator('.bookmark-inline-form .bookmark-inline-input').first();
        await expect(nameInput).toBeVisible({ timeout: 3000 });
        const original = await nameInput.inputValue();
        await page.waitForTimeout(600);
        await nameInput.click({ force: true });
        await nameInput.fill(`${original} typed`);
        await expect(page.locator('#app-modal.show')).toHaveCount(0);
        await expect(nameInput).toHaveValue(`${original} typed`);
        await nameInput.fill(original);
        await page.locator('.bookmark-inline-form .bookmark-inline-action-btn', { hasText: /cancel/i }).click();
        await expect.poll(async () => page.evaluate(() => (
            !document.querySelector('.bookmark-inline-editing')
        ))).toBe(true);
    });

    test('Esc cancels inline edit when grid keyboard promo is still open', async ({ page }) => {
        await page.goto('/');
        await page.waitForSelector('.bookmark-link', { timeout: 15_000 });
        await dismissOnboardingIfPresent(page);
        const whatsNew = page.locator('#app-modal.show');
        if (await whatsNew.count()) {
            await page.keyboard.press('Escape');
            await expect(whatsNew).toHaveCount(0, { timeout: 3000 });
        }
        await page.keyboard.press('ArrowDown');
        await expect.poll(async () => page.evaluate(() => (
            window.dashboardInstance?.keyboardNavigation?.currentIndex ?? -1
        ))).toBeGreaterThanOrEqual(0);
        await page.evaluate(() => {
            window.DashboardPromoRegistry?.clearById?.('gridKeyboard');
            window.DashboardGridKeyboardPromo?.clearPromoSeen?.();
        });
        await page.keyboard.press('ArrowDown');
        await page.keyboard.press('ArrowUp');

        await page.keyboard.press(';');
        await expect(page.locator('.bookmark-inline-input').first()).toBeVisible({ timeout: 3000 });
        await page.keyboard.press('Escape');
        await expect.poll(async () => page.evaluate(() => (
            !document.querySelector('.bookmark-inline-editing')
        ))).toBe(true);
    });

    test('save commits inline edit changes', async ({ page }) => {
        const target = await page.evaluate(() => {
            const kn = window.dashboardInstance?.keyboardNavigation;
            const row = kn?.navigableElements?.[kn.currentIndex];
            const url = row?.getAttribute('data-bookmark-url') || '';
            const normalizedUrl = String(url).trim();
            const bookmark = (window.dashboardInstance?.bookmarks || []).find(
                (entry) => String(entry?.url || '').trim() === normalizedUrl
            );
            return {
                url,
                storedName: String(bookmark?.name || '').trim(),
                label: row?.querySelector('.bookmark-text')?.textContent?.trim() || '',
            };
        });
        expect(target.url).not.toBe('');

        await page.keyboard.press(';');
        const nameInput = page.locator('.bookmark-inline-form .bookmark-inline-input').first();
        await expect(nameInput).toBeVisible({ timeout: 3000 });
        await page.waitForTimeout(600);
        const inputName = (await nameInput.inputValue()).trim();
        const baseName = inputName || target.storedName || target.label;
        const suffix = `save-${Date.now()}`;
        const edited = baseName ? `${baseName} ${suffix}` : suffix;
        await nameInput.fill(edited);
        await page.keyboard.press('Control+Enter');
        await expect.poll(async () => page.evaluate(() => (
            !document.querySelector('.bookmark-inline-editing')
        ))).toBe(true);
        await expect.poll(async () => page.evaluate(({ url, expected }) => {
            const normalizedUrl = String(url || '').trim();
            const normalizedExpected = String(expected || '').trim();
            const bookmark = (window.dashboardInstance?.bookmarks || []).find(
                (entry) => String(entry?.url || '').trim() === normalizedUrl
            );
            if (bookmark?.name?.trim() === normalizedExpected) {
                return true;
            }
            const rows = [...document.querySelectorAll('#dashboard-layout .bookmark-link[data-bookmark-url]')];
            return rows.some((el) => (
                String(el.getAttribute('data-bookmark-url') || '').trim() === normalizedUrl
                && el.querySelector('.bookmark-text')?.textContent?.trim() === normalizedExpected
            ));
        }, { url: target.url, expected: edited }), { timeout: 10_000 }).toBe(true);

        // Restore the original name so re-runs start from a clean state. The
        // save API takes the page id as a query param and the full page array
        // as the body (POST /api/bookmarks?page=N with [Bookmark, ...]); the
        // earlier form here sent the wrong shape (400) and then awaited a
        // refresh that never resolved, timing the test out.
        await page.evaluate(async ({ url, originalName }) => {
            const normalizedUrl = String(url || '').trim();
            const d = window.dashboardInstance;
            const bookmark = (d?.bookmarks || []).find(
                (entry) => String(entry?.url || '').trim() === normalizedUrl
            );
            if (!bookmark || String(bookmark.name || '').trim() === String(originalName || '').trim()) {
                return;
            }
            const pageId = d.currentPageId;
            const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
            const res = await api(`/api/bookmarks?page=${pageId}`);
            if (!res.ok) {
                return;
            }
            const pageBookmarks = await res.json();
            const idx = pageBookmarks.findIndex(
                (entry) => String(entry?.url || '').trim() === normalizedUrl
            );
            if (idx < 0) {
                return;
            }
            pageBookmarks[idx].name = originalName;
            await api(`/api/bookmarks?page=${pageId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(pageBookmarks),
            });
            bookmark.name = originalName;
        }, { url: target.url, originalName: target.storedName });
    });

    test('clicking second field keeps editor open', async ({ page }) => {
        await page.keyboard.press(';');
        const nameInput = page.locator('.bookmark-inline-form .bookmark-inline-input').first();
        const urlInput = page.locator('.bookmark-inline-form input[type="url"]').first();
        await expect(nameInput).toBeVisible({ timeout: 3000 });
        await page.waitForTimeout(700);
        await page.evaluate(() => {
            document.querySelector('.bookmark-inline-form input[type="url"]')?.focus();
        });
        await expect.poll(async () => page.evaluate(() => (
            document.activeElement?.matches('.bookmark-inline-form input[type="url"]') === true
        ))).toBe(true);
        await expect(page.locator('.bookmark-inline-editing')).toHaveCount(1);
        await urlInput.fill('https://example.com/safari-field-test');
        await expect(urlInput).toHaveValue('https://example.com/safari-field-test');
        await page.locator('.bookmark-inline-form .bookmark-inline-action-btn', { hasText: /cancel/i }).click();
        await expect.poll(async () => page.evaluate(() => (
            !document.querySelector('.bookmark-inline-editing')
        ))).toBe(true);
    });

    test('delete button opens confirm modal and removes bookmark', async ({ page }) => {
        // Seed a dedicated throwaway bookmark on the current page and delete THAT,
        // so the test never depends on whichever bookmark happens to sit in the
        // first row when the shared e2e data dir has been mutated by earlier tests
        // (a stale first-row ref made deleteBookmarkInline no-op, so the confirm
        // modal never opened and the test flaked in the full suite).
        const targetUrl = `https://example.com/inline-delete-${Date.now()}`;
        await page.evaluate(async (url) => {
            const d = window.dashboardInstance;
            const pageId = d.currentPageId;
            const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
            const res = await api(`/api/bookmarks?page=${pageId}`);
            const pageBookmarks = res.ok ? await res.json() : [];
            pageBookmarks.push({ name: 'Inline Delete Target', url, category: '', shortcut: '' });
            await api(`/api/bookmarks?page=${pageId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(pageBookmarks),
            });
            await d.loadPageBookmarks(pageId, { forceFetch: true });
        }, targetUrl);

        // Focus the seeded row and open its inline editor.
        const targetRow = page.locator(`#dashboard-layout .bookmark-link[data-bookmark-url="${targetUrl}"]`);
        await expect(targetRow).toBeVisible({ timeout: 5000 });
        await targetRow.evaluate((el) => el.scrollIntoView({ block: 'center' }));
        await expect.poll(async () => page.evaluate((url) => {
            const d = window.dashboardInstance;
            const kn = d.keyboardNavigation;
            kn.updateNavigableElements();
            const row = kn.navigableElements.find((el) => (
                String(el.getAttribute('data-bookmark-url') || '').trim() === url
            ));
            return row ? kn.selectBookmarkRow(row) : false;
        }, targetUrl)).toBe(true);
        await page.keyboard.press(';');
        await expect(page.locator('.bookmark-inline-form')).toBeVisible({ timeout: 3000 });
        await expect.poll(async () => (
            (await page.locator('.bookmark-inline-form input[type="url"]').first().inputValue()).trim()
        )).toBe(targetUrl);

        const countBefore = await page.locator('#dashboard-layout .bookmark-link[data-bookmark-url]').count();
        const deleteBtn = page.locator('.bookmark-inline-delete');
        await expect(deleteBtn).toBeVisible();
        await deleteBtn.click();

        const modal = page.locator('#app-modal.show');
        await expect(modal).toBeVisible({ timeout: 3000 });
        await expect(modal.locator('.inline-edit-confirm-modal')).toBeVisible();
        await modal.locator('.modal-button.danger').click();

        await expect.poll(async () => page.evaluate(() => (
            !document.querySelector('.bookmark-inline-editing')
        ))).toBe(true);
        await expect.poll(async () => page.evaluate((url) => {
            const rows = [...document.querySelectorAll('#dashboard-layout .bookmark-link[data-bookmark-url]')];
            return {
                countAfter: rows.length,
                stillPresent: rows.some((row) => (
                    String(row.getAttribute('data-bookmark-url') || '').trim() === url
                )),
            };
        }, targetUrl)).toMatchObject({
            countAfter: expect.any(Number),
            stillPresent: false,
        });
        await expect.poll(async () => (
            page.locator('#dashboard-layout .bookmark-link[data-bookmark-url]').count()
        )).toBeLessThan(countBefore);
    });

    test('inline form uses opaque surfaces above dimmed grid', async ({ page }) => {
        await page.keyboard.press(';');
        await expect(page.locator('.bookmark-inline-form')).toBeVisible({ timeout: 3000 });

        const surfaces = await page.evaluate(() => {
            const form = document.querySelector('.bookmark-inline-form');
            const input = document.querySelector('.bookmark-inline-form .bookmark-inline-input');
            const parseAlpha = (color) => {
                const rgba = color.match(/^rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)$/);
                if (rgba) return Number(rgba[4]);
                return color.startsWith('rgb(') ? 1 : null;
            };
            const formStyle = form ? getComputedStyle(form) : null;
            const beforeStyle = getComputedStyle(document.body, '::before');
            return {
                hasBodyOverlay: beforeStyle.content !== 'none' && beforeStyle.backdropFilter !== 'none',
                formBackdrop: formStyle?.backdropFilter || '',
                formAlpha: formStyle ? parseAlpha(formStyle.backgroundColor) : null,
                inputAlpha: input ? parseAlpha(getComputedStyle(input).backgroundColor) : null,
            };
        });

        expect(surfaces.hasBodyOverlay).toBe(false);
        expect(surfaces.formBackdrop).toBe('none');
        expect(surfaces.formAlpha).toBe(1);
        expect(surfaces.inputAlpha).toBe(1);
    });
});
