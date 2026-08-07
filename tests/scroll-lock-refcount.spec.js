// @ts-check
const { test, expect } = require('@playwright/test');
const { dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

async function loadDashboard(page) {
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
}

const bodyOverflow = () => document.body.style.overflow;

/**
 * The page is scrollable when the viewport actually moves under a wheel — the
 * user-visible property, rather than a style string that only implies it.
 */
async function wheelScrolls(page) {
    const before = await page.evaluate(() => window.scrollY);
    await page.mouse.move(500, 400);
    await page.mouse.wheel(0, 600);
    await page.waitForTimeout(300);
    const after = await page.evaluate(() => window.scrollY);
    await page.evaluate(() => window.scrollTo(0, 0));
    return after !== before;
}

test.describe('scroll lock is refcounted', () => {
    // The original bug: a second AppModal.show() over an open one captured
    // 'hidden' as the value to restore, so the single hide() re-applied the
    // lock and left the page unscrollable with no modal on screen.
    test('a modal opened over another still frees the page on close', async ({ page }) => {
        await loadDashboard(page);
        await page.evaluate(() => window.dashboardInstance.config.openConfigView('appearance'));
        await page.waitForTimeout(500);

        await page.evaluate(() => { void window.AppModal.alert({ title: 'first', message: 'a' }); });
        await page.evaluate(() => { void window.AppModal.alert({ title: 'second', message: 'b' }); });
        expect(await page.evaluate(bodyOverflow)).toBe('hidden');

        await page.locator('#modal-actions button').first().click();
        await page.waitForTimeout(400);

        await expect(page.locator('#app-modal.show')).toHaveCount(0);
        expect(await page.evaluate(bodyOverflow)).toBe('');
        expect(await page.evaluate(() => window.ScrollLock.isLocked())).toBe(false);
        expect(await wheelScrolls(page)).toBe(true);
    });

    test('the info button frees the page on every config section', async ({ page }) => {
        await loadDashboard(page);

        for (const section of ['behavior', 'appearance']) {
            await page.evaluate((s) => window.dashboardInstance.config.openConfigView(s), section);
            await page.waitForTimeout(500);

            const btn = page.locator('#config-view [data-info-field], .config-info-btn').first();
            if (await btn.count() === 0) continue;

            await btn.scrollIntoViewIfNeeded();
            await btn.click();
            await page.waitForTimeout(250);
            expect(await page.evaluate(bodyOverflow), `${section}: locked while open`).toBe('hidden');

            await page.locator('#modal-actions button').first().click();
            await page.waitForTimeout(400);
            expect(await page.evaluate(bodyOverflow), `${section}: freed after close`).toBe('');
            expect(await wheelScrolls(page), `${section}: wheel works after close`).toBe(true);
        }
    });

    test('overlapping holders each keep the lock until the last one releases', async ({ page }) => {
        await loadDashboard(page);

        const result = await page.evaluate(() => {
            const steps = {};
            const a = window.ScrollLock.acquire('a');
            steps.afterA = document.body.style.overflow;
            const b = window.ScrollLock.acquire('b');
            steps.afterB = document.body.style.overflow;
            window.ScrollLock.release(a);
            // Still held by b — releasing one holder must not free the page.
            steps.afterReleaseA = document.body.style.overflow;
            window.ScrollLock.release(b);
            steps.afterReleaseB = document.body.style.overflow;
            // A duplicate release must not unbalance a later acquire.
            window.ScrollLock.release(b);
            const c = window.ScrollLock.acquire('c');
            steps.afterC = document.body.style.overflow;
            window.ScrollLock.release(c);
            steps.afterReleaseC = document.body.style.overflow;
            steps.locked = window.ScrollLock.isLocked();
            return steps;
        });

        expect(result).toEqual({
            afterA: 'hidden',
            afterB: 'hidden',
            afterReleaseA: 'hidden',
            afterReleaseB: '',
            afterC: 'hidden',
            afterReleaseC: '',
            locked: false,
        });
    });

    test('body is not its own scroll container', async ({ page }) => {
        await loadDashboard(page);
        // overflow-x: hidden would promote overflow-y to auto, making body a
        // scroll container and putting the page scrollbar on the wrong element.
        const overflowY = await page.evaluate(() => getComputedStyle(document.body).overflowY);
        expect(overflowY).toBe('visible');
    });
});
