// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissBlockingOverlays, dismissOnboardingIfPresent } = require('./e2e-helpers');

/*
 * The first time the dashboard is quiet, a see-through copy of the first
 * category shows that blocks can be moved, and a card stays under its "//" until
 * "Got it", "Try it" or Escape. Nothing real moves or is saved while it plays,
 * and only closing the card remembers it, per installation, in
 * settings.discoverabilityState.
 */

const TIP = 'blockMoveIntro';
const blockSel = '#dashboard-layout .category[data-category-id]:not([data-smart-collection="true"])';
const card = (page) => page.locator('.block-intro-card');

/** @param {import('@playwright/test').Page} page @param {{ lockLayout?: boolean }} [opts] */
async function openDashboard(page, { lockLayout = false } = {}) {
    await page.setViewportSize({ width: 1280, height: 900 });
    await markWhatsNewSeen(page, { extraPromoConfirmedKeys: ['nextdash:dashboard-grid-keyboard-promo-confirmed-v1'] });
    // The fixture keeps every listed tip seen unless the spec asks for it. The
    // intro stands down once the first-move coach has been seen, so both are wanted.
    await page.addInitScript(({ tip, lock }) => {
        window.__e2eWantTours = [tip, 'blockMoveCoach'];
        // Another test in this worker may have left the tips cooldown set on the server.
        const desc = Object.getOwnPropertyDescriptor(window, 'DiscoverabilityState');
        Object.defineProperty(window, 'DiscoverabilityState', {
            configurable: true,
            get: desc?.get,
            set(value) {
                if (value && typeof value.getTipsNotBefore === 'function') value.getTipsNotBefore = () => 0;
                desc?.set?.call(this, value);
            },
        });
        if (lock) {
            setInterval(() => {
                if (window.dashboardInstance?.settings) window.dashboardInstance.settings.lockLayout = true;
            }, 30);
        }
    }, { tip: TIP, lock: lockLayout });
    await page.goto(`/?_=${Date.now()}`);
    await page.waitForSelector(blockSel, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => !!window.DashboardBlockMoveIntro);
}

const storedSeen = (page) => page.evaluate(async (tip) => {
    const res = await fetch('/api/settings');
    const body = await res.json();
    return (body.discoverabilityState?.seenTips || []).includes(tip);
}, TIP);

const blockOrder = (page) => page.evaluate(() => window.dashboardInstance.renderCore.blockOrderFromDom());

