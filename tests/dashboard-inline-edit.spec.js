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

        await urlInput.click({ force: true });
        await expect(urlInput).toBeFocused();
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
        await page.keyboard.press(';');
        const nameInput = page.locator('.bookmark-inline-form .bookmark-inline-input').first();
        await expect(nameInput).toBeVisible({ timeout: 3000 });
        await page.waitForTimeout(600);
        const original = await nameInput.inputValue();
        const edited = `${original} save-test`;
        await nameInput.fill(edited);
        await page.keyboard.press('Control+Enter');
        await expect.poll(async () => page.evaluate(() => (
            !document.querySelector('.bookmark-inline-editing')
        ))).toBe(true);
        await expect.poll(async () => page.evaluate((expected) => {
            const rows = [...document.querySelectorAll('#dashboard-layout .bookmark-link[data-bookmark-url]')];
            return rows.some((el) => el.querySelector('.bookmark-text')?.textContent?.trim() === expected);
        }, edited)).toBe(true);
    });

    test('clicking second field keeps editor open', async ({ page }) => {
        await page.keyboard.press(';');
        const nameInput = page.locator('.bookmark-inline-form .bookmark-inline-input').first();
        const urlInput = page.locator('.bookmark-inline-form input[type="url"]').first();
        await expect(nameInput).toBeVisible({ timeout: 3000 });
        await page.waitForTimeout(700);
        await urlInput.click({ force: true });
        await expect(urlInput).toBeFocused();
        await expect(page.locator('.bookmark-inline-editing')).toHaveCount(1);
        await urlInput.fill('https://example.com/safari-field-test');
        await expect(urlInput).toHaveValue('https://example.com/safari-field-test');
        await page.locator('.bookmark-inline-form .bookmark-inline-action-btn', { hasText: /cancel/i }).click();
        await expect.poll(async () => page.evaluate(() => (
            !document.querySelector('.bookmark-inline-editing')
        ))).toBe(true);
    });

    test('delete button opens confirm modal and removes bookmark', async ({ page }) => {
        await page.keyboard.press(';');
        await expect(page.locator('.bookmark-inline-form')).toBeVisible({ timeout: 3000 });
        await page.waitForTimeout(700);

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
        await expect.poll(async () => (
            page.locator('#dashboard-layout .bookmark-link[data-bookmark-url]').count()
        )).toBe(countBefore - 1);
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
