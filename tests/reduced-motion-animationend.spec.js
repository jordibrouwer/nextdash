// @ts-check
const { test, expect } = require('@playwright/test');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * Reduced motion must not strand the code that waits on animationend.
 *
 * reduced-motion.css collapses durations to 0.01ms rather than using
 * `animation: none`, and its header says why: an animation that never starts
 * fires no animationend, so a `{ once: true }` listener that removes a class
 * never runs. dashboard.css then overrode four of those selectors with
 * `animation: none !important` anyway — the exact case that comment warns about.
 * bookmark-copy-flash and bookmark-pulse stayed on the row for the rest of the
 * session, and the 320ms wait before a cross-page move became a dead pause with
 * nothing to show for it.
 *
 * As in reduced-motion.spec.js, the in-app animation toggle is left explicitly
 * ON so a pass cannot come from `body.no-animations` doing the work instead.
 */

async function openDashboard(page, { reduce = false } = {}) {
    await page.setViewportSize({ width: 1400, height: 900 });
    if (reduce) {
        await page.emulateMedia({ reducedMotion: 'reduce' });
    }
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });
    await page.evaluate(() => {
        const d = window.dashboardInstance;
        d.settings.animationsEnabled = true;
        d.applyAnimations?.();
    });
    expect(await page.evaluate(
        () => document.body.classList.contains('no-animations'))).toBe(false);
    if (reduce) {
        expect(await page.evaluate(
            () => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true);
    }
}

/**
 * Add a class to the first bookmark row and report whether animationend fired.
 *
 * The class goes on the same way the app puts it there, and comes off through a
 * listener of the same shape, so a class that produces no event fails here for
 * the same reason it fails in the app.
 */
async function firesAnimationEnd(page, className, { pseudo = false } = {}) {
    return page.evaluate(async ({ cls, onPseudo }) => {
        const row = document.querySelector('#dashboard-layout .bookmark-link');
        if (!row) return { error: 'no bookmark row' };

        // The launcher pulse only applies inside the launcher layout.
        const layout = document.getElementById('dashboard-layout');
        const hadLauncher = layout.classList.contains('layout-launcher');
        if (cls === 'bookmark-pulse') layout.classList.add('layout-launcher');

        row.classList.remove(cls);
        void row.offsetWidth;
        row.classList.add(cls);
        const duration = getComputedStyle(row, onPseudo ? '::after' : null).animationDuration;
        row.classList.remove(cls);

        void row.offsetWidth;
        const fired = await new Promise((resolve) => {
            const timer = setTimeout(() => resolve(false), 2000);
            row.addEventListener('animationend', () => {
                clearTimeout(timer);
                resolve(true);
            }, { once: true });
            row.classList.add(cls);
        });

        row.classList.remove(cls);
        if (!hadLauncher) layout.classList.remove('layout-launcher');
        return { fired, duration };
    }, { cls: className, onPseudo: pseudo });
}

/**
 * Time _moveBookmarkToPage up to its first await past the animation wait.
 *
 * Page 0 does not exist, so the write behind it fails immediately — what is
 * measured is the pause before it, not the round trip.
 */
async function timeMoveOut(page) {
    return page.evaluate(async () => {
        const d = window.dashboardInstance;
        const row = document.querySelector('#dashboard-layout .bookmark-link');
        const bookmark = { ...d.bookmarks[0] };
        const started = performance.now();
        await d.inlineEdit._moveBookmarkToPage(
            { bookmark, index: 0, pageId: d.currentPageId, scope: 'current' },
            bookmark,
            0,
            row,
        ).catch(() => {});
        return performance.now() - started;
    });
}

test.describe('with reduced motion on', () => {
    test('the copy flash still ends, so its class comes off', async ({ page }) => {
        await openDashboard(page, { reduce: true });
        const result = await firesAnimationEnd(page, 'bookmark-copy-flash', { pseudo: true });
        expect(result.error).toBeUndefined();
        // Near-zero, not absent: `none` is what stranded the listener.
        expect(parseFloat(result.duration)).toBeLessThan(0.05);
        expect(result.fired).toBe(true);
    });

    test('the launcher pulse still ends', async ({ page }) => {
        await openDashboard(page, { reduce: true });
        const result = await firesAnimationEnd(page, 'bookmark-pulse');
        expect(result.error).toBeUndefined();
        expect(parseFloat(result.duration)).toBeLessThan(0.05);
        expect(result.fired).toBe(true);
    });

    test('the deep-link highlight still ends', async ({ page }) => {
        await openDashboard(page, { reduce: true });
        const result = await firesAnimationEnd(page, 'bookmark-deep-link-focus');
        expect(result.error).toBeUndefined();
        expect(parseFloat(result.duration)).toBeLessThan(0.05);
        expect(result.fired).toBe(true);
    });

    test('a cross-page move does not sit through the move-out animation', async ({ page }) => {
        await openDashboard(page, { reduce: true });
        // The animation is 320ms; anything near that means the sleep still ran.
        expect(await timeMoveOut(page)).toBeLessThan(250);
    });
});

test.describe('without reduced motion', () => {
    test('the move-out animation is still waited for', async ({ page }) => {
        await openDashboard(page);
        expect(await timeMoveOut(page)).toBeGreaterThan(280);
    });
});