test.describe('one-time intro that shows blocks can be moved', () => {
    test('it plays on a fresh install, shows the card, and moves and saves nothing', async ({ page }) => {
        /** @type {string[]} */
        const writes = [];
        page.on('request', (req) => {
            if (req.method() !== 'GET' && req.url().includes('/api/')) writes.push(`${req.method()} ${new URL(req.url()).pathname} ${(req.postData() || '').match(/"discoverabilityState":.{0,200}/)?.[0] ?? ''}`);
        });
        await openDashboard(page);
        const before = await blockOrder(page);

        await expect(page.locator('.block-intro-ghost')).toBeVisible({ timeout: 15_000 });
        // Whatever the page itself saved while loading is over: from here on nothing is written.
        writes.length = 0;
        await expect(page.locator('.block-intro-box')).toBeVisible({ timeout: 5_000 });
        await expect(page.locator('.block-intro-box .block-landing-label')).toContainText('1 column');
        // The real blocks stay where they are while a copy travels.
        expect(await blockOrder(page)).toEqual(before);

        await expect(card(page)).toBeVisible({ timeout: 10_000 });
        await expect(card(page).locator('.block-move-coach-eyebrow')).toHaveText('Tip');
        await expect(card(page).locator('.block-move-coach-title')).toHaveText('Move categories and widgets');
        await expect(card(page)).toContainText('Drag // before a title.');
        await expect(card(page).getByRole('button', { name: 'Got it' })).toBeVisible();
        await expect(card(page).getByRole('button', { name: 'Try it' })).toBeVisible();
        await expect(page.locator('.block-intro-ghost')).toHaveCount(0);
        await expect(page.locator('.block-intro-box')).toHaveCount(0);
        await expect(page.locator('.category.is-move-source')).toHaveCount(0);

        expect(await blockOrder(page)).toEqual(before);
        // Showing it is not seeing it: nothing is written until the card is answered.
        await page.waitForTimeout(600);
        expect(writes).toEqual([]);
        expect(await storedSeen(page)).toBe(false);
        // The page underneath is not blocked by it.
        expect(await page.evaluate(() => getComputedStyle(document.querySelector('.block-intro-card')).pointerEvents)).toBe('auto');
    });

    test('Got it closes it and remembers it on the server', async ({ page }) => {
        await openDashboard(page);
        await expect(card(page)).toBeVisible({ timeout: 25_000 });
        expect(await storedSeen(page)).toBe(false);
        await card(page).getByRole('button', { name: 'Got it' }).click();
        await expect(card(page)).toHaveCount(0);
        await expect(page.locator('.category-reorder-handle.is-intro-ring')).toHaveCount(0);
        await expect.poll(() => storedSeen(page), { timeout: 10_000 }).toBe(true);

        // A reload shows nothing, whatever the page itself would otherwise want.
        await page.reload();
        await page.waitForSelector(blockSel, { timeout: 15_000 });
        await page.waitForTimeout(6000);
        await expect(card(page)).toHaveCount(0);
        await expect(page.locator('.block-intro-ghost')).toHaveCount(0);
    });

    test('Try it picks the first category up with the keyboard', async ({ page }) => {
        await openDashboard(page);
        await expect(card(page)).toBeVisible({ timeout: 25_000 });
        const id = await page.evaluate(() => document.querySelector('.category-reorder-handle.is-intro-ring')?.closest('.category')?.getAttribute('data-category-id'));
        expect(id).toBeTruthy();
        await card(page).getByRole('button', { name: 'Try it' }).click();
        await expect(card(page)).toHaveCount(0);
        await expect(page.locator('.block-landing')).toBeVisible();
        expect(await page.evaluate(() => window.DashboardBlockMover.isMoving())).toBe(true);
        expect(await page.evaluate(() => window.DashboardBlockMover.state.id)).toBe(id);
        expect(await page.evaluate(() => document.activeElement?.classList.contains('category-reorder-handle'))).toBe(true);
        // The first-move coach follows at once.
        await expect(page.locator('.block-move-coach:not(.block-intro-card)')).toBeVisible();
        await expect.poll(() => storedSeen(page), { timeout: 10_000 }).toBe(true);
        await page.keyboard.press('Escape');
    });

    test('Escape closes the card and remembers it', async ({ page }) => {
        await openDashboard(page);
        await expect(card(page)).toBeVisible({ timeout: 25_000 });
        await page.keyboard.press('Escape');
        await expect(card(page)).toHaveCount(0);
        await expect.poll(() => storedSeen(page), { timeout: 10_000 }).toBe(true);
    });

    test('a key press during the animation stops it and does not remember it', async ({ page }) => {
        await openDashboard(page);
        await expect(page.locator('.block-intro-ghost')).toBeVisible({ timeout: 15_000 });
        await page.keyboard.press('Shift');
        await expect(page.locator('.block-intro-ghost')).toHaveCount(0);
        await expect(page.locator('.block-intro-box')).toHaveCount(0);
        await expect(page.locator('.category.is-move-source')).toHaveCount(0);
        await expect(page.locator('.category-reorder-handle.is-intro-glow, .category-reorder-handle.is-intro-ring')).toHaveCount(0);
        // It does not come back later in the same visit, and no card appears.
        await page.waitForTimeout(6000);
        await expect(card(page)).toHaveCount(0);
        expect(await storedSeen(page)).toBe(false);
    });

    test('a pointer press during the animation stops it too', async ({ page }) => {
        await openDashboard(page);
        await expect(page.locator('.block-intro-ghost')).toBeVisible({ timeout: 15_000 });
        await page.mouse.click(5, 5);
        await expect(page.locator('.block-intro-ghost')).toHaveCount(0);
        await page.waitForTimeout(5000);
        await expect(card(page)).toHaveCount(0);
        expect(await storedSeen(page)).toBe(false);
    });

    test('a locked layout shows no intro', async ({ page }) => {
        await openDashboard(page, { lockLayout: true });
        await page.waitForTimeout(8000);
        await expect(page.locator('.block-intro-ghost')).toHaveCount(0);
        await expect(card(page)).toHaveCount(0);
        expect(await storedSeen(page)).toBe(false);
    });
});
