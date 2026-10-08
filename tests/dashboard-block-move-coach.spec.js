// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissBlockingOverlays, dismissOnboardingIfPresent } = require('./e2e-helpers');

/*
 * The first time a block is picked up, a card beside the landing box says how
 * moving works and lists the keys. It stays beside the block after the drop or
 * a cancel until the reader says "Got it" or presses Escape, and only then is
 * it remembered per installation in settings.discoverabilityState. While a
 * block is carried it takes no pointer events, so it never takes the drop.
 */

const TIP = 'blockMoveCoach';
const blockSel = '#dashboard-layout .category[data-category-id]:not([data-smart-collection="true"])';
const coach = (page) => page.locator('.block-move-coach');

/** @param {import('@playwright/test').Page} page @param {{ unseenOnReload?: boolean }} [opts] */
async function openDashboard(page, { unseenOnReload = false } = {}) {
    await page.setViewportSize({ width: 1280, height: 900 });
    await markWhatsNewSeen(page, { extraPromoConfirmedKeys: ['nextdash:dashboard-grid-keyboard-promo-confirmed-v1'] });
    // The fixture keeps every listed tip seen, whatever the server holds. This
    // spec wants the coach unseen on the first load; a reload goes back to the
    // fixture's default (seen) unless the test says it stays unseen, and what the
    // server remembers is read from /api/settings instead.
    await page.addInitScript(({ tip, always }) => {
        const reloaded = sessionStorage.getItem('coach-spec-loaded') === '1';
        sessionStorage.setItem('coach-spec-loaded', '1');
        window.__e2eWantTours = always || !reloaded ? [tip] : [];
    }, { tip: TIP, always: unseenOnReload });
    await page.goto(`/?_=${Date.now()}`);
    await page.waitForSelector(blockSel, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => !!window.DashboardBlockMover);
    // Widgets still load in after the first paint and move the blocks beneath them.
    await page.waitForTimeout(1200);
}

async function pickUpWithMouse(page, index = 0) {
    const from = await page.locator(`${blockSel} .category-reorder-handle`).nth(index).boundingBox();
    await page.mouse.move(from.x + 4, from.y + 4);
    await page.mouse.down();
    await page.mouse.move(from.x + 40, from.y + 30, { steps: 4 });
}

/** Carry the first block over the third and let go: a real move, not a drop in place. */
async function moveFirstOverThird(page) {
    const from = await page.locator(`${blockSel} .category-reorder-handle`).first().boundingBox();
    const to = await page.locator(blockSel).nth(2).boundingBox();
    await page.mouse.move(from.x + 4, from.y + 4);
    await page.mouse.down();
    await page.mouse.move(to.x + to.width * 0.75, to.y + 20, { steps: 8 });
}

const apart = (a, b) => b[0] >= a[2] || b[2] <= a[0] || b[1] >= a[3] || b[3] <= a[1];

const storedSeen = (page) => page.evaluate(async (tip) => {
    const res = await fetch('/api/settings');
    const body = await res.json();
    return (body.discoverabilityState?.seenTips || []).includes(tip);
}, TIP);

test.describe('first-time coach for moving a block', () => {
    test('the first pick-up shows the card with the keys, and it takes no pointer events while carried', async ({ page }) => {
        await openDashboard(page);
        await pickUpWithMouse(page);
        await expect(page.locator('.block-landing')).toBeVisible();
        await expect(coach(page)).toBeVisible();
        await expect(coach(page).locator('.block-move-coach-eyebrow')).toHaveText('Tip');
        await expect(coach(page).locator('.block-move-coach-title')).toHaveText('Moving a block');
        await expect(coach(page)).toContainText('The dashed box shows where it lands.');
        await expect(coach(page)).toContainText('Drop on the line between two columns to make it wide.');
        for (const key of ['W / Shift', 'Esc', 'Space', 'Shift + Alt + ← / →']) {
            await expect(coach(page).locator('kbd', { hasText: key }).first()).toBeVisible();
        }
        await expect(coach(page).locator('kbd', { hasText: /^(Ctrl\+Z|⌘Z)$/ })).toHaveCount(1);
        expect(await page.evaluate(() => getComputedStyle(document.querySelector('.block-move-coach')).pointerEvents)).toBe('none');
        // Under the pointer's reach it is not what a click would hit.
        const hit = await page.evaluate(() => {
            const r = document.querySelector('.block-move-coach').getBoundingClientRect();
            return document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)?.closest('.block-move-coach') !== null;
        });
        expect(hit).toBe(false);
        // It is not what the drop lands in, and it is not clickable yet.
        await page.mouse.up();
    });

    test('it stays after the drop, beside the moved block, and is not remembered yet', async ({ page }) => {
        await openDashboard(page);
        await moveFirstOverThird(page);
        await expect(coach(page)).toBeVisible();
        const movedId = await page.evaluate(() => window.DashboardBlockMover.state.id);
        await page.mouse.up();
        await expect(coach(page)).toBeVisible();
        await expect(coach(page)).not.toHaveClass(/is-carried/);
        expect(await page.evaluate(() => getComputedStyle(document.querySelector('.block-move-coach')).pointerEvents)).toBe('auto');
        await expect(coach(page).getByRole('button', { name: 'Got it' })).toBeVisible();
        await expect.poll(async () => page.evaluate((id) => {
            const block = document.querySelector(`#dashboard-layout .category[data-category-id="${CSS.escape(id)}"]`).getBoundingClientRect();
            const card = document.querySelector('.block-move-coach').getBoundingClientRect();
            const clear = card.left >= block.right || card.right <= block.left || card.top >= block.bottom || card.bottom <= block.top;
            return clear && Math.abs(card.left - block.right) < 80 || Math.abs(card.right - block.left) < 80
                || Math.abs(card.top - block.bottom) < 80 || Math.abs(card.bottom - block.top) < 80;
        }, movedId)).toBe(true);
        expect(await page.evaluate((tip) => window.DiscoverabilityState.hasSeenTip(tip), TIP)).toBe(false);
        await page.waitForTimeout(1200);
        expect(await storedSeen(page)).toBe(false);
    });

    test('Got it removes it and remembers it on the server', async ({ page }) => {
        await openDashboard(page);
        await pickUpWithMouse(page);
        await expect(coach(page)).toBeVisible();
        await page.mouse.up();
        await coach(page).getByRole('button', { name: 'Got it' }).click();
        await expect(coach(page)).toHaveCount(0);
        await expect.poll(() => storedSeen(page), { timeout: 10_000 }).toBe(true);

        await pickUpWithMouse(page);
        await expect(page.locator('.block-landing')).toBeVisible();
        await expect(coach(page)).toHaveCount(0);
        await page.mouse.up();

    });

    test('Escape dismisses it once nothing is carried', async ({ page }) => {
        await openDashboard(page);
        await pickUpWithMouse(page);
        await page.mouse.up();
        await expect(coach(page)).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(coach(page)).toHaveCount(0);
        await expect.poll(() => storedSeen(page), { timeout: 10_000 }).toBe(true);
    });

    test('cancelling the carry keeps the card, and Escape then dismisses it', async ({ page }) => {
        await openDashboard(page);
        await pickUpWithMouse(page);
        await expect(coach(page)).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(page.locator('.block-landing')).toHaveCount(0);
        await expect(coach(page)).toBeVisible();
        await page.mouse.up();
        await expect(coach(page)).toBeVisible();
        await expect(coach(page)).not.toHaveClass(/is-carried/);
        await page.keyboard.press('Escape');
        await expect(coach(page)).toHaveCount(0);
    });

    test('a reload before it was dismissed shows it again at the next pick-up', async ({ page }) => {
        await openDashboard(page, { unseenOnReload: true });
        await pickUpWithMouse(page);
        await page.mouse.up();
        await expect(coach(page)).toBeVisible();
        await page.waitForTimeout(1200);
        // Shown is not seen: the server holds nothing until it is dismissed.
        expect(await storedSeen(page)).toBe(false);
        await page.reload();
        await page.waitForSelector(blockSel, { timeout: 15_000 });
        await page.waitForFunction(() => !!window.DashboardBlockMover);
        await page.waitForTimeout(1200);
        await expect(coach(page)).toHaveCount(0);
        await pickUpWithMouse(page);
        await expect(coach(page)).toBeVisible();
        await page.mouse.up();
    });

    test('a second pick-up while it is shown keeps the same card', async ({ page }) => {
        await openDashboard(page);
        await pickUpWithMouse(page);
        await page.mouse.up();
        await page.evaluate(() => { document.querySelector('.block-move-coach').dataset.mark = 'first'; });
        await pickUpWithMouse(page, 1);
        await expect(page.locator('.block-landing')).toBeVisible();
        await expect(coach(page)).toHaveCount(1);
        await expect(coach(page)).toHaveAttribute('data-mark', 'first');
        await expect(coach(page)).toHaveClass(/is-carried/);
        await page.mouse.up();
        await expect(coach(page)).toHaveCount(1);
    });

    test('the card is never on top of the landing box', async ({ page }) => {
        await openDashboard(page);
        await pickUpWithMouse(page);
        await expect(coach(page)).toBeVisible();
        const { a, b } = await page.evaluate(() => {
            const l = document.querySelector('.block-landing').getBoundingClientRect();
            const c = document.querySelector('.block-move-coach').getBoundingClientRect();
            return { a: [l.left, l.top, l.right, l.bottom], b: [c.left, c.top, c.right, c.bottom] };
        });
        expect(apart(a, b)).toBe(true);
        expect(b[0]).toBeGreaterThanOrEqual(0);
        expect(b[2]).toBeLessThanOrEqual(1280);
        expect(b[1]).toBeGreaterThanOrEqual(0);
        expect(b[3]).toBeLessThanOrEqual(900);
        await page.mouse.up();
    });

    test('a keyboard pick-up as the first one shows it, and it stays after Enter with focus on the handle', async ({ page }) => {
        await openDashboard(page);
        const handle = page.locator(`${blockSel} .category-reorder-handle`).first();
        await handle.focus();
        await page.keyboard.press('Space');
        await expect(page.locator('.block-landing')).toBeVisible();
        await expect(coach(page)).toBeVisible();
        await expect(coach(page).locator('kbd', { hasText: 'Enter' })).toBeVisible();
        // In keyboard mode Shift does not change the width; W does.
        await expect(coach(page).locator('kbd', { hasText: /^W$/ })).toBeVisible();
        await page.keyboard.press('ArrowRight');
        await page.keyboard.press('Enter');
        await expect(page.locator('.block-landing')).toHaveCount(0);
        await expect(coach(page)).toBeVisible();
        await expect(coach(page).getByRole('button', { name: 'Got it' })).toBeEnabled();
        await expect.poll(() => page.evaluate(() => document.activeElement?.classList.contains('category-reorder-handle'))).toBe(true);
        await page.keyboard.press('Escape');
        await expect(coach(page)).toHaveCount(0);
    });

    test('a touch pick-up leaves out the keys and points at the width button', async ({ page }) => {
        await openDashboard(page);
        await page.evaluate(async () => {
            const handle = document.querySelector('#dashboard-layout .category[data-category-id]:not([data-smart-collection="true"]) .category-reorder-handle');
            const r = handle.getBoundingClientRect();
            handle.dispatchEvent(new PointerEvent('pointerdown', {
                bubbles: true, button: 0, pointerType: 'touch', pointerId: 7, clientX: r.left + 4, clientY: r.top + 4,
            }));
            await new Promise((resolve) => setTimeout(resolve, 600));
        });
        await expect(coach(page)).toBeVisible();
        await expect(coach(page)).toContainText('Tap the width button on the box to make it wide.');
        await expect(coach(page).locator('kbd')).toHaveCount(0);
        await page.evaluate(() => window.DashboardBlockMover.finish(false));
        await expect(coach(page)).toBeVisible();
    });

    test('a block that cannot be wider leaves out the width rows', async ({ page }) => {
        await openDashboard(page);
        await page.evaluate(() => { window.dashboardInstance.renderCore.getEffectiveColumnsPerRow = () => 1; });
        await pickUpWithMouse(page);
        await expect(coach(page)).toBeVisible();
        await expect(coach(page)).toContainText('The dashed box shows where it lands.');
        await expect(coach(page)).not.toContainText('Drop on the line between two columns');
        await expect(coach(page).locator('kbd', { hasText: /^W/ })).toHaveCount(0);
        await expect(coach(page).locator('kbd', { hasText: 'Esc' })).toBeVisible();
        await page.mouse.up();
    });

    test('moving with Alt and the arrows does not use up the coach', async ({ page }) => {
        await openDashboard(page);
        await page.locator(`${blockSel} .category-reorder-handle`).first().focus();
        await page.keyboard.press('Alt+ArrowRight');
        await expect(coach(page)).toHaveCount(0);
        expect(await page.evaluate((tip) => window.DiscoverabilityState.hasSeenTip(tip), TIP)).toBe(false);
    });

    test('a locked layout picks nothing up, so shows no coach', async ({ page }) => {
        await openDashboard(page);
        await page.evaluate(() => { window.dashboardInstance.settings.lockLayout = true; });
        await page.locator(`${blockSel} .category-reorder-handle`).first().focus();
        await page.keyboard.press('Space');
        await expect(page.locator('.block-landing')).toHaveCount(0);
        await expect(coach(page)).toHaveCount(0);
        expect(await page.evaluate((tip) => window.DiscoverabilityState.hasSeenTip(tip), TIP)).toBe(false);
    });
});
